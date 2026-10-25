---
title: "Check-and-claim must be a single atomic UPDATE — raw SQL or Prisma `updateMany`, not split read+write"
category: database-issues
date: 2026-04-14
last_updated: 2026-05-18
tags:
  - postgresql
  - prisma
  - concurrency
  - race-condition
  - toctou
  - admin
  - audit-trail
  - soft-mutate
  - updatemany
problem_type: runtime_error
component: apps/admin/src/services/core-sync/lock.ts
---

## Problem

Any check-and-claim operation — DB-backed lock acquisition, soft-revoke,
archive, status-flip — must atomically test the precondition AND write
the new state in a SINGLE statement. Splitting the precondition check
(`findUnique` / `SELECT`) from the write (`update` / `UPDATE`) across
separate Prisma calls opens a TOCTOU race: two concurrent callers both
see the precondition match, both proceed to write, and the LATER
writer's data silently overwrites the FIRST writer's — destroying audit
trail or producing duplicate claims.

This applies whether you express the operation as:

- `SELECT FOR UPDATE` then `UPDATE` in separate Prisma calls (the
  Core-sync-lock instance below)
- `findUnique` then branch in TypeScript then `update` (the
  PartnerApiKey-revoke instance below)
- Any other pattern where the precondition check and the write are not
  inside the SAME SQL statement

## Why this works

The fix in every case is to push the precondition into the WHERE clause
of a single `UPDATE` statement. Postgres processes such a statement in
two phases:

1. **Row-level lock acquisition.** Postgres locates rows matching the
   WHERE clause and acquires an exclusive row-level lock on each.
   Concurrent writers for the same target row serialize at this point.
2. **Predicate re-evaluation under lock.** After acquiring the lock,
   Postgres re-evaluates the WHERE predicate against the latest committed
   row state. If the precondition is no longer true (because the prior
   lock-holder committed a write that flipped it), the UPDATE matches
   zero rows.

This is documented in Postgres as "EvalPlanQual" — UPDATE statements
re-fetch the target row under lock and re-test the WHERE clause before
writing. `READ COMMITTED` isolation is sufficient because the predicate
re-evaluation happens AFTER the lock, against committed state.

The "first writer wins" semantic is enforced by the database. Application
code only consumes the `count` / `rowCount` discriminator.

---

## Worked instance 1: DB-backed lock (raw SQL)

**File:** `apps/admin/src/services/core-sync/lock.ts`

The Core sync lock originally used three separate Prisma calls:

1. `upsert` to ensure the lock row exists
2. `$queryRaw` with `SELECT FOR UPDATE SKIP LOCKED`
3. `update` to set `heldBy`

Each runs in its own implicit auto-committed transaction. The row-level
lock from step 2 is released when its transaction auto-commits. Between
steps 2 and 3, a concurrent caller can also claim the lock because
`held_by` is still NULL.

### Fix

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

---

## Worked instance 2: idempotent soft-revoke (Prisma typed-client)

