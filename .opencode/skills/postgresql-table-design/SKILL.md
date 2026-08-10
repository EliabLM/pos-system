---
name: postgresql-table-design
description: Use this skill when designing or reviewing a PostgreSQL schema for this POS system. Covers best-practices, data types, indexing, constraints, performance patterns, and advanced features, plus the project's tenant/soft-delete/Prisma conventions. Trigger: touching prisma/schema.prisma, planning a migration, or designing any new table.
---

# PostgreSQL Table Design

## Project mapping (migration targets — adopt, don't preserve)

The whole DB is migrating into `pos-system-server`, so this skill pushes **industry best practice**, not the existing schema's conventions. Where the current schema deviates, the migration is when to fix it. The generic rules below are the reference; this section is the opinionated decision set for THIS product (multi-tenant SaaS POS, being split into web + server + offline-capable mobile app).

Schema today lives in `pos-system-client/prisma/schema.prisma`, client generated to `@/generated/prisma`. Prisma maps to Postgres via `@db.*`, `@@index`, `@@unique`, `@relation`, `@map`. **Before touching any model, open `schema.prisma` and use only fields that exist** (hard project rule — never invent Prisma fields); add fields there first, then `npx prisma migrate dev --name <change>` from `pos-system-client/` (later: from the server project).

Decisions for the migrated schema:

