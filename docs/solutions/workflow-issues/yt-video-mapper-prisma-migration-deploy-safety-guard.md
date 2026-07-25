---
title: "YTM Prisma migration deploy safety guard"
date: "2026-06-30"
category: "workflow-issues"
module: "apps/yt-video-mapper-backend"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "high"
applies_when:
  - "A Prisma service deploys migrations through `prisma migrate deploy`"
  - "A Postgres migration adds enum values or enum-dependent SQL"
  - "A migration creates indexes, constraints, or partial indexes with raw SQL"
  - "Railway deploy logs are the first place migration safety failures would otherwise appear"
related_components:
  - "database"
  - "testing_framework"
  - "tooling"
tags:
  - "yt-video-mapper"
  - "prisma"
  - "postgres"
  - "migrations"
  - "deploy-safety"
  - "railway"
---

# YTM Prisma migration deploy safety guard

## Context

The yt-video-mapper queued-job expiry rollout exposed two Postgres migration
hazards through Railway production deploys instead of through local or CI
checks.

The first failed deploy attempted `CREATE INDEX CONCURRENTLY` inside Prisma's
`migrate deploy` execution path. Postgres rejects concurrent index creation
inside a transaction block. The second failed deploy removed `CONCURRENTLY`,
but added the `expired` enum value and created a partial index referencing
`'expired'` in the same migration. Postgres accepts adding an enum value inside
a transaction, but that value cannot be used until the transaction commits.

The repaired shape is split across migrations:

```sql
-- 20260629000100_add_expired_match_job_status
ALTER TYPE "match_job_status" ADD VALUE 'expired';
```

```sql
-- 20260629000200_add_expired_upload_cleanup_index
CREATE INDEX IF NOT EXISTS "mapper_match_job_expired_upload_cleanup_idx"
ON "mapper_match_job"("queued_at", "id")
WHERE "status" = 'expired'
  AND (
    "upload_storage_key" IS NOT NULL
    OR "upload_content_type" IS NOT NULL
    OR "upload_byte_length" IS NOT NULL
  );
```

Production logs later showed both repaired migrations applying cleanly. Direct
production `_prisma_migrations` inspection was unavailable in the local formal
run because Railway's private database host was not resolvable and the token
could not open an SSH tunnel, so the audit preserved that access limitation
instead of creating a public database proxy. A disposable local Postgres
`prisma migrate deploy` run applied all mapper migrations cleanly.

## Guidance

Treat Prisma migration transaction safety as a pre-merge invariant, not a
production deploy experiment.

For yt-video-mapper migrations:

- Do not put `CREATE INDEX CONCURRENTLY` in migrations that run through
  `prisma migrate deploy`.
- Isolate `ALTER TYPE ... ADD VALUE` from any SQL that references the new enum
  value. Partial indexes, constraints, casts, and data updates that depend on
  the new literal belong in a later migration.
- Keep the mapper guard in
  `apps/yt-video-mapper-backend/src/db/schema.test.ts` scanning every mapper
  migration directory, not only the migration that triggered the incident.
- Test the real SQL spelling space that authors may write, including quoted
  schema-qualified enum type names such as `"public"."match_job_status"` and
  dollar-quoted enum literals such as `$$expired$$`.
- Replay exact historical bad SQL during incident RCA. Synthetic fixtures are
  useful prevention tests, but replaying the PR bodies that failed in
  production proves the guard matches the real failure, not a nearby toy case.

## Why This Matters

Prisma `migrate deploy` is the production migration runner for this service.
When a migration only fails inside that runner, the service can be healthy at
`/health` while deploys repeatedly stop before the server starts. The outcome
looks like an infrastructure incident, but the root cause is an unsafe SQL
shape that could have been rejected by tests.

Failed migration attempts and successfully applied migration history need
different recovery paths. A failed migration row can be marked rolled back
after the underlying SQL is repaired and reapplied. A successfully applied
schema change is forward-only: do not edit or delete migration history that a
deployed database has observed.

The guard also prevents false confidence in app-level expiry behavior. The
expiry cleaner, worker, and polling contract can all be correct while the
service still cannot deploy because the migration introducing their schema
support is not transaction-compatible.

## When to Apply

- A mapper migration contains hand-written SQL.
- A migration adds a Postgres enum value.
- A later index, constraint, cast, or query depends on a new enum literal.
- A migration uses any index option whose legality depends on transaction
  context.
- A Railway deploy failure mentions Prisma `P3018`, Postgres `25001`, or
  Postgres `55P04`.
- An operator needs to distinguish a Known Recoverable Migration from a
  Forward-Only Migration.

## Examples

Unsafe: enum add and dependent partial index in one Prisma migration.

```sql
ALTER TYPE "match_job_status" ADD VALUE 'expired';

CREATE INDEX "mapper_match_job_expired_idx"
ON "mapper_match_job"("queued_at")
WHERE "status" = 'expired';
```

Safe: split the enum add from dependent SQL so the enum value commits before it
is referenced.

```sql
-- migration 1
ALTER TYPE "match_job_status" ADD VALUE 'expired';
```

```sql
-- migration 2
CREATE INDEX "mapper_match_job_expired_idx"
ON "mapper_match_job"("queued_at")
WHERE "status" = 'expired';
```

Guard fixture for quoted schema-qualified type names:

```ts
expect(
  findDeployTransactionViolations({
    name: "bad_schema_qualified_enum_use",
    sql: `
      ALTER TYPE "public"."match_job_status" ADD VALUE 'expired';
      CREATE INDEX "mapper_match_job_expired_idx"
      ON "mapper_match_job"("queued_at")
      WHERE "status" = 'expired';
    `,
  }),
).toEqual([
  "bad_schema_qualified_enum_use adds enum value 'expired' and references it again in the same migration; split dependent SQL into the next migration.",
])
```

Guard fixture for dollar-quoted enum literals:

```ts
expect(
  findDeployTransactionViolations({
    name: "bad_dollar_quoted_enum_use",
    sql: `
      ALTER TYPE "match_job_status" ADD VALUE $$expired$$;
      CREATE INDEX "mapper_match_job_expired_idx"
      ON "mapper_match_job"("queued_at")
      WHERE "status" = $$expired$$::match_job_status;
    `,
  }),
).toEqual([
  "bad_dollar_quoted_enum_use adds enum value 'expired' and references it again in the same migration; split dependent SQL into the next migration.",
])
```

## Related

- [YTM Railway Prisma backend deployment hardening](./yt-video-mapper-railway-prisma-backend-deployment.md) - same service and Railway `prisma migrate deploy` contract.
- [Railway dashboard config silently shadows per-service `apps/<svc>/railway.toml`](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md) - deployment config must be verified through an independent read path.
- [Prisma migration-backed reverts need a database state check first](../database-issues/prisma-migration-backed-revert-state-check.md) - distinguishes failed migration recovery from forward-only history.
- [First DROP COLUMN forward-only migration playbook](../database-issues/first-drop-column-forward-only-migration-playbook-20260517.md) - related Prisma/Postgres migration safety discipline.
- [Assert Prisma raw-SQL invariants by scraping tagged-template text](../best-practices/prisma-raw-sql-invariant-assertions-20260423.md) - adjacent testing pattern for SQL shape guards.
- [Prisma `@map`'d enums: raw SQL bypasses Prisma's coercion](../database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md) - adjacent enum literal and raw SQL discipline.
