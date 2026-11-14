# PostgreSQL support

Veyra's API can run on either MariaDB or PostgreSQL. MariaDB remains the
default; PostgreSQL is enabled by setting `USE_MARIADB=false` in the API
environment. Any other value (including unset) keeps MariaDB.

## Configuration

When `USE_MARIADB=false`, the `MARIADB_*` variables are ignored and the API
reads:

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_HOST` | `127.0.0.1` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DATABASE` | — (required) | Database name |
| `POSTGRES_USER` | — (required) | Role/user name |
| `POSTGRES_PASSWORD` | — | Password (omit for trust auth) |
| `POSTGRES_POOL_SIZE` | `MARIADB_POOL_SIZE` or `1` | Max connections per instance (capped at 2) |

Connections are plain TCP — TLS/SSL is intentionally not used for
PostgreSQL. For production, run PostgreSQL on a private network, a VPN, or a
managed provider that offers private connectivity; do not expose the port to
the public internet without additional protection.

## Schema

Apply the PostgreSQL schema with:

```bash
USE_MARIADB=false npm run db:migrate
```

`npm run db:migrate` picks `database/schema.postgres.sql` automatically when
`USE_MARIADB=false`. The schema mirrors `database/schema.sql`: same tables,
columns, foreign keys, and unique constraints. Differences worth knowing:

- `DATETIME(3)` maps to `TIMESTAMP(3)` stored in UTC; the API pins each
  session's timezone to UTC, matching MariaDB's `timezone: 'Z'` behavior.
- `BOOLEAN` maps to real `BOOLEAN`; MariaDB `tinyint(1)` `0`/`1` comparisons
  in API queries are translated automatically.
- `ENUM` columns become `VARCHAR` + `CHECK` constraints.
- `ON UPDATE CURRENT_TIMESTAMP` is implemented with a trigger
  (`veyra_touch_updated_at`).
- `profiles.username` gets an additional `lower(username)` unique index to
  preserve MariaDB's case-insensitive uniqueness.
- `admin_logs.details` is `JSONB` (MariaDB `JSON`).

## How it works

`server/db.mjs` exports a single `pool` object. When `USE_MARIADB=false` it
wraps a `pg` Pool and translates the small set of MySQL syntax used across
`server/` (`?` placeholders, `INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`,
`DATE_ADD`/`DATE_SUB`/`INTERVAL`, `UTC_TIMESTAMP()`, `SHOW COLUMNS`,
backtick identifiers, and boolean `= 0`/`= 1` comparisons) into PostgreSQL at
query time. Result shapes are normalized so callers cannot tell which
dialect is active (`[rows, fields]` tuples, `affectedRows`, and datetime
strings identical to mysql2 output).

Operational scripts (`db:migrate`, `db:encrypt:messages`, `db:grant-role`,
`db:import:legacy`) all honor the same env switch.

## Migrating data from MariaDB

`npm run db:migrate:postgres` copies all application data from the MariaDB
database (`MARIADB_*` variables) into the PostgreSQL database (`POSTGRES_*`
variables). It applies `database/schema.postgres.sql` first, then copies
every table in foreign-key order using `ON CONFLICT DO NOTHING`, so it is
safe to re-run — rows already present are skipped, not duplicated.

```bash
# Preview what would be copied (no writes):
npm run db:migrate:postgres -- --dry-run

# Apply schema + copy all data:
npm run db:migrate:postgres

# Wipe the target first, then copy (fresh cutover):
npm run db:migrate:postgres -- --fresh

# Copy into an already-migrated schema:
npm run db:migrate:postgres -- --no-schema
```

Type conversions handled automatically:

- `TINYINT(1)`/`BOOLEAN` → real `BOOLEAN`
- `DATETIME(3)` → `TIMESTAMP(3)` as raw UTC strings (no timezone drift)
- `JSON` → `JSONB`
- `ENUM` → `VARCHAR` (values are validated by the target `CHECK` constraints)
- `INT` → `INTEGER`, `CHAR(36)`/`VARCHAR`/`TEXT` pass through unchanged

Encrypted message fields are opaque ciphertext and copy verbatim — keep the
same `MESSAGE_ENCRYPTION_KEY` on both sides.

For a clean cutover: put the API in maintenance/read-only mode (or stop it),
run the migration, verify the printed row counts match, then set
`USE_MARIADB=false` and restart.

## Caveats

- `db:import:legacy` imports the *old Supabase Postgres* tables into whichever
  database the API is currently configured for; use `db:migrate:postgres`
  for MariaDB → PostgreSQL.
- Username lookups are case-sensitive at the SQL level; the `lower(username)`
  unique index prevents case-variant duplicates, but `WHERE username = ?`
  matches exactly (MariaDB's collation matched case-insensitively).
- Realtime, Redis, queues, encryption, and Supabase Storage behavior are
  unchanged — only the SQL dialect differs.
