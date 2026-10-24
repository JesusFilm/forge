---
id: "feat-354"
title: "Make Mastra devotional migration readiness component-scoped"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-11"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "mastra"
  - "postgresql"
  - "migrations"
  - "reliability"
---

## Problem

The generalized Mastra migrator records devotional migration `001` and support-
research migration `002` in the same checksum ledger. Devotional readiness
currently treats the global latest version as its own version, so applying
`002` makes a valid devotional schema fail closed even though its required
migration remains present and unchanged.

## Entry Points — Read These First

1. `docs/plans/2026-08-11-001-fix-mastra-devotional-migration-readiness-plan.md`
   — reviewed fix and rollout plan.
2. `apps/mastra/src/services/devotional/workspace/database.ts` — runtime schema
   readiness predicate.
3. `apps/mastra/src/scripts/migrate-mastra-database.ts` — shared immutable
   checksum ledger and advisory-locked transaction.
4. `docs/runbooks/support-research-agent.md` — production migration and
   enablement boundary.

## Grep These

- `getDevotionalSchemaReadiness`
- `REQUIRED_DEVOTIONAL_MIGRATION`
- `schema_migrations`
- `check:devotional-database-readiness`
- `migrate:database`

## What To Build

1. Require the exact version, filename, and SHA-256 identity of
   `001-devotional-workspace.sql` instead of the newest global ledger version.
2. Keep readiness fail-closed for missing, drifted, or unavailable migration
   history while tolerating unrelated later Mastra migrations.
3. Pin the readiness checksum to the immutable migration bytes with an
   automated test.
4. Add a read-only operator command that exercises the production predicate
   without exposing database credentials.
5. Document deploy-before-migrate ordering, live-state branches, independent
   database readback, and the separate feature-approval gates.

## Constraints

- Do not edit migration SQL, rewrite ledger history, or introduce a second
  migration table.
- Do not enable devotional starts or support research as part of this fix.
- Do not treat Railway deployment success as proof that migrations ran.
- Keep PgVector, filesystem, reconciliation, cutover, provider, privacy, and
  dry-run checks as separate gates.

## Verification

- Focused readiness, migrator, and operator-command tests.
- Disposable PgVector-enabled PostgreSQL smoke with both migrations applied.
- Mastra test, typecheck, lint, format, and build checks.
- Production proof from the active Railway commit, direct ledger/schema
  readback, and the contained readiness command before either feature is
  considered for enablement.
