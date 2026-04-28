---
title: "Soft-delete `notIn: [...seenCoreIds]` is an anti-pattern at scale — use a `synced_at` watermark instead"
category: performance-issues
date: 2026-04-28
tags:
  - prisma
  - postgres
  - bind-parameter-limit
  - soft-delete
  - sync
  - core-sync
  - admin
problem_type: performance_issue
component: database
root_cause: wrong_api
resolution_type: code_fix
severity: medium
---

# Soft-delete `notIn: [...seenCoreIds]` is an anti-pattern at scale

## Problem

Per-page sync workflows commonly track every coreId observed during
the run in a `seenCoreIds: Set<string>`, then sweep at the end with:

```ts
await prisma.<entity>.updateMany({
  where: {
    source: "CORE",
    coreId: { notIn: [...seenCoreIds] },
    deletedAt: null,
  },
  data: { deletedAt: new Date() },
})
```

Prisma serializes `notIn: [...]` as `NOT IN ($1, $2, ...)` with one
bound parameter per element. **Postgres's bind-parameter limit is
65535**. Once the catalog grows past ~50K rows for a given entity,
this query approaches and then exceeds the limit, raising
`bind message supplies N parameters, but prepared statement requires
no more than 65535` at the protocol layer — the soft-delete sweep
silently fails (or, depending on Prisma version, surfaces as an
opaque error after the bulk write phase has already committed).

This is a real risk for admin's `sync-videos` and `sync-dubs` phases
once the JFP catalog finishes syncing into admin's empty Postgres.

## Symptoms

- The sync's per-phase stats look healthy (`updated > 0, errors: 0`)
  but the soft-delete sweep at the end of the phase silently fails
  or returns 0 rows where you expected non-zero.
- Catalog drift accumulates: rows that should be soft-deleted (e.g.
  videos no longer present in Core) remain `deletedAt: null`
  because every sync run silently drops the sweep.
- At the protocol layer (visible only with Prisma debug logging on):
  `bind message supplies N parameters, but prepared statement
  requires no more than 65535`.

## Solution

**Invert the sweep**: instead of "delete rows whose coreId isn't in
the set we just saw", capture a `runStartedAt` timestamp at the top
of the phase, ensure every successful upsert bumps `synced_at` to
≥ runStartedAt (which the bulk INSERT … ON CONFLICT pattern already
does via `EXCLUDED.synced_at`), and sweep:

```ts
const runStartedAt = new Date()

// ... pages of bulk INSERT … ON CONFLICT DO UPDATE that all bump
//     synced_at = EXCLUDED.synced_at to runStartedAt or later ...

// Soft-delete sweep — parameterless w.r.t. the seen set.
const result = await prisma.<entity>.updateMany({
  where: {
    source: "CORE",
    syncedAt: { lt: runStartedAt },
    deletedAt: null,
  },
  data: { deletedAt: new Date() },
})
stats.softDeleted += result.count
```

Three bound parameters total (`source`, `syncedAt`, `deletedAt`),
constant regardless of catalog size.

This is the same pattern the manager backfill worker uses to track
progress — see
`docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
("output table as progress tracker").

## Why This Works

- **Bind-parameter count is O(1) instead of O(N).** No matter how
  many rows are in the catalog, the sweep is three parameters.
  Cannot exceed Postgres's 65535 limit.
- **Semantically equivalent.** "Rows whose `synced_at` is older than
  the run start" === "rows the run did not touch." The bulk INSERT
  bumps `synced_at` on every UPDATE branch (via `EXCLUDED.synced_at`),
  so any row the sync wrote has a fresh `synced_at`. Untouched rows
  keep their old timestamp.
- **Survives mid-run interruption gracefully.** If the run aborts
  mid-way, only the rows it managed to write get a fresh `synced_at`.
  The sweep is gated on `stats.errors === 0`, so it doesn't fire on
  a failed run — but if a future operator wants to run a
  conservative sweep manually, they can do it with a known-safe
  `runStartedAt` value.
- **Plays nicely with parallel writers.** If two sync runs overlap
  (which the orchestrator's lock prevents but is worth noting),
  each run's `runStartedAt` boundary is correctly scoped to that
  run.

## Constraints

- **Every successful upsert MUST bump `synced_at`.** This is already
  the case for the bulk-upsert pattern in
  `docs/solutions/best-practices/prisma-bulk-upsert-pattern-20260428.md`,
  but if a future code path skips the SET clause (e.g. a "no-op"
  update branch), rows it touched would falsely appear stale.
- **Concurrent non-sync writers must not lower `synced_at`.** The
  invariant assumes `synced_at` only ever moves forward. Editor
  flows that update other columns must leave `synced_at` alone.
- **The soft-delete sweep is still gated on `stats.errors === 0`.**
  A partial-failure run shouldn't sweep; otherwise rows that the
  failed page would have touched get incorrectly tombstoned. The
  watermark inversion changes the *query*, not the *gating*.

## Status

**Identified during ce:review of PR #846 (2026-04-28); not yet
implemented.** Admin's current Core sync phases all use the
`notIn: [...seenCoreIds]` shape inherited from the legacy code.
The risk surfaces only at scale (after Core sync runs against a
populated catalog of 50K+ rows per entity); current admin prod is
empty so the failure isn't yet observable. Tracked as a follow-up
to the bulk-upsert PR.

## Prevention

- **When you write a soft-delete sweep, ask: "could the seen set
  ever exceed 50K elements?"** If yes, use the watermark pattern
  from day one. The `notIn` shape is fine for fixed small
  reference sets (e.g. ~200 countries) but not for content
  catalogs.
- **Keep `synced_at` strictly forward-only.** Document this as an
  invariant in the schema/CLAUDE.md so editor flows don't
  accidentally rewind it.
- **When porting an existing sync that uses `notIn`, audit the
  expected catalog size.** The cms predecessor pattern
  (`docs/solutions/cms/core-sync-per-page-upsert-pattern.md`)
  doesn't call this out — it works at cms's scale but doesn't
  scale to admin's eventual catalog.

## Related

- `docs/solutions/best-practices/prisma-bulk-upsert-pattern-20260428.md`
  — companion pattern; the bulk-INSERT's `EXCLUDED.synced_at` is
  what makes the watermark approach work.
- `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
  — manager uses the same "output table as progress tracker"
  shape (different surface, same idea).
- `docs/solutions/cms/core-sync-per-page-upsert-pattern.md` — cms
  predecessor that uses the `notIn` shape; works at cms scale,
  doesn't generalize.
- PR #846 in JesusFilm/forge — the bulk-upsert refactor where
  this risk was identified but deferred. The five phase files
  (`apps/admin/src/services/core-sync/phases/sync-{languages,
  countries,keywords,videos,dubs}.ts`) all currently use the
  `notIn` shape; videos and dubs are the highest-risk callers.
