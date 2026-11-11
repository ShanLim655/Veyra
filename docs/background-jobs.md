# Background processing

Veyra uses a MariaDB-backed job outbox for message notifications. The outbox is deliberately separate from Redis: MariaDB is authoritative, so a Redis outage cannot erase pending notification work.

## Configuration

`BACKGROUND_JOBS_ENABLED` defaults to `false`.

- When disabled, the worker does not start and message notifications use the existing in-process delivery path.
- When enabled, the API starts a MariaDB polling worker. Message inserts create outbox rows through database triggers in the same transaction as the message insert.
- `BACKGROUND_JOB_POLL_MS` controls polling cadence and is clamped to 250–30000 ms. The default is 1000 ms. This worker runs in the self-hosted Node server started with `npm start`; do not enable it in the Vercel serverless runtime, which does not run the long-lived worker loop.
- Run `npm run db:migrate` before enabling the worker. Startup fails with an actionable error if the job schema is missing.
- On shutdown, publishing is disabled first and the worker finishes its current job before the process exits.

No Altare-managed queue service is assumed. Altare's published help documentation describes running workers with an external Redis/database queue; it does not specify a separate managed Altare Queues API. This implementation therefore uses Veyra's existing MariaDB rather than inventing an endpoint or authentication contract.

## Delivery and recovery

The outbox stores only the message table and message ID, not message contents. The worker loads the message from MariaDB when it runs. Jobs are claimed under a database row lock and have a two-minute lease. A live worker renews its lease every 30 seconds while delivering a notification; expired processing jobs can be reclaimed after a worker crash. Transient failures retry with exponential backoff, capped at five minutes, for up to eight attempts. Terminal failures remain in `background_jobs` with their last error for inspection. Completed jobs are automatically pruned after 30 days; failed jobs are retained until an operator resolves or removes them.

Delivery is at-least-once. If a worker crashes after an external notification has been accepted but before the job is marked complete, a retry can send a duplicate. Notification providers do not offer a transaction shared with MariaDB, so exactly-once delivery is not claimed.

## Operations

Inspect pending and failed jobs with:

```sql
SELECT id, job_type, status, attempts, available_at, last_error, created_at
FROM background_jobs
WHERE status IN ('pending', 'failed')
ORDER BY created_at DESC
LIMIT 100;
```

Retry selected failed jobs after resolving the cause:

```sql
UPDATE background_jobs
SET status = 'pending', attempts = 0, available_at = UTC_TIMESTAMP(3), last_error = NULL
WHERE id = 'JOB_UUID' AND status = 'failed';
```

Disable the worker with `BACKGROUND_JOBS_ENABLED=false` and restart the API. The worker disables trigger publishing during startup/shutdown. Existing pending jobs remain stored and can be processed when the worker is enabled again.

Global Chat remains server-readable for moderation. This queue changes notification delivery only; it does not encrypt messages or change message authorization.