**File:** `apps/admin/src/services/partner-api-key.service.ts::revokePartnerKey`
(PR #976, commit `c1aa1e48`)

Operators run `pnpm partner-keys revoke <keyId>` from terminals or via
incident-response automations. The pre-fix shape:

```ts
// BROKEN — TOCTOU race between findUnique and update.
const existing = await prisma.partnerApiKey.findUnique({
  where: { keyId: args.keyId },
  select: { id: true, revokedAt: true },
})
if (!existing) throw new PartnerKeyNotFoundError(args.keyId)
if (existing.revokedAt) {
  return prisma.partnerApiKey.findUniqueOrThrow({
    where: { keyId: args.keyId },
    select: SUMMARY_SELECT,
  })
}
return prisma.partnerApiKey.update({
  where: { keyId: args.keyId },
  data: { revokedAt: new Date(), revokedById: args.revokedById ?? null },
  select: SUMMARY_SELECT,
})
```

Two concurrent revokers both saw `revokedAt === null`, both wrote, and
the second writer's `revokedById` clobbered the first's — erasing the
audit trail of who actually revoked first.

Wrapping the read+branch+write in `prisma.$transaction(...)` does **not**
fix this. At Postgres's default `READ COMMITTED` isolation, two
transactions can each read `revoked_at IS NULL` and each write — the
transaction boundary doesn't hold a row lock across the read-then-write.

### Fix

Push the precondition into the UPDATE statement itself via Prisma's
typed `updateMany` (the typed-client equivalent of the raw-SQL form
above):

```ts
const result = await prisma.partnerApiKey.updateMany({
  where: { keyId: args.keyId, revokedAt: null }, // atomic precondition
  data: {
    revokedAt: new Date(),
    revokedById: args.revokedById ?? null,
  },
})

if (result.count === 0) {
  // count:0 means EITHER the keyId doesn't exist, OR the row was already
  // revoked (we lost the race, or this is a legitimate second call).
  // One additional read disambiguates: present-row => already-revoked,
  // absent-row => not-found.
  const existing = await prisma.partnerApiKey.findUnique({
    where: { keyId: args.keyId },
    select: SUMMARY_SELECT,
  })
  if (!existing) throw new PartnerKeyNotFoundError(args.keyId)
  return existing // idempotent: return existing row unchanged
}

// count:1 means we won the race; return the freshly-revoked row.
return prisma.partnerApiKey.findUniqueOrThrow({
  where: { keyId: args.keyId },
  select: SUMMARY_SELECT,
})
```

Key annotations:

- `where: { keyId, revokedAt: null }` puts the precondition in SQL, not
  TypeScript. Postgres evaluates it under the row lock.
- `updateMany` returns `{ count: number }` — used as the race
  discriminator (1 = won, 0 = lost-or-missing).
- `count === 0` does ONE extra read to distinguish "not found" from
  "already revoked." Only fires on the rare lost-race path.
- `findUniqueOrThrow` after a count:1 is defensive: the row was just
  updated, but a separate hard-delete (none in this schema) could remove
  it. Cheap insurance, typed return.

### Why Prisma's typed `update` won't do

Prisma's typed `update` requires `where` to resolve to a uniquely-
identifying row identifier. Combining the unique `keyId` with the
non-unique `revokedAt: null` predicate is a type error — Prisma exposes
that compound predicate shape only through `updateMany`, which returns
`{ count }` instead of the row. That's why this idiom uses `updateMany`
even when targeting a single row by unique key.

---

## Prevention

For ANY check-and-claim or idempotent soft-mutate operation:

- **Never split the read (check) and write (claim) into separate Prisma
  calls outside an interactive `$transaction` with a held lock.** Read +
  branch + write across separate Prisma calls is always a TOCTOU race
  under `READ COMMITTED` isolation.
- \*\*Prefer atomic `UPDATE ... WHERE precondition` over SELECT FOR UPDATE
  - separate UPDATE.\*\* One statement, one roundtrip, no transaction
    wrapping needed.
- **Raw SQL flavor:** `prisma.$executeRaw` returns `rowCount`; check
  `> 0` for "I won."
- **Prisma typed-client flavor:** `prisma.<Model>.updateMany({ where:
{ id, <state>: <expected> }, data: { ... } })` returns `{ count }`;
  check `=== 0` to detect lost-race-or-missing and disambiguate with one
  follow-up `findUnique`.
- **If you must use `SELECT FOR UPDATE`,** wrap both the SELECT and the
  subsequent write in a single `prisma.$transaction(async (tx) => ...)`
  so the lock survives across statements. Pays an extra roundtrip vs.
  the atomic-UPDATE form — reserve for compound updates that genuinely
  need a held lock.

### Pattern template (Prisma typed-client)

```ts
async function softMutate(id: string, actorId: string | null) {
  const result = await prisma.<Model>.updateMany({
    where: {
      <unique-identifier>: id,
      <state-column>: <expected-state-X>, // atomic precondition
    },
    data: {
      <state-column>: <new-state-Y>,
      <audit-actor-column>: actorId,
      <audit-timestamp-column>: new Date(),
    },
  })

  if (result.count === 0) {
    const existing = await prisma.<Model>.findUnique({
      where: { <unique-identifier>: id },
      select: SUMMARY_SELECT,
    })
    if (!existing) throw new <NotFoundError>(id)
    return existing // idempotent: already-in-state-Y
  }

  return prisma.<Model>.findUniqueOrThrow({
    where: { <unique-identifier>: id },
    select: SUMMARY_SELECT,
  })
}
```

### Test discipline

Every check-and-claim operation MUST have a test that asserts the
lost-race path preserves the FIRST writer's audit fields. Without this
test, the conditional WHERE can be silently deleted in a future refactor
and nothing fails. From
`apps/admin/src/services/partner-api-key.service.test.ts`:

```ts
it("concurrent second-revoke loses the race and does NOT overwrite revokedById", async () => {
  // First writer already committed: revoked_at set, revoked_by_id = userA.
  // Second writer's conditional updateMany returns count:0; the
  // re-read surfaces userA's revoke unchanged.
  mockPrisma.partnerApiKey.updateMany.mockResolvedValueOnce({ count: 0 })
  mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce(
    buildRow({
      revokedAt: new Date("2026-05-18T11:00:00Z"),
      revokedById: "userA",
    }),
  )

  const result = await revokePartnerKey(
    { keyId: "ABCDEFGHJKLM", revokedById: "userB" },
    mockPrisma as never,
  )

  // userA's revocation wins; userB's revokedById is NOT written.
  expect(result.revokedById).toBe("userA")
})
```

Pair it with a happy-path assertion that locks in the conditional WHERE:

```ts
const arg = mockPrisma.partnerApiKey.updateMany.mock.calls[0]![0]!
expect(arg.where).toEqual({
  keyId: "ABCDEFGHJKLM",
  revokedAt: null, // <-- conditional WHERE locked in
})
expect(mockPrisma.partnerApiKey.update).not.toHaveBeenCalled()
```

This is a mocked-shape test — it proves the BRANCH SHAPE (count:0 →
re-read → return existing) but not the SQL-level race itself. The SQL
race is guaranteed by Postgres semantics; the test guarantees the
application doesn't accidentally route count:0 to a clobbering path.

### Review checklist for soft-mutate service functions

- [ ] Does the operation have a "from state X" precondition (`revokedAt
IS NULL`, `archivedAt IS NULL`, `status = 'pending'`, etc.)?
- [ ] If yes: is the precondition inside the WHERE of an `updateMany`
      (atomic) or inside a TypeScript `if` (TOCTOU)?
- [ ] If `updateMany`: does the `count === 0` branch disambiguate
      not-found vs. already-transitioned with a follow-up read?
- [ ] Is there a test asserting the conditional WHERE shape (`where:
{ id, <state>: <expected-X> }`)?
- [ ] Is there a test asserting the lost-race path returns the FIRST
      writer's audit fields unchanged?
- [ ] Is `prisma.<Model>.update` NOT called in the happy path (would
      bypass the precondition)?

## When to use this pattern

- **DB-backed locks.** Worker-process claims, scheduler leader election,
  exclusive job acquisition — `held_by IS NULL → SET held_by = $worker`.
- **Soft-revoke / soft-delete.** `revokedAt`, `deletedAt`, `disabledAt`
  — flipping `NULL → timestamp` atomically with audit-actor capture.
- **Archive / unarchive.** Lifecycle transitions where the actor must
  be recorded.
- **Status-flip operations.** `status = 'pending' → 'claimed'`. The
  `count: 1` from `updateMany` IS the claim token.
- **Idempotent state transitions** in general: any operation specified
  as "if already in target state, return unchanged; otherwise transition
  - record actor."

## When NOT to use this pattern

- **Hard-delete operations.** `DELETE FROM` already has "matches zero
  rows" semantics when the row is gone. Use `deleteMany` and inspect
  `count` if you need idempotency, but the audit-trail concern doesn't
  apply because there's no row left.
- **Operations where "last writer wins" is the correct semantic.**
  `last_seen_at` heartbeats, cache-invalidation timestamps, telemetry
  rollups. Adding a conditional WHERE would block legitimate updates.
- **Computed-update operations.** `balance = balance - amount` needs
  arithmetic in SQL (`UPDATE accounts SET balance = balance - $1 WHERE
balance >= $1`) or `SELECT FOR UPDATE` in a transaction. The
  conditional WHERE here only checks fixed-value preconditions.
- **Compound atomic updates across multiple tables.** Use
  `prisma.$transaction([...])` with raw `$executeRaw` and conditional
  WHERE per row. The single-statement pattern only solves the single-row
  race.

## Related learnings

- `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`
  — sibling pattern at a different storage layer. In-memory atomic
  claims (idempotency maps, semaphores). The DB-row pattern documented
  here is the equivalent when the claim must survive across replicas /
  processes.
- `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
  — workflow-status-row as a lock. "Claim lock synchronously before
  `after()`." Same check-and-claim shape applied to a long-running job.
- `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`
  — different problem (bulk-write idempotence via `ON CONFLICT`); shares
  the "atomic write semantics over check-then-write" theme.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — META rule that mocked tests prove BRANCH SHAPE while real fixtures
  prove PRODUCTION CONTRACT. The concurrent-second-loses test here is a
  mocked-shape test; the real-DB contract (Postgres row-lock + predicate
  re-evaluation) is guaranteed by database semantics, not by tests.
- `apps/admin/CLAUDE.md` — "Core sync — video-dubs phase" documents the
  raw-SQL sibling for batch-scope soft-delete: `UPDATE "video_dub" SET
"deleted_at" = NOW() WHERE "source" = 'core' AND "deleted_at" IS NULL
AND ...` via `prisma.$executeRaw`. Same idiom, batch-scope.
- `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
  — parent surface for the partner-key admin pipeline; revoke is
  operationally part of partner-key management.
