# Altare Queues (optional)

Veyra can offload suitable background work to Altare Queues — an external job
queue — but **queues are optional and disabled by default**. With no
`ALTARE_QUEUE_URL` configured, the API never opens a connection to a queue
service and every supported operation runs inline exactly as before.

## How Altare Queues works

Altare Queues is a simple authenticated message queue per queue URL:

- **Publish:** `POST {queue_url}/messages` with `{ "body": <job> }`.
- **Consume:** `POST {queue_url}/messages/receive` with
  `{ "max_messages": N, "wait_seconds": S }` — a long poll returning
  `{ "messages": [{ "body": <job>, "receipt": "..." }] }`.
- **Settle:** `POST {queue_url}/messages/ack` or `/messages/retry` with
  `{ "receipts": [...] }` (retry accepts `delay_seconds`).

All calls use `Authorization: Bearer <ALTARE_QUEUE_TOKEN>`.

Veyra only **publishes** jobs. Delivery requires a worker process —
`scripts/altare-queue-worker.mjs` implements the receive/ack/retry loop and
forwards jobs to the Veyra API.

## Configuration (API)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ALTARE_QUEUE_URL` | To enable | — | Queue endpoint, e.g. `https://kv-us.altare.global/v1/queues/q_xxx`. Empty/unset disables queues entirely. |
| `ALTARE_QUEUE_TOKEN` | Recommended | — | Bearer token sent on every queue call. A warning is logged at startup if missing. |
| `ALTARE_QUEUE_TIMEOUT_MS` | No | `5000` | Publish timeout in milliseconds (clamped 500–30000). |
| `QUEUES_WORKER_SECRET` | For workers | — | Shared secret a worker sends as `x-queue-worker-secret` to `POST /api/queues/deliver`. Without it the endpoint rejects every request. |

Implementation: `server/queues.mjs`.

## Configuration (worker)

`scripts/altare-queue-worker.mjs` needs the same `ALTARE_QUEUE_URL` /
`ALTARE_QUEUE_TOKEN`, plus:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3001` | Veyra API origin that hosts `/api/queues/deliver`. |
| `QUEUES_WORKER_SECRET` | — | Must match the API value. |
| `ALTARE_QUEUE_MAX_MESSAGES` | `10` | Batch size per receive call (max 100). |
| `ALTARE_QUEUE_WAIT_SECONDS` | `20` | Long-poll wait per receive call (max 60). |
| `ALTARE_QUEUE_RETRY_SECONDS` | `30` | Delay before failed jobs are retried. |
| `ALTARE_QUEUE_IDLE_BACKOFF_MS` | `1000` | Pause after empty polls. |

Run it with `npm run queue:worker` (or `node scripts/altare-queue-worker.mjs`).
It stops cleanly on Ctrl+C/SIGTERM; unacknowledged in-flight messages are
retried by the queue.

## Behavior

- **Disabled (default):** `enqueueJob()` runs the caller's inline fallback.
  No sockets, no DNS lookups, no startup dependency.
- **Enabled:** jobs publish as `POST {ALTARE_QUEUE_URL}/messages` with body
  `{ "body": { "type", "payload", "idempotency_key", "source": "veyra" } }`.
- **Publish failure:** the error is logged and the inline fallback runs, so a
  job is never silently discarded.
- **Startup validation:** `createApp()` throws a descriptive error when
  `ALTARE_QUEUE_URL` is set but is not a valid http(s) URL.

## Currently queued work

- `notifications.deliver` — push notification delivery `{ server, topic, title, message }` with a unique `veyra-notify-<uuid>` idempotency key. When queues are disabled this falls back to the direct ntfy publish, preserving existing behavior. The worker forwards the payload verbatim to `/api/queues/deliver`.

## Worker contract

`POST {APP_URL}/api/queues/deliver` with header
`x-queue-worker-secret: <QUEUES_WORKER_SECRET>` and the job payload as JSON
(`{ server, topic, title, message }`). Responds `{ "ok": true|false }`; the
worker acks on `ok: true` and retries otherwise. Workers should deduplicate on
`idempotency_key`. Unknown job types are acked and dropped by the reference
worker.

## Reliability notes

- Delivery is at-least-once; workers must be idempotent (use `idempotency_key`).
- There is no built-in always-on worker — run `scripts/altare-queue-worker.mjs`
  wherever suits your deployment (it is intentionally a plain Node script with
  no dependencies).
- Critical paths (message writes, auth, realtime) never depend on queue
  availability; only notification fan-out is eligible for queuing.
