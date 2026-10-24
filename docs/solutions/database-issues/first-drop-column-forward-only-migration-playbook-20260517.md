---
title: "First DROP COLUMN forward-only migration playbook — verify prod state, co-version code, IF EXISTS idempotency"
category: database-issues
module: apps/admin
date: 2026-05-17
last_updated: 2026-05-17
tags:
  - prisma
  - migrations
  - drop-column
  - forward-only
  - postgres
  - railway
  - rollback-playbook
  - prod-verification
  - schema-evolution
problem_type: database_issue
component: database
root_cause: missing_validation
resolution_type: migration
severity: medium
applies_when: >
  Authoring the first DROP COLUMN migration in a Prisma + Postgres
  + Railway codebase that has so far only added/altered columns. The
  rollback semantics change at the moment a column is removed — code
  that previously referenced the column will no longer compile or
  query against the post-migration schema. This doc captures the
  five-step playbook applied to admin's migration 0014
  (`0014_drop_experience_locale_cms_snapshot`), the first such drop
  in admin. Apply when the next admin migration needs to drop
  columns, drop indexes, drop tables, or DROP TYPE / DROP CONSTRAINT.
---

## Problem

When a Prisma + Postgres codebase has accumulated only **additive**
migrations (new tables, new columns, new indexes), the team's
rollback discipline becomes "rolling back to an earlier image is
functionally safe — the schema is ahead of the code, but ahead-only,
and queries against the ahead schema still work because the older
code just doesn't see the new columns." Every admin migration before
0014 satisfied this invariant; CLAUDE.md "Migrations" section codified
it as: _"a code-side rollback is functionally safe."_

The **first** DROP migration breaks that invariant silently. Code
that previously referenced the dropped column will fail at runtime
against the post-migration schema. If the rollback playbook is
copy-pasted from the additive-only era, an operator rolling back will
brick reads on the affected tables with no warning.

## Symptoms (what failure looks like if the playbook isn't followed)

- `prisma migrate deploy` succeeds on production, dropping the columns.
- Operator notices an unrelated issue and rolls Railway back one
  deploy (the "safe" thing under the additive-only rule).
- The rolled-back image's Prisma client still has typed accessors for
  the now-dropped columns; any query selecting those fields (even via
  `select: { ... }`) fails with `column does not exist`.
- The failure surfaces as Prisma `PrismaClientKnownRequestError` /
  `P2010` at runtime in unrelated handlers, not at startup.
- The "fix" (re-deploy the post-drop code) requires forward motion
  while the operator is mid-incident.

## What didn't work (anti-patterns to avoid)

- **"Just trust `prisma migrate deploy`."** Prisma applies the SQL
  successfully and updates `_prisma_migrations`; nothing in that flow
  flags that the migration is **structurally** different from prior
  additive ones. No CI rule, no Prisma warning, no Railway alert.
- **"The `IF EXISTS` guard makes the migration safe."** `IF EXISTS`
  makes the migration **idempotent under retry** — re-applying it
  against an already-dropped schema is a no-op. It does **not** make
  rollback safe. The idempotency is about apply, not revert.
- **"Document the change in the PR description."** The PR description
  surfaces during merge review but disappears from the operator's
  view at rollback time. The rollback playbook needs to live in the
  durable runbook (`CLAUDE.md` or equivalent), not just the PR.
- **"Inspect the table for non-NULL values before dropping."** A
  precaution, but it only proves the _current_ state is empty. It
  says nothing about rollback safety — even a zero-row table will
  break rollback if the rolled-back code references the dropped
  columns.

## Solution — the five-step playbook

### 1. Verify prod state with a structured query (proves "no data loss")

Before authoring the migration, prove that the columns being dropped
are empty in production. For admin, this meant:

```sql
SELECT COUNT(*) AS total,
       COUNT(<col1>) AS non_null_col1,
       COUNT(<col2>) AS non_null_col2,
       COUNT(<col3>) AS non_null_col3
FROM <table>;
```

Capture the result in the migration's commit message AND in the PR
description. For 0014, the probe returned `0, 0, 0, 0` against admin's
prod Postgres (the dump that wrote those columns never successfully
ran in prod). The migration's header comment cites the date + result:

