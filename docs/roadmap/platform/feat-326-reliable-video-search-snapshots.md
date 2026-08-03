---
id: "feat-326"
title: "Reliable video search snapshots"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-08-02"
duration: 1
depends_on:
  - "feat-255"
blocks: []
tags:
  - "platform"
  - "admin"
  - "database"
  - "embeddings"
  - "production"
---

## Problem

The scheduled Admin video database backup passes Prisma-only URL options to
PostgreSQL native tools. PostgreSQL 18 rejects options such as
`connection_limit` before connecting, so neither scheduled profile currently
publishes and the embedding-bearing `video-search` snapshot is unavailable to
local development.

## Entry Points — Read These First

1. `apps/admin/src/scripts/video-db-backup-core.ts` — profile manifests,
   native URL boundary, and backup/restore plans.
2. `apps/admin/src/scripts/video-db-backup.ts` — native process execution,
   object discovery, and latest restore flow.
3. `apps/admin/src/scripts/video-db-backup.test.ts`,
   `video-db-backup-restore.test.ts`, and `video-db-backup-latest.test.ts` —
   focused profile, process, and latest-download contracts.
4. `apps/admin/src/app/api/internal/video-db-backups/presign/route.ts` —
   production latest-object signer.
5. `apps/admin/src/services/video-db-backup/job.ts` — scheduled profile job
   result persisted to the workflow ledger.
6. `docs/plans/2026-08-02-001-fix-reliable-video-search-snapshots-plan.md` —
   accepted product and implementation contract.

## Grep These

- `buildBackupPlan`
- `buildRestorePlan`
- `discoverLatestBackupFreshness`
- `discoverVideoDbBackupFreshnessFromPages`
- `restoreLatestMain`
- `SCHEDULED_VIDEO_DB_BACKUP_PROFILES`

## What To Build

1. Normalize application database URLs at the native PostgreSQL tool boundary
   without hiding unknown or supported libpq options.
2. Paginate latest-object discovery, classify freshness consistently, and
   require acknowledgement before downloading a snapshot older than 36 hours.
3. Preflight archives and targets before destructive restore work, and align
   supported local PostgreSQL client and server tooling on major version 18.
4. Publish both scheduled profiles through the normal deployment path, restore
   `video-search` into a pristine local database, and record size, duration,
   semantic-search, and incremental Railway cost evidence.

## Constraints

- Do not generate or backfill embeddings as part of snapshot publication.
- Do not add an embedding-readiness gate.
- Keep `video-core` as the default and `video-search` as explicit opt-in.
- Do not add a manual production backup or deployment path.
- Preserve production-target restore protection and redact credentials.
- Measure the first repaired artifact before changing cadence, retention, or
  upload strategy.

## Verification

- Focused backup, signer, job, and workflow tests pass.
- Admin typecheck, lint, formatting, and required GitHub checks pass.
- The rebuilt development container reports PostgreSQL 18 clients and server.
- Normal production deployment runs the established daily scheduler and
  publishes nonzero ledger-correlated core and search objects.
- A pristine search-profile restore supports semantic video search without
  `run-embeds` and records first-month and 12-month no-retention cost estimates.

## Pool and embedding safety evidence

- The snapshot script derives native-client URLs without mutating
  `DATABASE_URL` or `DATABASE_URL_SYNC`; Prisma pool parameters remain
  available to the embedding and Core Sync clients.
- The repository's pool learnings require the main `connection_limit=10` pool
  for embedding concurrency headroom and recommend an isolated
  `connection_limit=5&pool_timeout=60` Core Sync pool. This work preserves both
  contracts.
- Focused snapshot, transcript embedding workflow, and transcript embedding
  service suites pass together. Snapshot publication copies vectors and makes
  no embedding-provider call.

## Cost guardrail

Current Railway list prices are `$0.05/GB` service egress,
`$0.015/GB-month` bucket storage, `$20/vCPU-month`, and `$10/GB-month` RAM.
Bucket egress/presigned downloads and S3 operations are free; uploading from a
Railway service to a bucket is billable service egress.

For a daily search artifact of `S` billed GB, estimated upload egress is
`$1.50 × S` per month. With no retention, estimated first-month average
storage is `$0.2325 × S`; month-twelve storage alone is `$5.1825 × S`. Daily
compute adds approximately
`30 × duration_minutes × ($0.000463 × average_vCPU + $0.000231 × average_GB_RAM)`.
These are directional pre-rounding figures; the production object size and
workflow durations replace the assumptions after the first repaired run.

No embedding API cost is added because this workflow exports vectors already
stored in PostgreSQL. Do not change cadence, retention, or upload strategy
until the first production measurements identify a concrete limit.

Sources: [Railway resource pricing](https://docs.railway.com/pricing/plans) and
[Railway bucket billing](https://docs.railway.com/storage-buckets/billing).

## Release evidence

Fill after merge and the first eligible 09:00 UTC scheduler run:

- Merged commit and Admin web/worker deployment IDs: pending.
- Scheduler runtime, heartbeat, and next run: pending.
- Core ledger ID, key, bytes, export/upload duration: pending.
- Search ledger ID, key, bytes, export/upload duration: pending.
- PostgreSQL 18 restore duration, row/vector/provenance counts: pending.
- Semantic-search smoke without `run-embeds`: pending.
- Measured first-month and month-twelve no-retention cost: pending.
