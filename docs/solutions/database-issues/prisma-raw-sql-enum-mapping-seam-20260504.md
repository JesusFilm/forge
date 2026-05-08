---
title: Prisma raw SQL bypasses `@map`'d enum value coercion
date: 2026-05-04
last_updated: 2026-05-04
category: database-issues
module: apps/admin
problem_type: database_issue
component: database
root_cause: wrong_api
resolution_type: code_fix
severity: high
applies_when:
  - Writing `$executeRaw` / `$queryRaw` SQL that filters or writes a column backed by
    a Prisma enum with `@map`'d values (e.g., `enum SourceTier { CORE @map("core") … }`).
  - Migrating a `prisma.<Model>.<op>({ where: { <enumField>: "VALUE" }})` call to raw SQL.
  - Reviewing a code-review finding that a raw SQL enum literal might not match the DB.
tags:
  - postgres
  - prisma
  - enum
  - raw-sql
  - executeRaw
  - queryRaw
  - at-map
  - SourceTier
related:
  - docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md
  - docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md
  - docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md
---

# Prisma raw SQL bypasses `@map`'d enum value coercion

## Problem

When a Prisma enum's TS-side variant name differs from its DB-side literal value via `@map`:

```prisma
enum SourceTier {
  CORE    @map("core")
  MANAGER @map("manager")
}
```

Prisma's high-level API (`findMany`, `updateMany`, `upsert`, etc.) **transparently translates** `{ source: "CORE" }` in your TS call into `'core'` in the SQL it sends to Postgres. Raw SQL via `$executeRaw` / `$queryRaw` **does not** — whatever literal you write goes verbatim. If you write `WHERE "source" = 'CORE'`, Postgres validates the enum literal against the actual DB type `('core', 'manager')` and throws at parse time:

```
invalid input value for enum "SourceTier": "CORE"
```

The throw is parse-time, not runtime — it fires before any rows are read or written, regardless of whether the table contains data.

## Symptoms

- `invalid input value for enum "<EnumTypeName>": "<TS_VALUE>"` from Postgres.
- Reproduces on every invocation of the raw SQL — never intermittent.
- Mocked unit tests for the call site stay green because mocks don't enforce DB-level enum constraints.
- Often surfaces during a refactor that swaps `prisma.<Model>.updateMany({ <enumField>: "TS_VALUE", … })` for `$executeRaw` "for performance" or "to bypass the bind-variable limit." The performance migration succeeds; the case translation gets silently lost.

## What didn't work

- **Trusting unit-test green light.** The `$executeRaw` was structurally tested (SQL contains `UPDATE`, `NOT (`, `= ANY`, `text[]`) and integration-tested via a 209k-row local sync. The integration sync would have hit the bug — but only if it reached the soft-delete tail. In our case the local DB had been freshly synced, so the soft-delete `UPDATE` had nothing to mark deleted, and Postgres still parses the literal at planning time before noticing zero affected rows. Whether the bug fires depends on whether enum-literal validation happens at parse time vs execution time, and Postgres errs on the side of strict (parse-time).
- **Reading Prisma's docs.** Prisma's docs say "Prisma maps enum names to/from DB values" without warning that the mapping is one-way (high-level API only). The seam is implicit; nothing in the type system or query log surfaces it.

## Solution

Match the literal exactly to the DB-side `@map` value:

```ts
// schema.prisma:
//   enum SourceTier {
//     CORE    @map("core")
//     MANAGER @map("manager")
//   }
// 0001_init.sql confirms: CREATE TYPE "SourceTier" AS ENUM ('core', 'manager');

// Wrong (parse-time enum literal error):
const affected = await prisma.$executeRaw`
  UPDATE "video_dub"
  SET    "deleted_at" = NOW()
  WHERE  "source"     = 'CORE'      -- TS variant name, NOT the DB value
    AND  "deleted_at" IS NULL
`

// Right (matches the @map'd literal):
const affected = await prisma.$executeRaw`
  UPDATE "video_dub"
  SET    "deleted_at" = NOW()
  WHERE  "source"     = 'core'      -- DB value
    AND  "deleted_at" IS NULL
`

// Equally right (explicit enum cast — safer when the literal could be ambiguous):
const affected = await prisma.$executeRaw`
  UPDATE "video_dub"
  SET    "deleted_at" = NOW()
  WHERE  "source"     = 'core'::"SourceTier"
    AND  "deleted_at" IS NULL
`
```

## Why this works

`@map` is a Prisma-side declaration that controls how the Prisma client serializes values when _it_ generates SQL. The Postgres enum type itself only knows about the literal values created by the migration (`CREATE TYPE … AS ENUM ('core', 'manager')`). The Prisma client extension that does the case translation lives between your TS code and the SQL string — `$executeRaw` hands the SQL string to Prisma's runtime _after_ that extension would have run, so the translation never happens.

The `::"SourceTier"` cast variant is more defensive: it makes the enum type explicit and survives a future migration that might rename the type (the cast would still need to be updated, but it would error visibly rather than silently filtering nothing).

## Prevention

1. **Treat every raw-SQL enum literal as a test target.** Add an assertion to the SQL-shape regression test that the literal matches the DB value (not the TS variant). For `SourceTier` that means `expect(sql).toContain("'core'")` (lowercase), not `expect(sql).toContain("CORE")`.
2. **Grep before merging any raw-SQL change.** The pattern `$(executeRaw|queryRaw).*'(CORE|MANAGER|DRAFT|PUBLISHED|HISTORICAL|…)'` (uppercase enum names inside raw SQL string templates) should match zero lines. If it matches anything, that's the seam manifesting.
3. **Prefer the explicit `::"EnumType"` cast over the bare literal.** If the migration ever renames the enum type, the cast site fails loudly with a typename error rather than silently degrading to no-op (since `'core'` happens to be a valid string with no constraint when there's no cast).
4. **When migrating Prisma high-level calls to raw SQL** for performance reasons (e.g., escaping the 32,767 bind-variable cap — see related doc), audit every enum-typed `where` / `set` operand for case translation. The bind-var fix and this enum-case fix are independent gotchas that bite in the same refactors.
5. **Document the `@map` direction clearly in `schema.prisma`.** A `///` doc comment on each `@map`'d enum value noting "DB literal is `<lowercase>`; high-level Prisma maps `<UPPERCASE>` → `<lowercase>` automatically; raw SQL must use `<lowercase>`" makes the seam discoverable at the schema-definition site.

### Audit recipe (one-time sweep)

```bash
# Find raw-SQL templates with potentially-uppercase enum literals.
grep -rn -E '\$(executeRaw|queryRaw)' --include='*.ts' src/ | head
grep -rn -E "= '[A-Z]+'" --include='*.ts' src/services/ | head
# Cross-reference against schema.prisma's enum @map declarations:
grep -nE '@map\("[a-z]+"\)' prisma/schema.prisma
```

Anywhere the TS-side variant (uppercase) appears inside a `$executeRaw` / `$queryRaw` template against an `@map`'d enum column, replace with the DB-side literal (lowercase) or add an explicit `::"EnumType"` cast.

## Related learnings

- The bind-variable fix that triggered this discovery: `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`. Both fixes typically land together when a `prisma.<Model>.updateMany({ <enumField>: "VALUE", <relation>: { notIn: [...] }})` call is migrated to raw SQL.
- The umbrella fan-out doc that surfaced the bind-var fix: `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`.
- Why mocked tests can't catch this class without a SQL-shape invariant: `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`.