```sql
-- Verified safe to apply against admin's prod Postgres on 2026-05-17
-- — `SELECT COUNT(*) FROM experience_locale` returned 0 rows and the
-- three cms_* counts were trivially 0.
```

This is **load-bearing audit evidence**, not commentary. A future
maintainer trying to understand "why is this drop safe?" reads this
header and either accepts the audit or re-runs the probe.

For Railway-hosted Postgres, the probe is reachable via:

```bash
# Railway project token has variables-read access. Fetch
# DATABASE_PUBLIC_URL via the project's GraphQL API, then psql.
# Memory-saved tokens shortcut the OAuth dance for repeat audits.
ADMIN_DB_URL=$(curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H 'Project-Access-Token: <project-token>' \
  -H 'Content-Type: application/json' \
  -d '{"query":"query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}", \
       "variables":{...}}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['variables']['DATABASE_PUBLIC_URL'])")
psql "$ADMIN_DB_URL" -c "SELECT COUNT(*) ..."
```

### 2. Co-version the schema + code in one PR

The migration that drops the column lands in the same PR as every
code change that removed references to it. **Do not** drop the column
in one PR and clean up the code in a follow-up — that creates a
window where main has dead column references against a schema that
no longer has them.

In PR #966 this was 6 commits arranged so each was independently
buildable:

```
Unit 1 (additive)  → ship replacement code path
Unit 2 (subtractive) → remove GraphQL surface + perm key
Unit 3 (subtractive) → remove workflow + service + cms-coupled modules
Unit 4 (subtractive) → remove env var
Unit 5 (schema)    → migration 0014 drops the columns
Unit 6 (docs)      → update CLAUDE.md, supersede stale docs
```

The Unit 5 migration is the LAST schema-touching commit; every code
reference to the dropped columns was removed in Units 2–4. A rollback
to **any commit on this branch** is co-versioned: schema and code
agree.

### 3. Write the SQL with `IF EXISTS` everywhere (idempotency under retry)

```sql
-- Forward-only. See the corresponding code-removal commits in the
-- same PR. Rollback past this commit requires a re-add migration.

DROP INDEX IF EXISTS "<index_name>";

ALTER TABLE "<table>"
  DROP COLUMN IF EXISTS "<col1>",
  DROP COLUMN IF EXISTS "<col2>",
  DROP COLUMN IF EXISTS "<col3>";
```

`IF EXISTS` matters because:

- Prisma's chained `startCommand` on Railway retries up to 3× on
  failure. If the migration applies to one container and a sibling
  container retries, the second attempt would error on already-dropped
  columns without `IF EXISTS`.
- Mid-migration crashes (rare with column drops, but possible) leave
  Postgres in a partial state. `IF EXISTS` lets the second attempt
  resume cleanly.
- Operators occasionally run `prisma migrate deploy` manually against
  an already-migrated DB during emergency recovery; the no-op behavior
  prevents accidental errors.

### 4. Update the rollback playbook in the durable runbook

The pre-0014 CLAUDE.md said simply: _"a code-side rollback is
functionally safe."_ That sentence was correct under the additive-only
invariant. Update it to encode the new boundary:

```markdown
Migration `0014_drop_experience_locale_cms_snapshot` (2026-05-17) is
the first admin migration to drop columns. Code-side rollback rules:

- Rolling back to the **immediately-prior commit** on the PR that
  added 0014 is functionally safe: that commit no longer references
  the dropped columns. Schema and code were co-versioned in the same
  PR.
- Rolling back further than that — to a commit that still references
  the dropped columns — is unsafe. The columns are gone from the DB
  but the code expects them, so Prisma reads fail at runtime. If you
  need to roll back past 0014, coordinate a re-add migration first.
- Every earlier migration (0001–0013) is purely additive — new
  tables, new columns, new indexes — so the pre-0014 rule that
  "rolling back to an earlier image is functionally safe" still
  holds for that stretch of history.
```

The runbook update lives in the same PR as the migration. Future
operators reading the migrations section at incident-time get the
correct rollback boundary at the moment they need it.

