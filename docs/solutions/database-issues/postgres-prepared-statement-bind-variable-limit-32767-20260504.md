---
title: Prisma `notIn` / `in` with large arrays trips the observed 32,767 bind-variable limit
date: 2026-05-04
last_updated: 2026-09-29
category: database-issues
module: apps/admin, apps/auth
problem_type: database_issue
component: database
root_cause: wrong_api
resolution_type: code_fix
severity: high
symptoms:
  - "Prisma reports too many bind variables in a prepared statement when a filter set grows past the driver limit."
applies_when:
  - Calling `prisma.<model>.findMany|updateMany|deleteMany({ where: { <field>: { in|notIn: [...] }}})`
    with an array whose length can exceed ~32,000 entries.
  - Building a Prisma `OR` filter with one clause per row in a persistent, growing set.
  - Soft-delete tails of paginated sync phases that build a "seen" set across all pages.
  - Bulk imports / cleanup jobs that take an in-memory ID list and want to persist a derived set.
tags:
  - postgres
  - prisma
  - bind-variables
  - prepared-statement
  - pg-int16-max
  - notIn
  - array-binding
  - core-sync
related:
  - docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md
  - docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md
  - docs/solutions/cms/core-sync-incremental-delta-sync.md
  - docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md
---

# Prisma `notIn` / `in` with large arrays trips the observed 32,767 bind-variable limit

## Problem

