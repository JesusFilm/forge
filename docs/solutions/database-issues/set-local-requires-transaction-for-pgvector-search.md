---
title: "PostgreSQL SET LOCAL with Prisma requires transaction scope and set_config for dynamic values"
category: database-issues
date: 2026-04-14
last_updated: 2026-06-28
module: apps/admin
problem_type: database_issue
component: database
symptoms:
  - "SET LOCAL outside an explicit Prisma transaction expires before the search query"
  - "Parameterized SET LOCAL through Prisma can fail with syntax error at or near $1"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - postgresql
  - pgvector
  - prisma
  - admin
---

# PostgreSQL SET LOCAL with Prisma requires transaction scope and set_config for dynamic values

## Problem

PostgreSQL session settings for pgvector search have two Prisma-specific
failure modes. First, `SET LOCAL` only affects the current transaction, so a
standalone Prisma call expires before the following search query. Second,
Postgres utility statements such as `SET LOCAL hnsw.ef_search = $1` do not
accept bind placeholders in the value position, so Prisma tagged templates can
turn a transaction-scoped fix into a syntax error.

## Symptoms

- A pgvector setting call before the search query appears to succeed, but the
  following query runs without the intended setting.
- The Admin HNSW prototype returned zero results and logged
  `ERROR: syntax error at or near "$1"` before the timed retrieval query ran.
- Timing reports can look fast when the retriever rejected early; count those as
  failed retrievals, not search speed wins.

## What Didn't Work

### Standalone `SET LOCAL`

The original pgvector search service set `hnsw.ef_search` via a separate Prisma
call before the search query:

```ts
await this.prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = 40`)
await this.prisma.$queryRaw`SELECT ... ORDER BY embedding <=> ...`
```

This silently did nothing because each Prisma call runs in its own
auto-committed implicit transaction and may use a different pooled connection.

### Parameterized `SET LOCAL` inside the transaction

Wrapping the calls in an interactive transaction fixed the connection and
transaction scope, but this shape can still fail:

```ts
await tx.$executeRaw`SET LOCAL hnsw.ef_search = ${safeEfSearch}`
```

Prisma binds the interpolated value as a placeholder, producing a utility
statement shape like `SET LOCAL hnsw.ef_search = $1`. Postgres rejects that
shape with `syntax error at or near "$1"`.

## Root cause

PostgreSQL local settings are transaction-scoped, while Prisma raw-query calls
outside `$transaction` are separate statements on pooled connections. For
dynamic values, Prisma's safe interpolation creates bind placeholders, but
PostgreSQL does not support placeholders in the `SET LOCAL` utility statement
position used for pgvector settings.

## Solution

Wrap the setting calls and the search query in one Prisma interactive
transaction. When the setting value is dynamic or you want to stay fully
parameterized, use PostgreSQL's `set_config(name, value, is_local)` function
instead of `SET LOCAL`:

```ts
type PgSetConfigRow = { set_config: string }

async function setLocalHnswConfig(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  name: string,
  value: string,
): Promise<void> {
  await tx.$queryRaw<PgSetConfigRow[]>`
    SELECT set_config(${name}, ${value}, true)
  `
}

const hits = await prisma.$transaction(async (tx) => {
  await setLocalHnswConfig(tx, "hnsw.ef_search", String(safeEfSearch))

  return tx.$queryRaw<SearchHit[]>`
    SELECT el.id, el.embedding <=> ${pgVector}::vector AS distance
    FROM experience_locale el
    ...
    ORDER BY distance
    LIMIT ${limit}
  `
})
```

The interactive transaction ensures the setting and query share one connection
and transaction. `set_config(..., true)` gives the same local lifetime as
`SET LOCAL`, while still allowing Prisma to bind the setting name and value
safely.

## Prevention

Any time you need a PostgreSQL session-level setting to apply to a
subsequent query (`SET LOCAL`, `SET search_path`, `SET statement_timeout`, or
pgvector HNSW knobs):

- Always wrap both statements in `prisma.$transaction(async (tx) => ...)`
- For dynamic setting values, prefer `SELECT set_config(${name}, ${value}, true)`
  over interpolated `SET LOCAL ... = ${value}`
- Reserve literal `SET LOCAL` strings for fully static, trusted statements
- Add tests that assert the setting call is inside the transaction and that the
  timed query actually runs after the setting calls
- Treat fast zero-result timing from a rejected retriever as a failed
  experiment, not a performance improvement

## Related

- `apps/admin/src/services/experience.search.ts` — the fixed search
- `apps/admin/src/services/hybrid-search-retrievers.ts` — HNSW prototype uses
  transaction-local `set_config` for pgvector tuning
- `docs/solutions/performance-issues/admin-semantic-hnsw-prototype-parity-gate.md`
- PostgreSQL docs on `SET LOCAL` and `set_config`