### 5. Add post-deploy verification queries to the PR's monitoring section

Don't trust `prisma migrate deploy`'s success exit — confirm at the
schema layer that the drop actually applied:

```sql
-- Should return 0 rows post-deploy:
SELECT column_name
FROM information_schema.columns
WHERE table_name='<table>' AND column_name LIKE '<dropped-prefix>%';

-- Should NOT include the dropped index:
SELECT indexname FROM pg_indexes WHERE tablename='<table>' ORDER BY indexname;

-- Migration ledger should show 0014 with finished_at IS NOT NULL,
-- rolled_back_at IS NULL:
SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
FROM _prisma_migrations
WHERE migration_name = '<your-migration-name>';
```

These belong in the PR's "Post-Deploy Monitoring & Validation"
section so they execute as part of the deploy checklist, not as
forgotten tribal knowledge.

## Why this works

Each step closes a specific gap that the additive-only-era playbook
left open:

| Step                   | Gap it closes                                   |
| ---------------------- | ----------------------------------------------- |
| 1. Verify prod state   | "How do I know this won't lose data?"           |
| 2. Co-version code     | "Is rollback to the prior commit safe?"         |
| 3. `IF EXISTS` SQL     | "What if the migration retries mid-apply?"      |
| 4. Update runbook      | "Where do operators learn the new boundary?"    |
| 5. Post-deploy queries | "How do I confirm the schema actually changed?" |

Steps 1, 2, and 4 are unique to first-drop or drop-heavy migrations.
Steps 3 and 5 are good hygiene for every migration. The combination
is what makes a column drop **safe by construction** rather than
"safe in practice if you remember the gotchas."

## Prevention

### For the next admin DROP migration

Treat 0014's commit as the canonical template. Specifically:

1. Run the prod-state probe; cite the result + date in the migration
   header comment.
2. Pair the migration commit with the code-removal commits in the
   same PR; the migration is the LAST schema-touching commit in the
   branch.
3. Use `IF EXISTS` on every `DROP` statement.
4. Update `apps/admin/CLAUDE.md`'s Migrations section to extend the
   rollback boundary (if this is a new shape of drop — e.g., the
   first DROP TABLE or first DROP TYPE).
5. Add the post-deploy verification queries to the PR description.

### Lint / CI ratchet (proposed, not yet implemented)

A CI grep against `apps/admin/prisma/migrations/**/*.sql` for any
`DROP COLUMN`, `DROP TABLE`, `DROP INDEX`, or `ALTER TABLE ... DROP`
that doesn't carry the corresponding `IF EXISTS` would catch the
non-idempotent case. A separate check could grep for a "Verified
safe" header comment on any migration whose body contains a `DROP`
statement.

### Cross-app applicability

The five-step playbook generalises to any Prisma + Postgres codebase
that has been additive-only. apps/cms and apps/manager have the same
shape; if either drops its first column, apply this playbook
verbatim.

## Pointers

- The canonical worked example: [`apps/admin/prisma/migrations/0014_drop_experience_locale_cms_snapshot/migration.sql`](../../../apps/admin/prisma/migrations/0014_drop_experience_locale_cms_snapshot/migration.sql).
- The pre-0014 additive-only rule: [`apps/admin/CLAUDE.md`](../../../apps/admin/CLAUDE.md) "Migrations" section (updated in PR #966 with the new 0014-aware boundary).
- The plan that codified the playbook: [`docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md`](../../plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md) (Unit 5 + Risks & Dependencies sections).
- Adjacent solutions: [`postgres-generated-column-drift-add-column-if-not-exists-20260429.md`](postgres-generated-column-drift-add-column-if-not-exists-20260429.md) covers the additive `ADD COLUMN IF NOT EXISTS` companion pattern; [`prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md`](prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md) covers Prisma's `Unsupported(...)?` columns that often surface in admin's pgvector context.
- The PR that introduced 0014: [PR #966](https://github.com/JesusFilm/forge/pull/966).
- The prod-state verification was performed via Railway API token (project-scoped); cf. memory note `railway_prod_credentials.md` for the token + memory note `project_admin_prod_experience_corpus_empty.md` for the captured probe result.
