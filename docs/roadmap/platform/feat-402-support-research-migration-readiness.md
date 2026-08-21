---
id: "feat-402"
title: "Fail support research closed on missing database migration"
owner: "codex"
priority: "P0"
status: "in-progress"
start_date: "2026-08-20"
duration: 1
depends_on:
  - "feat-326"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "postgresql"
  - "reliability"
  - "support"
---

## Problem

Production enabled the daily support-research schedule without applying Mastra
migration `002-support-research.sql`. Every scheduled run from 2026-08-11
through 2026-08-20 failed on `support_research.cursors` before reaching Help
Scout. The workflow queries its repository before evaluating its default-off
configuration readiness, and there is no component-scoped operator check for
the exact migration identity and required relations.

## Entry Points — Read These First

1. `docs/runbooks/support-research-agent.md` — production database rollout,
   gate ordering, dry-run, and live-dispatch boundary.
2. `apps/mastra/src/mastra/workflows/daily-support-research.ts` — current
   readiness and repository ordering.
3. `apps/mastra/src/scripts/migrate-mastra-database.ts` — advisory-locked,
   checksum-verified shared migration ledger.
4. `apps/mastra/migrations/002-support-research.sql` — immutable migration
   identity and required support-research relations.

## Grep These

- `getSupportResearchDatabaseReadiness`
- `REQUIRED_SUPPORT_RESEARCH_MIGRATION`
- `database_migration_unavailable`
- `check:support-research-database-readiness`
- `support_research.cursors`

## What To Build

1. Add a component-scoped readiness reader that requires the exact version,
   filename, and SHA-256 identity of migration `002` plus every required
   support-research table and index.
2. Run database readiness before any support-research repository, Help Scout,
   model, validator, or Linear operation and return a safe failed/disabled
   report when the component schema is unavailable.
3. Add a read-only operator command that prints only the safe readiness result.
4. Update the runbook with the command and make the migration-before-enable
   verification boundary explicit.

## Constraints

- Do not edit applied migration SQL, insert ledger rows manually, or create a
  second migration ledger.
- Do not enable support research, provider approval, devotional starts, or
  Datadog triage as part of the repository fix.
- Do not contact Help Scout or write Linear until migration readback and a
  bounded `dryRun=true` verification pass.
- Production SQL changes use the deployed migrator only after explicit user
  approval; never use `railway up`.
- Merge the focused PR through the normal main-branch path and verify its exact
  revision is active before any migration attempt. The generic migrator applies
  every pending migration `001` through `003` in one bounded, advisory-locked
  transaction; never apply `002` alone.
- Production mutation approval is immediate, explicit, and valid for one
  attempt after a fresh read-only preflight. Timeout, drift, or failure requires
  forward-only rollback, a new preflight, and renewed approval.
- Provider/data-processing approval is independent from database-mutation
  approval. Keep support-research live dispatch, provider approval, devotional
  starts, and Datadog triage false through migration. Live dispatch requires a
  separate post-dry-run approval.
- Production evidence may contain safe object identities and counters only;
  never record credentials, raw customer content, or unsanitized support data.

## Verification

- Focused readiness, operator-command, migration-identity, and workflow
  no-upstream-call tests.
- `pnpm --filter @forge/mastra test`, `typecheck`, `lint`, and build.
- Production preflight records exact gates, deployment commit, database
  identity, privileges, PgVector availability, schemas, ledger, and relations.
- After approval, migration output is followed by independent exact ledger,
  extension, devotional, support-research, and Datadog relation-kind readback,
  including `pg_index.indisvalid=true` for every expected index, then both
  component readiness CLIs pass.
- With separately approved provider processing, a freshly revalidated admin
  runs a bounded unique-key `dryRun=true` while
  `SUPPORT_RESEARCH_ENABLED=false`; evidence records zero Linear access, the
  durable run status and bounded run window, and an independently unchanged or
  still-absent live cursor. An empty Help Scout window is connectivity-only
  evidence and cannot authorize live dispatch.

## Operational completion gate

Keep this ticket `in-progress` after the repository PR. It becomes complete
only after the reviewed revision is deployed, the approval-gated production
migration and exact independent readback succeed, both readiness commands pass,
and the bounded dry-run evidence is reviewed. Even then, live dispatch remains
disabled until its own separate approval.
