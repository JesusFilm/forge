---
id: "feat-323"
title: "Admin flat Core subtitle sync repair"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-07-31"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "core-sync"
  - "subtitles"
  - "data-integrity"
---

## Problem

Admin production has far fewer active Core-owned subtitles than Core. Core
reports 11,317 subtitle rows, while Admin production reports 3,146 active
Core-owned `VideoSubtitle` rows. JESUS videos such as `1_jf-0-0` and
`1_jf6102-0-0` have English subtitle rows in Core, but Admin returns no active
subtitles for the selected English `ot` edition.

The existing subtitle phase on main fetches subtitles through nested
`videos { subtitles }` pages and uses "not restamped during this run" as delete
authority during full runs. That is unsafe when the nested response is
incomplete, and it does not give incremental sync a way to notice subtitles
missing from Admin but unchanged in Core.

## Entry Points - Read These First

1. `apps/admin/src/services/core-sync/phases/sync-video-subtitles.ts` - flat
   Core subtitle sync, full repair escalation, and verified Core-only delete.
2. `apps/admin/src/services/core-sync/schemas/video-subtitle.ts` - Core payload
   validation for the flat subtitle query.
3. `docs/solutions/integration-issues/core-sync-video-subtitles-soft-delete-wipes-on-incomplete-fetch.md`
   - incident context and destructive-sync constraints.
4. `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`
   - raw SQL array-bind pattern for large ID sets.
5. `docs/solutions/platform/admin-core-sync-entity-coverage.md` - Core identity,
   source ownership, and coverage audit invariants.

## Grep These

- `syncVideoSubtitles`
- `videoSubtitlesCount`
- `core-sync.video-subtitle.full-repair-started`
- `core-sync.video-subtitle.inventory.error`
- `SourceTier`

## What To Build

1. Replace nested `videos { subtitles }` fetching with Core's existing flat
   `videoSubtitles(where, offset, limit)` query.
2. Preserve incremental sync by filtering subtitles on `updatedAt >= since`.
3. Fetch a verified full Core subtitle ID inventory using `videoSubtitlesCount`
   and paginated `videoSubtitles { id }` reads.
4. When a full run executes, or when an incremental run discovers Core IDs
   missing from active Admin Core rows, fetch full subtitle row payloads and
   upsert them before any delete.
5. Soft-delete only active Admin rows with `source = CORE`, non-null `coreId`,
   and `coreId` absent from the verified Core inventory.
6. Never overwrite or delete Manager-owned subtitle rows.
7. Fail closed and skip deletes on Core page errors, parse failures, duplicate
   inventory IDs, count mismatches, unstable inventory reads, or unresolved
   parent relationships.
8. Remove the checksum/manifest consumer and parity dashboard complexity from
   this Forge PR. No JesusFilm/core change is required.

## Constraints

- Do not depend on JesusFilm/core PR #9425.
- Do not perform a manual production database patch or deploy outside the
  normal PR-to-main flow.
- Do not use a phase-wide unstamped-row delete.
- Do not delete Manager-owned or non-Core rows.
- Do not hand-edit generated GraphQL outputs unless the Admin schema changes.

## Verification

- `pnpm --filter @forge/admin test -- sync-video-subtitles.test.ts`
- `pnpm --filter @forge/admin db:generate`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `git diff --check`

## Result

- Replaced the checksum/manifest PR approach with a Forge-only flat
  `videoSubtitles` sync.
- Preserved incremental `updatedAt >= since` updates while escalating to a full
  row-payload repair when verified Core IDs are missing from Admin.
- Replaced the unsafe unstamped-row delete with a verified double-read Core ID
  inventory and a Core-only raw SQL soft-delete predicate.
- Added fail-closed coverage for duplicate/count-mismatch/unstable inventories,
  missing parents, Manager-owned Core-ID collisions, inventory request failures,
  and pagination.
- Verified with focused sync tests, Prisma generate, Admin typecheck, Admin
  lint, and diff hygiene.
