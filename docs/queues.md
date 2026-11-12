# Altare Queues (optional)

Veyra can offload suitable background work to Altare Queues — an external job queue — but **queues are optional and disabled by default**. With queues disabled, the API never opens a connection to a queue service and every supported operation runs inline exactly as before.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ALTARE_QUEUES_ENABLED` | No | `false` | Set to `true` to enable publishing. Any other value keeps queues off. |
| `ALTARE_QUEUES_URL` | When enabled | — | HTTP base URL of the Altare Queues service, e.g. `https://queues.example.com`. Missing/invalid values fail startup with a clear error while enabled. |
| `ALTARE_QUEUES_API_KEY` | No | — | Sent as `Authorization: Bearer <key>` when publishing jobs. |
| `ALTARE_QUEUES_TIMEOUT_MS` | No | `5000` | Publish timeout in milliseconds (clamped to 500–30000). |
| `QUEUES_WORKER_SECRET` | For workers | — | Shared secret a worker sends as the `x-queue-worker-secret` header to `POST /api/queues/deliver`. |

Implementation: `server/queues.mjs`.

## Behavior

- **Disabled (default):** `enqueueJob()` runs the caller's inline fallback.
  No sockets, no DNS lookups, no startup dependency.
- **Enabled:** jobs are published as `POST {ALTARE_QUEUES_URL}/jobs` with body
  `{ type, payload, idempotency_key, source: "veyra" }`.
- **Publish failure:** the error is logged and the inline fallback runs, so a
  job is never silently discarded. Callers that pass no fallback receive a
  `{ delivered: 'unavailable' }` result.
- **Startup validation:** `createApp()` throws a descriptive error when queues
  are enabled without a valid `ALTARE_QUEUES_URL`.

## Currently queued work

- `notifications.deliver` — push notification delivery `{ server, topic, title, message }` with a unique `veyra-notify-<uuid>` idempotency key. When queues are disabled this falls back to the direct ntfy publish, preserving existing behavior.

## Worker contract

A queue worker should consume `notifications.deliver` jobs and forward them to
the Veyra API for actual delivery:

```text
POST {APP_URL}/api/queues/deliver
x-queue-worker-secret: <QUEUES_WORKER_SECRET>
Content-Type: application/json

{ "server": "...", "topic": "...", "title": "...", "message": "..." }
```

The endpoint responds `{ "ok": true|false }`. Workers must deduplicate on
`idempotency_key` so retried publishes do not send duplicate notifications.
`POST /api/queues/deliver` is inert unless `QUEUES_WORKER_SECRET` is
configured; without it the endpoint rejects every request.

## Reliability notes

- Publishing is at-least-once from Veyra's side; workers must be idempotent.
- There is no built-in Veyra worker process — queue consumption is owned by
  your Altare Queues deployment.
- Critical paths (message writes, auth, realtime) never depend on queue
  availability; only the notification fan-out is eligible for queuing.
