---
title: "Admin Video DB Backup and Clone"
type: feat
status: complete
date: 2026-05-13
origin: docs/roadmap/platform/feat-122-admin-video-database-backup-and-clone.md
---

# Admin Video DB Backup and Clone

## Summary

Create reviewed tooling for automatically backing up the admin production video
data slice and manually restoring it into staging or local development. The
backup path is non-interactive and can run on a Railway schedule with Doppler
env vars. The restore path remains an explicit CLI command with
target-environment guardrails.

## Problem Frame

Production video metadata now lives in admin Postgres. Developers need realistic
video catalog data for search, playback, editorial flows, and embedding work,
but full database clones are noisy and risky. A focused video slice should be
easy to dump from production, move to staging/dev, and restore without including
auth/session/workflow/editorial data.

## Scope Boundaries

In scope: admin Postgres video/reference table manifest, useworkflow-backed
scheduled backup, S3-compatible backup upload, restore CLI, package scripts,
unit tests, Railpack runtime PostgreSQL client tooling, roadmap/docs updates.

Out of scope: dashboard UI, direct Railway API integration, retention pruning,
auth/user/workflow/media asset data, cross-app CMS database backup.

## Context And Patterns

- `apps/admin/prisma/schema.prisma` maps Prisma models to snake-case Postgres
  tables. The backup manifest should use DB table names, not model names.
- `apps/admin/src/scripts/refresh-core-id-mapping.ts` is the closest operator
  script pattern: direct env reads, child process execution, timeout-oriented
  failure messages, and no dependency on the full admin runtime env matrix.
- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`
  applies operationally: dry runs should reveal exact table/command intent
  before a write path touches staging/dev.
- `docs/solutions/best-practices/admin-postgres-workflow-operations-pattern-20260501.md`
  keeps long-running production workflows separate from throwaway/local scripts.
  The backup path runs as a Postgres World workflow job on the dedicated admin
  worker; the restore path stays as operator CLI tooling.

## Key Decisions

- Use native PostgreSQL tools. `pg_dump`/`pg_restore` already understand table
  dependencies and custom-format archives; wrapping them is safer than retyping
  SQL export/import code.
- Automate backup, not restore. Production backup should run unattended with
  credentials supplied by the normal Railway S3 env vars. Restore is
  intentionally operator-run because it truncates target tables.
- Upload automated backups to the existing Railway S3 bucket when
  `RAILWAY_S3_BUCKET` is configured. No backup-specific env vars are introduced
  in this slice; a dedicated bucket/key family can be added later if needed.
- Install PostgreSQL 18 client tools through the admin service's Railpack
  variables. Production uses Railway PostgreSQL 18, and `pg_dump` refuses to
  dump from a server newer than its own major version. Set
  `RAILPACK_PACKAGES=postgres@18.1` and
  `RAILPACK_BUILD_APT_PACKAGES=bison flex` on the admin Railway services so the
  package requirement is scoped to admin instead of every Railway service in the
  monorepo.
- Start with data-only dumps. Target databases should already be migrated by
  Prisma. This keeps schema ownership with `apps/admin/prisma/migrations/`.
- Use fixed profiles instead of arbitrary `--table` passthrough. Operators can
  choose `video-core` or `video-search`, but the reviewed manifest prevents
  accidental auth/workflow data leakage.
- Backup is automated only. Operators should not get a `backup:video-db` CLI;
  the dedicated admin worker starts a durable useworkflow scheduler, and that
  workflow performs the dump and upload.
- Restore is destructive only for the selected manifest. It truncates selected
  tables with `RESTART IDENTITY CASCADE` before `pg_restore`, so staging/local
  gets a clean video slice without dropping schemas.

## Implementation Units

### Unit 1: Video Backup Manifest And Restore CLI Helpers

Files:

- Create `apps/admin/src/scripts/video-db-backup.ts`
- Create `apps/admin/src/scripts/video-db-backup.test.ts`
- Create `apps/admin/src/services/video-db-backup/job.ts`
- Create `apps/admin/src/workflows/videoDbBackup.ts`

Approach:

- Define table profiles in one exported constant.
- Add argument parsing for `--profile`, `--out`, `--in`, `--target-env`,
  `--allow-production-target`, `--s3-key`, and `--dry-run`.
- Build command argument arrays for `pg_dump`, `psql`, and `pg_restore`.
- Build an optional S3 upload plan from Doppler/Railway env vars.
- Export pure helpers so tests can assert command shape without shelling out.
- Make `apps/admin/src/scripts/video-db-backup.ts` refuse direct execution;
  backup is invoked only by the workflow job.
- Add a useworkflow dispatcher and one workflow step that executes the
  scheduled backup and updates the generic `workflow_run` ledger.

Test Scenarios:

- `video-core` expands to reference and video catalog tables but excludes scene
  and transcript embedding tables.
- `video-search` includes all `video-core` tables plus scene/transcript tables.
- Invalid profiles and missing database URLs fail with clean errors.
- Backup plans include an S3 destination when `RAILWAY_S3_BUCKET` and
  credentials are present.
- `@forge/admin` Railway service sets `RAILPACK_PACKAGES=postgres@18.1` so
  `pg_dump`, `pg_restore`, and `psql` are available in scheduled runs.
- Restore rejects `--target-env=production` unless `--allow-production-target`
  is present.
- Generated command args include `--format=custom`, `--data-only`, `--no-owner`,
  `--no-acl`, and every selected table as a distinct argument.

### Unit 2: Workflow Scheduler And Operator Docs

Files:

- Modify `apps/admin/src/instrumentation.ts`
- Modify `apps/admin/package.json`
- Modify `apps/admin/CLAUDE.md`
- Modify `docs/roadmap/README.md`

Approach:

- Add only the `restore:video-db` operator script.
- Start exactly one durable video backup scheduler workflow from a dedicated
  admin worker service with `WORKFLOW_RUNNER_ENABLED=true`; the admin web
  service leaves that flag unset or `false` so web replicas do not run jobs.
- The scheduler workflow runs one backup immediately when first created, then
  sleeps until the next daily UTC run, records normal backup ledger rows, and
  loops.
- Document the useworkflow scheduler boundary and the fact that no external
  backup endpoint or CLI is required.
- Add the feature to the platform roadmap index.

Test Scenarios:

- `pnpm --filter @forge/admin exec tsx src/scripts/video-db-backup.ts` refuses
  to run backup directly.
- `pnpm --filter @forge/admin restore:video-db -- --dry-run --target-env=development --in=...`
  prints truncate and restore plan without connecting.

## Verification

Run:

```bash
pnpm --filter @forge/admin test src/scripts/video-db-backup.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin exec tsx src/scripts/video-db-backup.ts
TARGET_DATABASE_URL=postgresql://forge:forge@localhost:5433/forge_admin pnpm --filter @forge/admin restore:video-db -- --dry-run --target-env=development --in=.tmp/db-backups/example.dump
```
