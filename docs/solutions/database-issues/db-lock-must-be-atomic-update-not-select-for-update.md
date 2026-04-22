---
title: "DB-backed lock must use atomic UPDATE WHERE, not separate SELECT FOR UPDATE + UPDATE"
category: database-issues
date: 2026-04-14
tags:
  - postgresql
  - prisma
  - concurrency
  - admin
problem_type: runtime_error
component: apps/admin/src/services/core-sync/lock.ts
---

## Problem

The Core sync lock used three separate Prisma calls:

1. `upsert` to ensure the lock row exists
2. `$queryRaw` with `SELECT FOR UPDATE SKIP LOCKED`
3. `update` to set `heldBy`

Each runs in its own implicit auto-committed transaction. The row-level
lock from step 2 is released when its transaction auto-commits. Between
steps 2 and 3, a concurrent caller can also claim the lock because
`held_by` is still NULL.

## Solution

Single atomic UPDATE:

```ts
const claimed = await prisma.$executeRaw`
  UPDATE sync_locks
  SET held_by = ${heldBy}, acquired_at = NOW()
  WHERE key = ${LOCK_KEY} AND held_by IS NULL
`
return claimed > 0
```

The UPDATE's WHERE clause atomically checks and claims in one statement.
No SELECT FOR UPDATE needed.

## Prevention

For any DB-backed lock or optimistic concurrency:

- Never split the read (check) and write (claim) into separate Prisma
  calls outside an interactive `$transaction`
- Prefer atomic `UPDATE ... WHERE condition` over SELECT FOR UPDATE +
  separate UPDATE
- If you must use SELECT FOR UPDATE, wrap both the SELECT and the
  subsequent write in a single `prisma.$transaction(async (tx) => ...)`
