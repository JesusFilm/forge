---
title: "PostgreSQL SET LOCAL has no effect outside a transaction — wrap with $transaction for pgvector ef_search tuning"
category: database-issues
date: 2026-04-14
tags:
  - postgresql
  - pgvector
  - prisma
  - admin
problem_type: runtime_error
component: apps/admin/src/services/experience.search.ts
---

## Problem

The pgvector search service set `hnsw.ef_search` (recall tuning) via a
separate Prisma call before the search query:

```ts
await this.prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = 40`)
await this.prisma.$queryRaw`SELECT ... ORDER BY embedding <=> ...`
```

This silently did nothing. `SET LOCAL` only persists within an explicit
transaction block. Outside a transaction, each Prisma call runs in its
own auto-committed implicit transaction, and the SET LOCAL expired
immediately. The two calls also ran on potentially different pooled
connections.

## Root cause

PostgreSQL docs: "SET LOCAL can only be used inside a transaction block;
otherwise it has no effect, since the transaction would end immediately."

Prisma's `$executeRaw` and `$queryRaw` each acquire a connection from the
pool, run one statement, then release. Without an explicit `$transaction`,
the SET LOCAL's scope is a single auto-committed statement.

## Solution

Wrap both the SET LOCAL and the search query in a Prisma interactive
transaction:

```ts
const hits = await this.prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SET LOCAL hnsw.ef_search = ${safeEfSearch}`
  return tx.$queryRaw<SearchHit[]>`
    SELECT el.id, el.embedding <=> ${pgVector}::vector AS distance
    FROM experience_locale el
    ...
    ORDER BY distance
    LIMIT ${limit}
  `
})
```

The interactive transaction ensures both statements run on the same
connection within the same transaction block, so SET LOCAL applies to the
search query.

## Prevention

Any time you need a PostgreSQL session-level setting to apply to a
subsequent query (SET LOCAL, SET search_path, SET statement_timeout):

- Always wrap both statements in `prisma.$transaction(async (tx) => ...)`
- Never rely on separate `$executeRaw` + `$queryRaw` calls outside a
  transaction — they may not even hit the same connection

## Related

- `apps/admin/src/services/experience.search.ts` — the fixed search
- PostgreSQL docs on SET LOCAL
