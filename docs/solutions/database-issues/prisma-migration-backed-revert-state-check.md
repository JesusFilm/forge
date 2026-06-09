---
title: "Prisma migration-backed reverts need a database state check first"
date: "2026-06-08"
category: "database-issues"
module: "apps/admin"
problem_type: "database_issue"
component: "database"
symptoms:
  - "A git revert deletes a Prisma migration file while deployed databases may already have migration history for it"
  - "P3009 recovery code can name a migration that no longer exists in the active migrations directory"
  - "App tests pass because removed columns are no longer read, while migration history risk remains"
root_cause: "missing_validation"
resolution_type: "workflow_improvement"
severity: "medium"
tags:
  - "prisma"
  - "migrations"
  - "rollback"
  - "p3009"
  - "migration-history"
  - "railway"
  - "qwen"
  - "embeddings"
---

# Prisma migration-backed reverts need a database state check first

## Problem

Reverting a PR that added a Prisma migration is not just a code revert. The
database can be in three different states for that migration: it never saw the
migration, it has a failed migration row, or it successfully applied the
migration. Treating those states the same can leave Prisma migration history
out of sync with the checked-in migrations directory.

This surfaced while reverting the parallel Qwen video-search rollout from PR
#1149. The rollback removed the `embedding_qwen` code path and deleted
`0032_video_embedding_qwen`, while the branch still needed recovery support for
environments where that migration had already failed during deploy.

## Symptoms

- A revert removes `schema.prisma` fields and the matching migration directory,
  but deployed environments may have `_prisma_migrations` rows for that
  migration.
- A known P3009 recovery script still recognizes the deleted migration name, so
  a failed-row environment can be unblocked, but an applied-row environment
  would now have a missing migration in history.
- Unit tests and typecheck stay green because the application no longer reads
  the removed columns. That does not prove deployed migration history is clean.

## What Didn't Work

- **Just delete the migration file.** This is fine only when no shared or
  deployed database has successfully applied it. Prisma treats the migrations
  directory as migration-history source of truth, so deleting an applied file
  creates durable history mismatch.
- **Assume P3009 recovery is the same as reverting an applied migration.** P3009
  recovery is for failed migration rows. A successful up migration needs a new
  forward migration to undo schema changes.
- **Rely on app-level tests.** Tests can prove the code no longer references
  the removed column, but they do not exercise `_prisma_migrations` state in
  staging or production.
- **Only turn off the feature flag.** A disabled runtime path does not remove
  the schema, env contract, or migration-history hazard.

## Solution

Classify the migration state before deciding how to revert.

```sql
SELECT migration_name,
       finished_at,
       rolled_back_at,
       logs IS NOT NULL AS has_logs
FROM _prisma_migrations
WHERE migration_name = '0032_video_embedding_qwen';
```

Then choose the path:

1. **No row exists:** the target database never saw the migration. A code revert
   can delete the migration file, remove `schema.prisma` fields, and remove all
   runtime references. Validate with tests, typecheck, and a repo scan for the
   removed contract.
2. **A failed row exists:** keep an explicit known-recovery path for that
   migration name. Resolve the failed row as rolled back, then run
   `migrate deploy` again. If the failed up migration left partial DDL behind,
   clean it with explicit down SQL before resolving the row.
3. **A successful row exists:** do not delete the migration from active history.
   Keep the applied migration file and add a new forward migration that drops
   the columns and indexes. Remove code references in the same change so schema
   and code remain co-versioned.

For the Qwen rollback, the code side followed the intended state split:

- Removed the `AI_VIDEO_SEARCH_EMBEDDING_SOURCE` env surface and per-call
  source threading.
- Removed the gateway query-provider branch and the `embedding_qwen` SQL read
  path.
- Kept the later OpenRouter Qwen query embedding behavior and Qwen-compatible
  provenance filters on the main `embedding` columns.
- Kept `0032_video_embedding_qwen` in the known P3009 recovery allowlist for
  databases that already recorded a failed migration row.

The remaining release requirement is operational: verify staging and
production migration state before shipping the branch. If any environment has
`0032_video_embedding_qwen` successfully applied, switch from "delete the
migration" to "keep the migration and add a forward drop migration."

## Why This Works

Application rollback and database rollback are separate timelines. The app can
stop reading a column immediately, but Prisma still compares deployed database
history to the migrations that are present in source control.

The state check makes the rollback path explicit:

- never-applied migrations can disappear with the reverted PR,
- failed migrations can be resolved as rolled back after any partial schema is
  cleaned up,
- applied migrations are undone only by forward migration.

That distinction preserves the intent of a revert without rewriting history for
databases that have already moved forward.

## Prevention

- For every migration-backed revert, include the `_prisma_migrations` state in
  the PR or release checklist.
- Treat `migrate resolve --rolled-back` as a failed-up recovery tool, not as a
  successful-up rollback tool.
- When deleting a migration file, record why that is safe for deployed
  environments. If you cannot prove it, keep the file and add a forward
  counter-migration.
- Keep tests focused on both sides: app tests should prove the removed code
  path is gone, while migration-recovery tests should prove only known failed
  rows are auto-resolved.
- Preserve later dependent commits manually during revert conflict resolution;
  in this case, the OpenRouter-only Qwen query embedding contract stayed while
  the parallel `embedding_qwen` source selector was removed.

## Related Issues

- `docs/solutions/database-issues/first-drop-column-forward-only-migration-playbook-20260517.md` - forward-only rollback rules once schema changes remove columns or indexes.
- `docs/solutions/database-issues/admin-prisma-client-and-db-migration-drift-after-pull-20260603.md` - local drift from stale Prisma client plus unapplied migrations.
- `docs/solutions/best-practices/openrouter-only-embedding-provider-contract.md` - the retained query-embedding contract from the later Qwen work.
- `docs/solutions/architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md` - provider-bound vector-space rollout guidance.
- Prisma documentation: "About migration histories" and "Generating down migrations."
