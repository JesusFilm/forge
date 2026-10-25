---
title: "Prisma `Unsupported(...)?` placeholders for raw-SQL-managed generated columns"
category: "database-issues"
problem_type: "database_issue"
component: "database"
root_cause: "incomplete_setup"
resolution_type: "code_fix"
severity: "medium"
module: "apps/admin"
tags:
  - prisma
  - schema-drift
  - generated-columns
  - tsvector
  - migrate-dev
  - postgres
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#feat-109-admin-port"
---

## Problem

A Prisma migration adds a Postgres generated column (e.g.
`title_tsv tsvector GENERATED ALWAYS AS (...) STORED`) and a GIN index
over it. Both are managed exclusively via raw SQL — Prisma has no
first-class type for stored generated tsvector columns. Because the
column never appears in `prisma/schema.prisma`, the next engineer to
run `pnpm prisma migrate dev` is prompted with a destructive plan:

> ⚠️ The following column(s) will be dropped: `title_tsv`,
> `description_tsv`. Continue?

If the engineer accepts (or auto-approves on a CI/dev container), the
column is dropped, the dependent GIN index is `CASCADE`-dropped
silently, and the keyword-first retriever reverts to seq scan with no
test or runtime signal.

## Symptoms

- `prisma migrate dev` shows `[+] Drop column "title_tsv"` in its diff
  proposal, even though the column was added intentionally by an
  earlier migration.
- After accepting the prompt, `EXPLAIN ANALYZE` of the search retriever
  drops from `Bitmap Index Scan` to `Seq Scan`.
- No type error or test fail at compile time — the retriever's `Prisma.raw`
  expression doesn't reference the column through Prisma's type system.

## What Didn't Work

- **Relying on `IF NOT EXISTS` in the migration.** Idempotency at apply
  time doesn't help — `migrate dev` compares schema.prisma against the
  introspected DB and offers to roll back any column it doesn't see in
  the schema, regardless of how the column was originally created.
- **Comments in the migration.** Future engineers don't see them
  during the `migrate dev` prompt.
- **Skipping `migrate dev` in favor of `migrate deploy`.** Works on
  CI/prod but not in local dev where `migrate dev` is the canonical
  workflow.

## Solution

Declare the raw-SQL-managed columns as `Unsupported("...")?`
placeholders in `schema.prisma`. Prisma treats `Unsupported(...)`
fields as opaque (cannot be selected via the typed client, cannot be
written via standard CRUD) but recognizes their existence in
introspection — `migrate dev` no longer proposes to drop them.

```prisma
model VideoLocale {
  id          String       @id @default(cuid())
  videoId     String       @map("video_id")
  // ... existing fields ...

  /// STORED generated tsvector columns — derived from `title` /
  /// `description` by `0009_keyword_first_lexical/migration.sql`.
  /// Service code reads these via `Prisma.raw` only — Prisma has no
  /// first-class generated-tsvector column type, so we expose them
  /// to introspection through Unsupported(...)? placeholders to keep
  /// `prisma migrate dev` from offering to drop them.
  titleTsv       Unsupported("tsvector")? @map("title_tsv")
  descriptionTsv Unsupported("tsvector")? @map("description_tsv")

  @@map("video_locale")
}
```

The migration that creates the column stays unchanged. The schema
declaration is purely defensive against `migrate dev` drift.

## Why This Works

`Unsupported(...)` is Prisma's official escape hatch for column types
the generator doesn't model (geographic types, vectors, tsvector,
hstore, custom domains). The runtime client cannot read or write the
field, but the introspector reconciles its existence with the live
DB. This is the same pattern already used for pgvector embedding
columns elsewhere in admin's schema (`embedding Unsupported("vector(1536)")?`).

The `?` (nullable) is required because `Unsupported(...)` columns
must be nullable to compile — the typed client cannot construct a
non-null value for an opaque type at insert time. For STORED
generated columns this is purely cosmetic: the DB always populates
the value from the generation expression and never accepts a NULL.

The pairing is:

1. **Migration** — creates the column with the generated expression
   and any associated indexes (GIN, btree, etc).
2. **Schema declaration** — placeholder so `migrate dev` doesn't drop
   it.
3. **Service code** — reads the column via `Prisma.raw(...)` inside
   `$queryRaw` template literals (the typed client cannot select it).

## Prevention

1. **Whenever a migration adds a column that doesn't fit Prisma's
   typed model — generated columns, vectors, tsvector, geographic
   types, custom domains — pair it with a schema.prisma
   `Unsupported(...)?` placeholder in the same PR.** This is the
   safest default; the cost is one line per column.
2. **Test asserts schema/migration alignment.** A test that reads the
   migration file and the schema and asserts every column declared in
   one appears in the other catches the drift at PR time:
   ```ts
   it("declares title_tsv / description_tsv on VideoLocale", () => {
     const schema = readFileSync("prisma/schema.prisma", "utf8")
     expect(schema).toMatch(/title_tsv.*Unsupported\("tsvector"\)\?/)
     expect(schema).toMatch(/description_tsv.*Unsupported\("tsvector"\)\?/)
   })
   ```
3. **Document inline.** A comment near the placeholder pointing to the
   migration that owns the column makes the indirect ownership
   explicit for future readers.
4. **Generated-expression edits require coordinated DDL.** Postgres
   has no in-place editor for stored generated expressions — any
   change requires `DROP COLUMN ... CASCADE + ADD COLUMN ...` in a
   single migration, which also rebuilds dependent indexes. See
   `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
   for the full drift trap.

## Related

- `apps/admin/prisma/schema.prisma:622-651` — `VideoLocale.titleTsv` /
  `descriptionTsv` placeholders.
- `apps/admin/prisma/migrations/0009_keyword_first_lexical/migration.sql`
  — the migration that creates the columns.
- `apps/admin/prisma/schema.prisma` `embedding Unsupported("vector(1536)")?`
  precedent on `ExperienceLocale`, `VideoSceneLocale`,
  `VideoTranscriptChunk` — same pattern applied to pgvector columns.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
  — the broader generated-column drift trap (sibling concern).
- `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`
  — the R4-extension that surfaced this learning during ce:review.
