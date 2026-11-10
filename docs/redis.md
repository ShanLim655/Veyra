# Redis in Veyra

Redis is an optional acceleration and retry layer. MariaDB remains the durable source of truth for accounts, conversations, messages, and history. Supabase Realtime remains the browser WebSocket transport; Redis credentials are never sent to clients.

## Configuration

Set `REDIS_URL` on the API server and in local `.env.local` when developing against Redis:

```dotenv
REDIS_URL=redis://:password@redis-host:6379/0
```

For a server that has no TLS, use `redis://`. Veyra does not require TLS in its Redis client configuration. Keep this variable server-only; do not use a `VITE_` prefix. If unset or unreachable, Veyra continues to use MariaDB and Supabase Realtime without Redis acceleration.

## Integrations

- **Read cache:** authenticated SELECT responses are keyed by user ID and the full table/query payload. Entries expire after two seconds and results larger than 256 KB are not cached. A table generation value changes after writes through data and RPC routes, making previous entries unreachable.
- **Singleflight:** identical reads within one warm Node/Vercel function instance share the same in-flight database query. Keys include the user and full query, including filters, ordering, offset, and limit.
- **Realtime outbox:** after MariaDB commits a change, the API appends a compact recipient-scoped broadcast batch to a Redis Stream. The API publishes batches to Supabase Realtime and removes them after successful delivery. Failed batches remain bounded in the stream and are retried on later changes. Clients deduplicate message inserts by their MariaDB message ID and recover history from MariaDB after reconnects.
- **Temporary typing/presence:** these remain on Supabase Realtime presence. Its connection lifecycle already removes departed clients, and typing has a five-second client expiry. Putting browser presence in Redis would require exposing a new authenticated websocket gateway and would duplicate working functionality.

## Capacity and operations

Veyra uses one lazy Redis connection per warm API instance, short-lived cached values, a 256 KB per-value cap, and a stream trimmed approximately to 10,000 batches. Redis command or connection failures are logged and fall back to MariaDB/direct Realtime delivery. A missed live event never removes or replaces its MariaDB row; chat history requests continue to read MariaDB.

Use a Redis persistence configuration appropriate for your deployment if you want the outbox to survive Redis process restarts. The outbox is an at-least-once retry aid, not a transaction log: MariaDB is authoritative, clients deduplicate repeated event IDs, and reconnect/history loading repairs missed events.

Avoid eviction configurations that discard outbox entries under memory pressure. Monitor connected clients, stream length, memory, cache hit rates, and API latency before scaling Redis resources. Do not store attachments, media, passwords, session tokens, or other large/permanent data in Redis.
