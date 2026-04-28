---
title: "Prisma `$transaction({ timeout: 5_000 })` is the wrong tool for per-row bulk work"
category: database-issues
date: 2026-04-28
tags:
  - prisma
  - transactions
  - bulk-write
  - core-sync
  - admin
  - railway
  - postgres
problem_type: database_issue
component: database
root_cause: wrong_api
resolution_type: code_fix
severity: high
---

# Prisma `$transaction({ timeout: 5_000 })` is the wrong tool for per-row bulk work

## Problem

Wrapping a long upsert loop in Prisma's interactive
`$transaction(async tx => { for (const row of rows) await tx.x.upsert(...) }, { timeout: 5_000 })`
sets a hard ceiling on the *combined* round-trip time for every
upsert in the loop. Once the loop exceeds the timeout (5s by default),
**every subsequent statement in that transaction fails with
`Transaction API error: Transaction not found`** — the transaction
ID has been closed and the connection released. With Postgres over
Railway's proxy, ~5-10ms per upsert × 500 rows ≈ 5s with zero margin,
so every page hits the ceiling and writes zero rows.

## Symptoms

- `triggerSync` (or any per-page bulk write inside an interactive
  transaction) reports `errors > 0`, `updated: 0` per phase.
- Railway logs show repeated:
  ```
  prisma:error
  Invalid `prisma.<model>.upsert()` invocation:
  Transaction API error: Transaction not found.
  Transaction ID is invalid, refers to an old closed transaction
  Prisma doesn't have information about anymore, or was obtained
  before disconnecting.
  ```
- The errors are spaced ~4-6 seconds apart (one per page that hit
  the timeout). Total run time is the timeout × pages until the loop
  decides to break.
- The unit test suite passes — every test mocks `$transaction` and
  the per-row upsert.
- The deploy succeeds — the failure is invisible until the mutation
  is invoked against real data.
- Discovered during the R1 prod smoke on 2026-04-27 against admin's
  Core sync, which had been "shipped" status since the unit landed
  but had never run end-to-end against prod Core data.

## What Didn't Work

- **Bumping the timeout**: a band-aid that masks the architectural
  problem. The interactive-transaction model isn't built for this
  workload — even a 60s ceiling fails once the catalog grows.
- **Reducing PAGE_SIZE**: cuts the per-page risk but multiplies the
  number of pages, increasing total round-trip count. Doesn't change
  the rate-of-work limit.
- **Adding more unit tests around the transaction**: each new test
  also mocks `$transaction`, so the failure mode stays invisible.

## Solution

Replace the per-row loop with a single bulk SQL statement that
commits in one round-trip and is atomic without an enclosing
transaction. See the companion doc
`docs/solutions/best-practices/prisma-bulk-upsert-pattern-20260428.md`
for the full pattern. The TL;DR:

```ts
// Before — every page hits the 5s ceiling, every page fails:
await prisma.$transaction(
  async (tx) => {
    for (const row of pageRows) {
      await tx.entity.upsert({
        where: { coreId: row.id },
        create: { ... },
        update: { ... },
      })
    }
  },
  { timeout: 5_000 },
)

// After — one statement per page, sub-second:
const rowTuples = pageRows.map(
  (row) =>
    Prisma.sql`(${newRowId()}, ${row.id}, ${row.value}, ${now}, ${now})`,
)
const affected = await prisma.$executeRaw(
  Prisma.sql`
    INSERT INTO "entity" ("id", "core_id", "value", "synced_at", "updated_at")
    VALUES ${Prisma.join(rowTuples, ", ")}
    ON CONFLICT ("core_id") DO UPDATE SET
      "value"      = EXCLUDED."value",
      "synced_at"  = EXCLUDED."synced_at",
      "updated_at" = EXCLUDED."updated_at",
      "deleted_at" = NULL
  `,
)
stats.updated += Number(affected)
```

For multi-statement sequences that need cross-statement atomicity
(e.g. parent-then-child inserts where step 2's failure should roll
back step 1), wrap the **statements** — not a per-row loop — in
`$transaction({ timeout: 30_000 })`. Each statement is sub-second, so
a 30s ceiling has plenty of headroom.

## Why This Works

Three properties matter:

1. **One statement, one round-trip.** The bulk
   `INSERT … ON CONFLICT DO UPDATE` is a single SQL statement that
   Postgres executes atomically. There's no per-row network
   round-trip; the entire 500-row batch ships in one bind message
   (subject to Postgres's 65535 bind-param limit, which is plenty of
   headroom for sane page sizes).

2. **Atomicity without an interactive transaction.** A single SQL
   statement is implicitly atomic — Postgres either applies the
   whole INSERT or none of it. No `BEGIN`/`COMMIT` needed, so no
   timeout pressure from holding a transaction open.

3. **Connection pool pressure goes down, not up.** Interactive
   transactions hold a connection for the duration of the loop
   (potentially many seconds). A single statement releases the
   connection in milliseconds. Concurrent syncs and other workloads
   are no longer starved.

## Prevention

- **Default rule**: if your transaction body contains a `for` loop of
  Prisma calls and the loop body issues an `await tx.x.<op>(...)`,
  you have a per-row bulk-work-in-interactive-transaction pattern.
  Either rewrite it as a single SQL statement, or batch via
  `tx.x.createMany`/`tx.x.updateMany` (which compile to single SQL
  statements). Reserve interactive transactions for **fixed-N**
  cross-statement work where N is small and bounded (e.g. "insert
  parent then insert exactly one child").

- **End-to-end smoke is mandatory** for any unit that issues bulk
  writes against external data. Unit tests that mock the transaction
  cannot detect this failure mode — the broken behaviour only
  manifests with real network latency × real row counts. See
  `docs/solutions/best-practices/end-to-end-smoke-required-for-cross-app-infra-20260427.md`.

- **Watch for `Transaction not found` in Railway logs**. If you see
  it once, you'll see it on every run — it's not transient. Alert
  on the structured event regardless of severity.

- **Don't reach for `{ timeout: <bigger> }` first.** It compounds
  the problem (longer-held connections, longer wait before the
  failure surfaces). Restructure the work instead.

## Related

- `docs/solutions/best-practices/prisma-bulk-upsert-pattern-20260428.md`
  — the bulk-INSERT pattern that replaces this anti-pattern.
- `docs/solutions/best-practices/end-to-end-smoke-required-for-cross-app-infra-20260427.md`
  — why a unit test passing isn't enough.
- `docs/solutions/cms/core-sync-per-page-upsert-pattern.md` — cms's
  paged-upsert design (predecessor to admin's port).
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
  — how to lock the raw-SQL clauses against drift.
- PR #846 in JesusFilm/forge — the fix that established this learning.