This repository observed Prisma rejecting generated prepared statements above **32,767** bound values. [PostgreSQL's documented query-parameter limit is 65,535](https://www.postgresql.org/docs/17/limits.html), so 32,767 is the observed limit of this Prisma call path, not a universal PostgreSQL limit. Prisma's `{ field: { in: [...] }}` and `{ field: { notIn: [...] }}` translate to `field IN ($1, $2, …, $N)` / `field NOT IN ($1, $2, …, $N)` — one bind variable per array element. A call that hands Prisma a larger array fails before the statement executes:

```
Assertion violation on the database: too many bind variables in prepared statement,
expected maximum of 32767, received 209300
```

Hit in `apps/admin`'s Core sync `video-dubs` phase soft-delete tail at 209k seen IDs (one per dub). The phase aborts; soft-delete never runs; Core-side deletions stop being mirrored.

## Symptoms

- `Invalid prisma.<Model>.<op>() invocation` followed by `too many bind variables in prepared statement, expected maximum of 32767, received <N>`.
- `<N>` is exactly the array length you handed `in` / `notIn`.
- Reproduces deterministically the moment your "seen" set crosses ~32,000 entries; healthy on smaller catalogues.
- The mocked unit tests for the call site stay green because mocks don't enforce Postgres's parameter limit.

## What didn't work

- **Smaller batch size on the upstream loop.** The bind-var cap is on the _cleanup_ call, which gets the union of every page's IDs. Lowering `PAGE_SIZE` doesn't shrink the seen-set.
- **`Promise.all` chunking the `notIn` array into `Math.ceil(seenIds.length / 30000)` separate `updateMany` calls.** Works mechanically but loses transactional atomicity (a partial chunk crash leaves a half-mutated table) and multiplies round-trips. Acceptable as an emergency hack; not the right shape for a permanent fix.
- **Raising any Prisma timeout / connection pool setting.** The generated statement still contains the same number of bound values; timeout and pool settings do not reduce that count.

## Solution

Bind the ID set as a **single PG array literal** and cast inline. One bind variable holds the entire list regardless of size.

```ts
import { toPgArray } from "@/db/pgvector"

// Before — blows up at >32,767 IDs:
await prisma.videoDub.updateMany({
  where: {
    source: "core",
    deletedAt: null,
    coreId: { notIn: [...seenCoreIds] },
  },
  data: { deletedAt: new Date() },
})

// After — one bind variable, any catalogue size:
const seenIdsLiteral = toPgArray(Array.from(seenCoreIds))
const affected = await prisma.$executeRaw`
  UPDATE "video_dub"
  SET    "deleted_at" = NOW()
  WHERE  "source"     = 'core'
    AND  "deleted_at" IS NULL
    AND  NOT ("core_id" = ANY(${seenIdsLiteral}::text[]))
`
```

`toPgArray` (in `apps/admin/src/db/pgvector.ts`) builds the canonical Postgres array literal `{val1,val2,…}` with quote/escape handling. The `${seenIdsLiteral}::text[]` cast is the PG18-on-Railway idiom required because `?::jsonb::text[]` is not supported (per root `CLAUDE.md`).

## Why this works

Prisma's tagged-template `$executeRaw` interpolates each `${value}` as a single bind variable, then sends the raw SQL with `$1`, `$2`, … placeholders. Whether the value is a number, string, or 5 MB array literal, it counts as **one** parameter. The `text[]::ANY()` membership test is evaluated server-side from that single literal — no per-element parameter expansion.

By contrast, Prisma's high-level `{ in: [...] }` / `{ notIn: [...] }` operators _generate_ the placeholder list `($1, $2, …, $N)` because that's how `IN` clauses normally bind. The high-level path is convenient for small sets and dangerous for large ones with no warning at the type level.

## Prevention

1. **Treat any `{ in: [...] }` or `{ notIn: [...] }` whose array length is unbounded by request shape as a latent bug.** If the array can grow with corpus size, use the array-bound raw SQL pattern instead.
2. **Add a regression test that asserts call shape, not just rows mutated** — see `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`. Check the SQL contains `= ANY` and `text[]` and that `mock.calls[0]` has exactly one bound param. A mocked Prisma `updateMany` cannot reproduce the bind-var failure; only the SQL-shape invariant catches a regression to the high-level operator.
3. **At the point of any new `$executeRaw` against an enum-typed column**, verify the literal case matches the DB enum value (see `docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md`). The bind-var fix and the enum-case fix are independent gotchas that often surface together because both arise the moment you switch from Prisma's high-level API to raw SQL.
4. **Consider a temp-table alternative for complex predicates** — `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md` covers the heavyweight cousin pattern for cases where the predicate is more than a single-column membership test.

### Test-shape recipe

```ts
const call = prisma.$executeRaw.mock.calls[0] as [
  ReadonlyArray<string>,
  ...unknown[],
]
const [strings, ...values] = call
const sql = strings.join(" ")

expect(sql).toContain("= ANY")
expect(sql).toContain("text[]")
expect(sql).toMatch(/NOT\s*\(/i)
expect(values).toHaveLength(1)
expect(typeof values[0]).toBe("string")
```

The `values.length === 1` assertion is the single most important regression guard: it locks in "one bound param regardless of catalogue size."

## Case-insensitive lookup over retained approvals (PR #2457)

The Changelog People directory had the same growth shape on a read path: it built one case-insensitive Prisma `OR` clause per pending preapproval. An approval remains in `pending` state when its expiry time passes; the response derives an `expired` display state instead (`apps/auth/src/services/changelog-people.service.ts:65` and `apps/auth/src/services/changelog-people.service.ts:108`). Old approvals therefore still increased the lookup's predicate count. This was a preventive fix; a production timeout or bind-limit failure was not observed.

The fix deduplicates normalized addresses, binds them as one JSON value, and expands them inside PostgreSQL for indexed lookup (`apps/auth/src/services/changelog-people.service.ts:69-90`):

```ts
const emails = [
  ...new Set(approvals.map(({ email }) => email.trim().toLowerCase())),
]
const recipients = emails.length
  ? await tx.$queryRaw`
      SELECT u.id, u.email
      FROM "user" AS u
      WHERE lower(u.email) = ANY(ARRAY(
        SELECT jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb)
      ))
        AND u.actor_type = 'human' AND u.email_verified = true
    `
  : []
```

The email set uses one bound parameter regardless of approval count; the timestamp is a separate, fixed parameter in the full query. The companion migration adds an index on `lower(email)`; the existing unique index on the original email column does not serve this case-insensitive expression (`apps/auth/prisma/migrations/20260929000000_changelog_people_email_lookup/migration.sql:1`). A disposable PostgreSQL run confirmed the lookup and the concurrent index migration, and the Changelog integration suite passed. When moving this kind of Prisma filter to raw SQL, check `@map`'d enum literals against the database values: the first real-DB run caught `HUMAN` where PostgreSQL stores `human`, exactly the seam documented in the related enum learning.

## Related learnings

- The umbrella fan-out doc this surfaced from: `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`.
- Soft-delete safety rule (the one that gates whether we even reach the bind-var-fixed code path): `docs/solutions/cms/core-sync-incremental-delta-sync.md`.
- Why mocked tests can't catch this class on their own: `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`.