- **IDs: `UUID` v7 — not cuid, not `BIGINT IDENTITY`.** Why this project specifically: (1) multi-service — global uniqueness across server + mobile app; (2) the POS app works **offline** and must mint IDs without a DB round-trip; (3) unguessable — sequential IDs leak daily sales volume to competitors/customers; (4) monotonic (timestamp-prefixed) → clean B-tree inserts, near-bigint performance, no v4-style fragmentation. Type `UUID` (Prisma `String @db.Uuid`). **Generate v7 app-side** in the server/mobile (e.g. `uuidv7` package) so there's no DB-version dependency; `[email protected]+` also offers a native `uuidv7()` default if you prefer DB-side. Use `gen_random_uuid()` (v4) only as a last-resort fallback, never sequential bigint. *Migration: cuid (String) → UUID (String `@db.Uuid`) is type-compatible at the Prisma layer — cleaner conversion than cuid→bigint.*
- **Identifiers snake_case in the DB via `@map`.** Keep Prisma fields camelCase; map every column to `snake_case` (`user_id`, `organization_id`, `created_at`). Postgres lowercases unquoted identifiers and the convention for raw SQL / BI tooling is snake_case.
- **Tenant isolation: Postgres Row-Level Security (RLS) on `organization_id` — DECIDED, adopt during the migration.** Current app-layer `organizationId` filter stays as a first layer; RLS policies keyed on a per-request session var (`SET LOCAL app.tenant_id = '<uuid>'` inside the request transaction) so an app bug can't leak across tenants. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation USING (organization_id = current_setting('app.tenant_id')::uuid)`. **Critical caveat — the_details_that_bite:** Postgres's table owner and superuser bypass RLS by default, so the API **must connect as a non-owner role** and you must `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. Cross-tenant queries (superadmin spanning all orgs) need a separate role without the policy, or a policy variant that allows all rows when the role is superadmin. Tests must set the session var or they see zero rows. Multi-tenant SaaS gold standard. See the dedicated "Row-Level Security" section below.
- **Soft delete, done properly: `is_deleted boolean` + `deleted_at timestamptz`, with a partial unique index `WHERE deleted_at IS NULL` — NOT `@@unique([..., deleted_at])`.** Deletes are `UPDATE ... SET is_deleted = true, deleted_at = now()`; reads filter `is_deleted = false`. For "unique name per tenant among active rows": `CREATE UNIQUE INDEX ... ON tbl (organization_id, name) WHERE deleted_at IS NULL;` — smaller index than including `deleted_at`, no NULLS edge cases, clearer intent. The current schema's `@@unique([organizationId, name, deletedAt])` is a workaround to be replaced.
- **Timestamps: `created_at` and `updated_at` as `TIMESTAMPTZ`.** `updated_at` set by a **`BEFORE UPDATE` trigger** (`NEW.updated_at = now()`) so non-Prisma paths (new server, scripts, ad-hoc SQL) can't leave it stale — Prisma `@updatedAt` alone only covers Prisma writes.
- **Money: `NUMERIC(p,s)` / `Decimal` — never `Float`.** ⚠️ The current schema uses `Float` for `subtotal` / `total` / `amount` (sale / sale-item / payment) — a latent correctness bug (floating-point rounding on cents eventually breaks cash reconciliation). Resolve during the migration. Quantities stay `Int` (correct).
- **Tenant key leads every compound index:** `CREATE INDEX ON tbl (organization_id, <filters>...)` — with RLS, the tenant filter is enforced, so `organization_id` remains the right leftmost column for planner efficiency. Index FK columns explicitly (Postgres does not auto-index them).
- **Enums:** PG `enum` for truly stable closed sets (e.g. user role); `TEXT` + `CHECK` or a lookup FK table for evolving business enums (order/sale status, payment method) — adding a value to a `CHECK` is one `ALTER`, and a lookup table lets the UI/ETL read it directly.
- **Audit:** keep the app-level `AuditLog` for domain events; evaluate `pgaudit` for DB-level audit on the server deployment (money-handling SaaS benefits from both layers).

---

## Core Rules

- Define a **PRIMARY KEY** for reference tables (users, orders, etc.). Not always needed for time-series/event/log data. For multi-tenant SaaS and any distributed/offline system → **`UUID` v7** (see Project mapping); for a tight single-service DB where order-volume leakage is fine → `BIGINT GENERATED ALWAYS AS IDENTITY`; use opaque UUIDs whenever global uniqueness or volume concealment matters.
- **Normalize first (to 3NF)** to eliminate data redundancy and update anomalies; denormalize **only** for measured, high-ROI reads where join performance is proven problematic. Premature denormalization creates maintenance burden.
- Add **NOT NULL** everywhere it's semantically required; use **DEFAULT**s for common values.
- Create **indexes for access paths you actually query**: PK/unique (auto), **FK columns (manual!)**, frequent filters/sorts, and join keys.
- Prefer **TIMESTAMPTZ** for event time; **NUMERIC** for money; **TEXT** for strings; **BIGINT** for integer values, **DOUBLE PRECISION** for floats (or `NUMERIC` for exact decimal arithmetic).

## PostgreSQL "Gotchas"

- **Identifiers**: unquoted → lowercased. Avoid quoted/mixed-case names. Convention: use `snake_case` for table/column names.
- **Unique + NULLs**: UNIQUE allows multiple NULLs. Use `UNIQUE (...) NULLS NOT DISTINCT` (PG15+) to restrict to one NULL.
- **FK indexes**: PostgreSQL **does not** auto-index FK columns. Add them.
- **No silent coercions**: length/precision overflows error out (no truncation). Example: inserting 999 into `NUMERIC(2,0)` fails with error, unlike some databases that silently truncate or round.
- **Sequences/identity have gaps** (normal; don't "fix"). Rollbacks, crashes, and concurrent transactions create gaps in ID sequences (1, 2, 5, 6...). This is expected behavior—don't try to make IDs consecutive.
- **Heap storage**: no clustered PK by default (unlike SQL Server/MySQL InnoDB); `CLUSTER` is one-off reorganization, not maintained on subsequent inserts. Row order on disk is insertion order unless explicitly clustered.
- **MVCC**: updates/deletes leave dead tuples; vacuum handles them—design to avoid hot wide-row churn.

## Data Types

- **IDs**: For multi-tenant/distributed/offline systems → **`UUID` v7** (timestamp-prefixed, monotonic, globally unique, generable client-side) — generate app-side so there's no DB-version dependency, or use `[email protected]+` native `uuidv7()`. For a tight single service where volume leakage is acceptable → `BIGINT GENERATED ALWAYS AS IDENTITY` (slightly smaller/faster). Use `UUID` v4 (`gen_random_uuid()`) only as a fallback when v7 isn't available. Avoid `UUID` v1 (exposes MAC/time).
- **Integers**: prefer `BIGINT` unless storage space is critical; `INTEGER` for smaller ranges; avoid `SMALLINT` unless constrained.
- **Floats**: prefer `DOUBLE PRECISION` over `REAL` unless storage space is critical. Use `NUMERIC` for exact decimal arithmetic.
- **Strings**: prefer `TEXT`; if length limits needed, use `CHECK (LENGTH(col) <= n)` instead of `VARCHAR(n)`; avoid `CHAR(n)`. Use `BYTEA` for binary data. Large strings/binary (>2KB default threshold) automatically stored in TOAST with compression. TOAST storage: `PLAIN` (no TOAST), `EXTENDED` (compress + out-of-line), `EXTERNAL` (out-of-line, no compress), `MAIN` (compress, keep in-line if possible). Default `EXTENDED` usually optimal. Control with `ALTER TABLE tbl ALTER COLUMN col SET STORAGE strategy` and `ALTER TABLE tbl SET (toast_tuple_target = 4096)` for threshold. Case-insensitive: for locale/accent handling use non-deterministic collations; for plain ASCII use expression indexes on `LOWER(col)` (preferred unless column needs case-insensitive PK/FK/UNIQUE) or `CITEXT`.
- **Money**: `NUMERIC(p,s)` (never float).
- **Time**: `TIMESTAMPTZ` for timestamps; `DATE` for date-only; `INTERVAL` for durations. Avoid `TIMESTAMP` (without timezone). Use `now()` for transaction start time, `clock_timestamp()` for current wall-clock time.
- **Booleans**: `BOOLEAN` with `NOT NULL` constraint unless tri-state values are required.
- **Enums**: `CREATE TYPE ... AS ENUM` for small, stable sets (e.g. US states, days of week). For business-logic-driven and evolving values (e.g. order statuses) → use TEXT (or INT) + CHECK or lookup table.
- **Arrays**: `TEXT[]`, `INTEGER[]`, etc. Use for ordered lists where you query elements. Index with **GIN** for containment (`@>`, `<@`) and overlap (`&&`) queries. Access: `arr[1]` (1-indexed), `arr[1:3]` (slicing). Good for tags, categories; avoid for relations—use junction tables instead. Literal syntax: `'{val1,val2}'` or `ARRAY[val1,val2]`.
- **Range types**: `daterange`, `numrange`, `tstzrange` for intervals. Support overlap (`&&`), containment (`@>`), operators. Index with **GiST**. Good for scheduling, versioning, numeric ranges. Pick a bounds scheme and use it consistently; prefer `[)` (inclusive/exclusive) by default.
- **Network types**: `INET` for IP addresses, `CIDR` for network ranges, `MACADDR` for MAC addresses. Support network operators (`<<`, `>>`, `&&`).
- **Geometric types**: `POINT`, `LINE`, `POLYGON`, `CIRCLE` for 2D spatial data. Index with **GiST**. Consider **PostGIS** for advanced spatial features.
- **Text search**: `TSVECTOR` for full-text search documents, `TSQUERY` for search queries. Index `tsvector` with **GIN**. Always specify language: `to_tsvector('english', col)` and `to_tsquery('english', 'query')`. Never use single-argument versions. This applies to both index expressions and queries.
- **Domain types**: `CREATE DOMAIN email AS TEXT CHECK (VALUE ~ '^[^@]+@[^@]+$')` for reusable custom types with validation. Enforces constraints across tables.
- **Composite types**: `CREATE TYPE address AS (street TEXT, city TEXT, zip TEXT)` for structured data within columns. Access with `(col).field` syntax.
- **JSONB**: preferred over JSON; index with **GIN**. Use only for optional/semi-structured attrs. ONLY use JSON if the original ordering of the contents MUST be preserved.
- **Vector types**: `vector` type by `pgvector` for vector similarity search for embeddings.

### Do not use the following data types

- DO NOT use `timestamp` (without time zone); DO use `timestamptz` instead.
- DO NOT use `char(n)` or `varchar(n)`; DO use `text` instead.
- DO NOT use `money` type; DO use `numeric` instead.
- DO NOT use `timetz` type; DO use `timestamptz` instead.
- DO NOT use `timestamptz(0)` or any other precision specification; DO use `timestamptz` instead
- DO NOT use `serial` type; DO use `generated always as identity` instead.

## Table Types

- **Regular**: default; fully durable, logged.
- **TEMPORARY**: session-scoped, auto-dropped, not logged. Faster for scratch work.
- **UNLOGGED**: persistent but not crash-safe. Faster writes; good for caches/staging.

## Row-Level Security

**DECIDED for this project** — RLS on `organization_id` is the tenant-isolation mechanism, defense in depth on top of the app-layer filter. Enable with `ALTER TABLE tbl ENABLE ROW LEVEL SECURITY`; set a per-request session var (`SET LOCAL app.tenant_id = '<uuid>'` inside the request transaction — `SET LOCAL` scopes it to the tx, not the whole connection) and write policies: `CREATE POLICY tenant_isolation ON orders FOR SELECT USING (organization_id = current_setting('app.tenant_id')::uuid)`. The app-layer filter (Prisma `organizationId`) stays as a first line; RLS guarantees a leaked query can't cross tenants.

**Operational notes that matter:**
- The **table owner and superuser bypass RLS by default.** Connect the API with a dedicated non-owner role and run `ALTER TABLE tbl FORCE ROW LEVEL SECURITY` so the owner is also subject to the policies.
- **Cross-tenant / superadmin** reads (reports spanning all orgs) need a separate role without the policy, or a policy variant: `USING (organization_id = current_setting('app.tenant_id')::uuid OR current_setting('app.is_superadmin')::boolean)`.
- **Tests** must execute `SET LOCAL app.tenant_id = '<test-uuid>'` (or seed/assume a role) within each tx, otherwise the policy returns zero rows — which is the correct failure mode, not a bug.
- **Indexes** — `(organization_id, ...)` on every tenant-scoped table; RLS still uses the index, so the leading tenant column stays the right choice.

## Constraints

- **PK**: implicit UNIQUE + NOT NULL; creates a B-tree index.
- **FK**: specify `ON DELETE/UPDATE` action (`CASCADE`, `RESTRICT`, `SET NULL`, `SET DEFAULT`). Add explicit index on referencing column—speeds up joins and prevents locking issues on parent deletes/updates. Use `DEFERRABLE INITIALLY DEFERRED` for circular FK dependencies checked at transaction end.
- **UNIQUE**: creates a B-tree index; allows multiple NULLs unless `NULLS NOT DISTINCT` (PG15+). Standard behavior: `(1, NULL)` and `(1, NULL)` are allowed. With `NULLS NOT DISTINCT`: only one `(1, NULL)` allowed. Prefer `NULLS NOT DISTINCT` unless you specifically need duplicate NULLs.
- **CHECK**: row-local constraints; NULL values pass the check (three-valued logic). Example: `CHECK (price > 0)` allows NULL prices. Combine with `NOT NULL` to enforce: `price NUMERIC NOT NULL CHECK (price > 0)`.
- **EXCLUDE**: prevents overlapping values using operators. `EXCLUDE USING gist (room_id WITH =, booking_period WITH &&)` prevents double-booking rooms. Requires appropriate index type (often GiST).

## Indexing

- **B-tree**: default for equality/range queries (`=`, `<`, `>`, `BETWEEN`, `ORDER BY`)
- **Composite**: order matters—index used if equality on leftmost prefix (`WHERE a = ? AND b > ?` uses index on `(a,b)`, but `WHERE b = ?` does not). Put most selective/frequently filtered columns first.
- **Covering**: `CREATE INDEX ON tbl (id) INCLUDE (name, email)` - includes non-key columns for index-only scans without visiting table.
- **Partial**: for hot subsets (`WHERE status = 'active'` → `CREATE INDEX ON tbl (user_id) WHERE status = 'active'`). Any query with `status = 'active'` can use this index.
- **Expression**: for computed search keys (`CREATE INDEX ON tbl (LOWER(email))`). Expression must match exactly in WHERE clause: `WHERE LOWER(email) = 'user@example.com'`.
- **GIN**: JSONB containment/existence, arrays (`@>`, `?`), full-text search (`@@`)
- **GiST**: ranges, geometry, exclusion constraints
- **BRIN**: very large, naturally ordered data (time-series)—minimal storage overhead. Effective when row order on disk correlates with indexed column (insertion order or after `CLUSTER`).

## Partitioning

- Use for very large tables (>100M rows) where queries consistently filter on partition key (often time/date).
- Alternate use: use for tables where data maintenance tasks dictates e.g. data pruned or bulk replaced periodically
- **RANGE**: common for time-series (`PARTITION BY RANGE (created_at)`). Create partitions: `CREATE TABLE logs_2024_01 PARTITION OF logs FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')`. **TimescaleDB** automates time-based or ID-based partitioning with retention policies and compression.
- **LIST**: for discrete values (`PARTITION BY LIST (region)`). Example: `FOR VALUES IN ('us-east', 'us-west')`.
- **HASH**: for even distribution when no natural key (`PARTITION BY HASH (user_id)`). Creates N partitions with modulus.
- **Constraint exclusion**: requires `CHECK` constraints on partitions for query planner to prune. Auto-created for declarative partitioning (PG10+).
- Prefer declarative partitioning or hypertables. Do NOT use table inheritance.
- **Limitations**: no global UNIQUE constraints—include partition key in PK/UNIQUE. FKs from partitioned tables not supported; use triggers.

