---
title: Prevent PostgreSQL operator precedence from breaking Watch search candidate lifecycle updates
date: 2026-08-11
category: database-issues
module: apps/admin Watch Search candidate generation ledger
problem_type: database_issue
component: database
symptoms:
  - "Watch search candidate lifecycle updates could fail with PostgreSQL error: operator does not exist: boolean -> unknown."
  - "Candidate generations could remain in BUILDING instead of becoming READY, RETIRING, or RETIRED even with valid lifecycle evidence."
  - "The private comparison page could report the candidate profile as unavailable because no READY evaluation generation was published."
root_cause: logic_error
resolution_type: migration
severity: high
related_components:
  - "service_object"
  - "testing_framework"
tags:
  - "watch-search"
  - "postgresql"
  - "jsonb"
  - "operator-precedence"
  - "database-trigger"
  - "candidate-lifecycle"
  - "migration"
  - "typesense"
---

# Prevent PostgreSQL operator precedence from breaking Watch search candidate lifecycle updates

## Problem

Admin Watch search candidate publication and retirement could build Typesense data but then fail on the first candidate-generation update with PostgreSQL `operator does not exist: boolean -> unknown`. The original lifecycle trigger mixed JSON extraction (`->`) and JSONB containment (`@>`) without grouping in its retired-state predicate, and that trigger runs before every generation-row update (`apps/admin/prisma/migrations/0048_watch_search_candidate_generations/migration.sql:273`, `apps/admin/prisma/migrations/0048_watch_search_candidate_generations/migration.sql:277`, `apps/admin/prisma/migrations/0048_watch_search_candidate_generations/migration.sql:286`).

## Symptoms

- Candidate collections could be populated, but the `BUILDING -> READY` update failed where validation writes `state`, increments `version`, and sets `validatedAt` (`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:490`).
- Retirement failed at the same database boundary when it attempted to move a generation to `RETIRING` (`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:1007`).
- The private comparison page could report `profile_unavailable`: comparison requires a resolved candidate profile and lease before executing that side (`apps/admin/src/services/typesense-watch-search-comparison.service.ts:190`, `apps/admin/src/services/typesense-watch-search-comparison.service.ts:228`, `apps/admin/src/services/typesense-watch-search-comparison.service.ts:312`).
- The publication script marks the generation ready before it moves the evaluation pointer, so a failed lifecycle update leaves the evaluation pointer unchanged (`apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:383`, `apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:404`).

## What Didn't Work

- Merged PR #1907 increased the repeatable-read snapshot transaction timeout to 60 seconds, but that transaction ends before the later lifecycle update that activates the trigger (`apps/admin/src/services/typesense-watch-search-indexer.ts:565`, `apps/admin/src/services/typesense-watch-search-candidate-generation.ts:490`).
- Retrying publication could rebuild or reuse Typesense collections, but it still reached the same `READY` update before evaluation-pointer publication (`apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:385`, `apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:404`).
- Retiring the partial generation was not a cleanup workaround because retirement also updates the guarded generation row (`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:1007`).

## Solution

Add a forward-only migration that replaces the existing trigger function and explicitly groups JSON extraction before containment (`apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:1`).

Before (`apps/admin/prisma/migrations/0048_watch_search_candidate_generations/migration.sql:277`):

```sql
NEW."owned_collections" @> NEW."deletion_progress"->'deletedCollections'
```

After (`apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:74`):

```sql
NEW."owned_collections" @> (NEW."deletion_progress"->'deletedCollections')
```

The migration also groups the reverse containment operand and otherwise preserves the immutable-identity, legal-transition, version, validation, and retirement checks (`apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:9`, `apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:45`, `apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:60`, `apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:70`).

`CREATE OR REPLACE FUNCTION` changes the trigger function in place. It does not rewrite candidate rows, detach the existing trigger, or delete Typesense collections. The migration can briefly wait for concurrent database activity, and it must not be rolled back to migration 0048's broken body; any correction should be another forward migration with a known-good function.

Protect the repair at two levels:

1. A fast static regression asserts the grouped form exists and the ambiguous form does not (`apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.test.ts:5`, `apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.test.ts:13`).
2. A real PostgreSQL smoke test installs the migration and trigger, accepts `BUILDING -> READY`, accepts complete retirement, and still rejects identity mutation (`apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:23`, `apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:75`, `apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:120`, `apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:143`). CI provisions PostgreSQL and enables that test for Admin changes (`.github/workflows/ci.yml:97`, `.github/workflows/ci.yml:127`).

## Why This Works

Parentheses force PostgreSQL to evaluate `deletion_progress->'deletedCollections'` as JSONB before applying `@>`, eliminating the parse that attempted `->` on a boolean. Replacing the function in a new migration repairs databases where migration 0048 is already applied while retaining the trigger's existing guard contract (`apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:4`, `apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:41`, `apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:45`).

The database-backed test matters because it executes the trigger through real `UPDATE` statements, including both the activation path and retirement predicate where the original failure lived (`apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:112`, `apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:149`).

## Prevention

- Parenthesize JSON extraction whenever it is an operand of containment or another PostgreSQL operator: `(payload->'key') @> expected` and `expected @> (payload->'key')`.
- Test trigger migrations against real PostgreSQL updates; string assertions are useful for the exact regression but do not prove that PL/pgSQL expressions compile when the trigger fires (`apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.test.ts:13`, `apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:112`).
- Exercise the minimum critical paths against real PostgreSQL: successful activation, successful retirement with deletion evidence, and rejection of identity mutation (`apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts:75`). Extend that database suite when changing the other lifecycle guards, including illegal transitions, version increments, READY validation evidence, invalidation reasons, or incomplete retirement evidence.
- Repair an applied migration with a new `CREATE OR REPLACE FUNCTION` migration instead of editing migration history (`apps/admin/prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql:4`).
- After deployment, verify a fresh generation reaches `READY`, the evaluation pointer is published only afterward, and the serving pointer remains unchanged until an explicit promotion (`apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:385`, `apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:404`).

## Related Issues

- [Precomputed serving indexes for multilingual hybrid search](../best-practices/precomputed-hybrid-search-serving-index-20260803.md) defines the candidate lifecycle and EVALUATION/SERVING separation that this database trigger protects.
- [Admin Watch search production rollout checklist](../best-practices/admin-watch-search-production-rollout-20260720.md) covers the broader production verification sequence.
- [Assert Prisma raw-SQL invariants by scraping the tagged-template text](../best-practices/prisma-raw-sql-invariant-assertions-20260423.md) explains why the fast text assertion remains useful alongside the real-database smoke.
- PR #1907 is the separate, already-merged snapshot-timeout fix; its 60-second timeout remains appropriate but does not repair this trigger (`apps/admin/src/services/typesense-watch-search-indexer.ts:500`, `apps/admin/src/services/typesense-watch-search-indexer.ts:565`).
- Do not mark candidate production fixed until the migration is deployed and a fresh candidate reaches `READY` with its evaluation pointer published.
