---
id: "feat-323"
title: "Admin subtitle checksum reconciliation"
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

Admin currently treats a subtitle sync phase with zero reported errors as
healthy even when its data differs from Core. The incremental query follows
`Video.updatedAt`, so subtitle-only changes can remain hidden. A full run can
also soft-delete valid rows after an incomplete nested response. This left the
JESUS Watch page without an English transcript even though Core still has the
subtitle records.

## Entry Points - Read These First

1. `apps/admin/src/services/core-sync/phases/sync-video-subtitles.ts` - phase
   orchestration, restart policy, diagnostics, and final parity publication.
2. `apps/admin/src/services/core-sync/phases/video-subtitle-reconciliation.ts`
   - Admin projection, snapshot-bound detail validation, relationship
     resolution, and per-video mutation fence.
3. `apps/admin/src/services/core-sync/core-client.ts` - Core GraphQL transport
   and interop authentication.
4. `apps/admin/prisma/schema.prisma` - subtitle storage, sync state, and
   workflow diagnostics.
5. `apps/admin/src/app/dashboard/ops-data.ts` - system-status composition.
6. `apps/admin/src/app/dashboard/system-status/page.tsx` - Core Sync operator
   view.
7. `docs/solutions/integration-issues/core-sync-video-subtitles-soft-delete-wipes-on-incomplete-fetch.md`
   - prior incident and destructive-sync constraints.
8. `https://github.com/JesusFilm/core/pull/9425` - authoritative manifest
   contract and version 1 checksum vectors.

## Grep These

- `syncVideoSubtitles`
- `videoSubtitleChecksumManifest`
- `CoreGraphQLError`
- `Latest Attempted Sync`
- `CoreSyncRun`
- `refreshWatchRouteManifestAfterCoreSync`

## What To Build

1. Authenticate to and consume Core's versioned subtitle checksum manifest.
2. Reproduce checksum version 1 from literal golden vectors and compare Core
   with active Admin Core subtitle rows per video.
3. Request snapshot-bound details only for mismatched videos, in batches of at
   most 100, and reconcile only those videos.
4. Never delete a subtitle unless the returned detail count, checksum, and
   canonical records match the discovered Core manifest snapshot.
5. Re-read the manifest after repairs and report parity healthy only when the
   final Admin root matches Core.
6. Persist parity attempts, freshness, checksums, counts, mismatches, repairs,
   and residual diagnostics independently from workflow execution state.
7. Display Core Sync execution, subtitle parity freshness, and subtitle data
   parity as separate operator signals.
8. Restore the missing JESUS English subtitles through this reconciler and
   invalidate the Watch manifests through the normal successful sync path.

## Constraints

- Do not use `Video.updatedAt` as the subtitle parity authority.
- Do not perform a phase-wide unstamped-row deletion.
- Do not mark parity healthy from transport success or `errors === 0` alone.
- Treat an unsupported manifest version, stale snapshot, malformed detail,
  ambiguous edition mapping, or missing dependency as a diagnostic failure.
- Do not add a manual production database patch or deploy outside the normal
  PR-to-main flow.

## Verification

- Focused checksum, Core client, subtitle reconciliation, dashboard data, and
  dashboard rendering tests under `@forge/admin`.
- `pnpm --filter @forge/admin db:generate`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `git diff --check`

## Result

- Added authenticated Core manifest consumption and independently pinned
  checksum version 1 canonicalization.
- Added additive subtitle source-version storage and mismatch-only, lock-fenced
  per-video reconciliation. Manager-owned relationships and rows cannot prove
  or receive Core repairs.
- Added stable parity diagnostics with complete sorted video-ID sets and
  bounded reason text. System Status now renders execution, 36-hour freshness,
  and data parity separately.
- Added JESUS `1_jf-0-0` restoration coverage through the normal reconciler and
  retained Watch manifest refresh behavior.
- Verified 108 focused feature tests, Admin typecheck and lint, Prisma generate
  and validate, and diff/format checks. Three unchanged Windows CLI tests that
  spawn the literal executable `pnpm` remain a local-only full-suite failure;
  CI on the supported runner is the merge gate.