## Special Considerations

### Update-Heavy Tables

- **Separate hot/cold columns**—put frequently updated columns in separate table to minimize bloat.
- **Use `fillfactor=90`** to leave space for HOT updates that avoid index maintenance.
- **Avoid updating indexed columns**—prevents beneficial HOT updates.
- **Partition by update patterns**—separate frequently updated rows in a different partition from stable data.

### Insert-Heavy Workloads

- **Minimize indexes**—only create what you query; every index slows inserts.
- **Use `COPY` or multi-row `INSERT`** instead of single-row inserts.
- **UNLOGGED tables** for rebuildable staging data—much faster writes.
- **Defer index creation** for bulk loads—>drop index, load data, recreate indexes.
- **Partition by time/hash** to distribute load. **TimescaleDB** automates partitioning and compression of insert-heavy data.
- **Use a natural key for primary key** such as a (timestamp, device_id) if enforcing global uniqueness is important many insert-heavy tables don't need a primary key at all.
- If you do need a surrogate key, **Prefer `BIGINT GENERATED ALWAYS AS IDENTITY` over `UUID`**.

### Upsert-Friendly Design

- **Requires UNIQUE index** on conflict target columns—`ON CONFLICT (col1, col2)` needs exact matching unique index (partial indexes don't work).
- **Use `EXCLUDED.column`** to reference would-be-inserted values; only update columns that actually changed to reduce write overhead.
- **`DO NOTHING` faster** than `DO UPDATE` when no actual update needed.

### Safe Schema Evolution

- **Transactional DDL**: most DDL operations can run in transactions and be rolled back—`BEGIN; ALTER TABLE...; ROLLBACK;` for safe testing.
- **Concurrent index creation**: `CREATE INDEX CONCURRENTLY` avoids blocking writes but can't run in transactions.
- **Volatile defaults cause rewrites**: adding `NOT NULL` columns with volatile defaults (e.g., `now()`, `gen_random_uuid()`) rewrites entire table. Non-volatile defaults are fast.
- **Drop constraints before columns**: `ALTER TABLE DROP CONSTRAINT` then `DROP COLUMN` to avoid dependency issues.
- **Function signature changes**: `CREATE OR REPLACE` with different arguments creates overloads, not replacements. DROP old version if no overload desired.

## Generated Columns

- `... GENERATED ALWAYS AS (<expr>) STORED` for computed, indexable fields. PG18+ adds `VIRTUAL` columns (computed on read, not stored).

## Extensions

- **`pgcrypto`**: `crypt()` for password hashing.
- **`uuid-ossp`**: alternative UUID functions; prefer `pgcrypto` for new projects.
- **`pg_trgm`**: fuzzy text search with `%` operator, `similarity()` function. Index with GIN for `LIKE '%pattern%'` acceleration. (Useful for POS product search.)
- **`citext`**: case-insensitive text type. Prefer expression indexes on `LOWER(col)` unless you need case-insensitive constraints.
- **`btree_gin`/`btree_gist`**: enable mixed-type indexes (e.g., GIN index on both JSONB and text columns).
- **`hstore`**: key-value pairs; mostly superseded by JSONB but useful for simple string mappings.
- **`timescaledb`**: essential for time-series—automated partitioning, retention, compression, continuous aggregates.
- **`postgis`**: comprehensive geospatial support beyond basic geometric types—essential for location-based applications.
- **`pgvector`**: vector similarity search for embeddings.
- **`pgaudit`**: audit logging for all database activity. (This project has an app-level `AuditLog` model — evaluate whether pgaudit adds value during the server extraction.)

## JSONB Guidance

- Prefer `JSONB` with **GIN** index.
- Default: `CREATE INDEX ON tbl USING GIN (jsonb_col);` → accelerates:
  - **Containment** `jsonb_col @> '{"k":"v"}'`
  - **Key existence** `jsonb_col ? 'k'`, **any/all keys** `?|`, `?&`
  - **Path containment** on nested docs
  - **Disjunction** `jsonb_col @> ANY(ARRAY['{"status":"active"}', '{"status":"pending"}'])`
- Heavy `@>` workloads: consider opclass `jsonb_path_ops` for smaller/faster containment-only indexes:
  - `CREATE INDEX ON tbl USING GIN (jsonb_col jsonb_path_ops);`
  - **Trade-off**: loses support for key existence (`?`, `?|`, `?&`) queries—only supports containment (`@>`)
- Equality/range on a specific scalar field: extract and index with B-tree (generated column or expression):
  - `ALTER TABLE tbl ADD COLUMN price INT GENERATED ALWAYS AS ((jsonb_col->>'price')::INT) STORED;`
  - `CREATE INDEX ON tbl (price);`
  - Prefer queries like `WHERE price BETWEEN 100 AND 500` (uses B-tree) over `WHERE (jsonb_col->>'price')::INT BETWEEN 100 AND 500` without index.
- Arrays inside JSONB: use GIN + `@>` for containment (e.g., tags). Consider `jsonb_path_ops` if only doing containment.
- Keep core relations in tables; use JSONB for optional/variable attributes.
- Use constraints to limit allowed JSONB values in a column e.g. `config JSONB NOT NULL CHECK(jsonb_typeof(config) = 'object')`

## Examples

### Users

```sql
CREATE TABLE users (
  user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON users (LOWER(email));
CREATE INDEX ON users (created_at);
```

### Orders

```sql
CREATE TABLE orders (
  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELED')),
  total NUMERIC(10,2) NOT NULL CHECK (total > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON orders (user_id);
CREATE INDEX ON orders (created_at);
```

### JSONB

```sql
CREATE TABLE profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(user_id),
  attrs JSONB NOT NULL DEFAULT '{}',
  theme TEXT GENERATED ALWAYS AS (attrs->>'theme') STORED
);
CREATE INDEX profiles_attrs_gin ON profiles USING GIN (attrs);
```

---

*Source: generic `postgresql-table-design` skill. Adapted with an opinionated project-mapping section that drives the schema toward industry best practice during the migration to `pos-system-server`: UUIDv7 IDs (not cuid), Postgres RLS for tenant isolation, snake_case DB identifiers via `@map`, partial unique indexes `WHERE deleted_at IS NULL` for soft-delete uniqueness, `BEFORE UPDATE` triggers for `updated_at`, `NUMERIC`/Decimal for money (fixing the current `Float` debt), explicit FK indexes, and PG `enum` vs `TEXT`+`CHECK`/lookup by stability of the value set.*