---
id: "feat-192"
title: "Admin Video Relation Order Backfill"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-06-15"
duration: 1
depends_on:
  - "feat-190"
blocks: []
tags:
  - platform
  - admin
  - core-sync
  - watch-page
  - data-contract
---

## Problem

`feat-190` shipped the code path that preserves Core child-video order in
`VideoRelation.order`, but the original production backfill path still asks an
operator to run a full `videos` Core sync. That job touches every published
video and can exceed SSH/session patience or production pool budgets even
though the Watch ordering repair only needs existing parent-child relation
rows updated.

## Entry Points -- Read These First

1. `docs/plans/2026-06-15-004-fix-relation-order-backfill-plan.md` --
   implementation plan and verification scope.
2. `docs/plans/2026-06-14-001-fix-watch-video-relation-order-plan.md` --
   original relation-order fix and rollout context.
3. `apps/admin/src/scripts/backfill-video-localized-metadata.ts` -- targeted
   dry-run/execute script pattern with sync lock and progress.
4. `apps/admin/src/services/core-sync/phases/sync-videos.ts` -- existing full
   Core sync relation extraction and insert path.
5. `apps/admin/src/services/core-sync/pool-timeout-retry.ts` -- retry helper
   for transient Prisma pool pressure.

## What To Build

1. Add a targeted Admin CLI script that backfills `video_relation.order` from
   Core child-array positions without re-syncing all video metadata.
2. Default the script to dry-run, require a target guard (`--slug`,
   `--core-id`, `--limit`, or `--full-catalog`), and require `--execute` for
   writes.
3. Use the existing Core sync lock, heartbeat, progress logging, transaction
   budget, and Prisma pool-timeout retry patterns.
4. Update only existing `VideoRelation` rows; report missing children or
   missing relation rows instead of creating or deleting relations.
5. Document the targeted operator path and the Admin GraphQL verification
   query for JESUS.

## Constraints

- Do not revive the full `videos` sync as the required relation-order backfill
  path.
- Do not advance Core sync watermarks or soft-delete any Core-sourced rows.
- Do not change Admin GraphQL schema or generated GraphQL artifacts.
- Do not add Watch-side sorting or JESUS-specific ordering logic.

## Verification

- Unit tests for argument parsing, target selection, dry-run behavior, Core
  child order mapping, missing-row reporting, and bulk update semantics.
- Targeted Admin test run for the new script.
- Dry-run the JESUS target locally or against a reviewed database before any
  production execute run.
- After production execution, verify Admin GraphQL returns
  `the-beginning`, `birth-of-jesus`, and `childhood-of-jesus` as the first
  ordered JESUS children.
