---
title: Prisma `@map`'d enums — raw SQL bypasses Prisma's coercion (write) AND the typed client surfaces the TS identifier to downstream consumers (read)
date: 2026-05-04
last_updated: 2026-05-18
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
  - Migrating a downstream consumer from a raw-SQL reader (Strapi, `pg`, hand-written
    SQL view) to a Prisma read of the same column — the consumer was seeing the
    `@map`'d storage value (camelCase) and will silently start receiving the TS
    enum identifier (UPPER_SNAKE_CASE) once Prisma is the reader.
tags:
  - postgres
  - prisma
  - enum
  - raw-sql
  - executeRaw
  - queryRaw
  - at-map
  - SourceTier
  - wire-shape
  - cms-to-admin-migration
  - llm-prompt-contract
related:
  - docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md
  - docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md
  - docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/plans/2026-05-18-001-refactor-decouple-manager-admin-trigger-from-strapi-plan.md
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

## Consumer-side mirror direction — Prisma typed reads silently flip casing for downstream consumers expecting the `@map`'d value (2026-05-18)

The original write-direction trap above flips when a downstream consumer migrates from a raw-SQL reader to a Prisma reader for the same column. Same `@map` asymmetry, opposite direction: now the **consumer** sees the TS enum identifier (UPPER_SNAKE) where it previously saw the `@map`'d storage value (camelCase).

### Concrete instance — PR #974 (feat-125, cms→admin)

Manager's `/api/admin-trigger/{scene-analysis,transcript}` endpoint historically looked up video dispatch fields from Strapi via `videos(filters: { coreId: { in } })` (Strapi's GraphQL reads raw — exposed the `@map`'d storage value, e.g., `'featureFilm'`). Manager interpolated this string directly into the LLM prompt: `'Video type: ${videoLabel}'`.

PR #974 decoupled that lookup onto admin's new `videosByCoreIds` GraphQL query, which reads via Prisma. The schema declares:

```prisma
enum VideoLabel {
  COLLECTION        @map("collection")
  EPISODE           @map("episode")
  FEATURE_FILM      @map("featureFilm")
  SEGMENT           @map("segment")
  SERIES            @map("series")
  SHORT_FILM        @map("shortFilm")
  TRAILER           @map("trailer")
  BEHIND_THE_SCENES @map("behindTheScenes")
}
```

After the refactor, `prisma.video.findFirst().label` returns `'FEATURE_FILM'` (TS identifier). The LLM prompt silently flipped from `Video type: featureFilm` to `Video type: FEATURE_FILM`. No tests failed — fixtures used stand-in lowercase strings (`label: "feature_film"`) that didn't match either reality. ce:review's correctness reviewer surfaced it at confidence 0.55 (sub-threshold for auto-apply because the issue is a runtime-trace concern, not static code).

### The fix — normalize at the service-projection seam, defensively

In `apps/admin/src/services/video.service.ts`:

```ts
return rows.map(
  (video): VideoForEnrichment => ({
    id: video.id,
    coreId: video.coreId,
    // Normalize TS UPPER_SNAKE identifier to the camelCase wire
    // shape Strapi previously emitted. Preserves prompt-content
    // byte-identity for sceneAnalysis.
    label: snakeUpperToCamel(video.label),
    // …
  }),
)

function snakeUpperToCamel(value: string | null): string | null {
  if (value == null) return null
  // Defensive: only transform UPPER_SNAKE_CASE. Anything else
  // passes through unchanged so a future Prisma config drift that
  // surfaces the DB-stored value (camelCase) directly doesn't get
  // silently lowercased by `.toLowerCase()`.
  if (!/^[A-Z][A-Z_]*$/.test(value)) return value
  return value
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
```

The `^[A-Z][A-Z_]*$` regex guard is load-bearing: `.toLowerCase()` is non-idempotent on already-camelCase input. Without the guard, `featureFilm` → `featurefilm` — corrupts already-conforming input on partial rollback or future Prisma config change.

### Why the projection seam is the right layer

1. It's where admin commits to its GraphQL wire shape. Downstream callers treat admin's GraphQL surface as a contract; admin owns matching the pre-refactor shape.
2. Doing the transform deeper (a Prisma extension) couples every reader of `Video.label` to the wire shape, including admin-internal callers that may legitimately want the TS identifier.
3. Doing it shallower (manager's prompt-construction logic) leaks admin's Prisma representation choice into manager — exactly the coupling the refactor was trying to remove.

### Prevention rules specific to the read direction

6. **Read `schema.prisma` `@map` directives BEFORE assuming Prisma's exposed value matches a prior raw-DB-read consumer's shape.** Any cms→admin (or raw-SQL→Prisma) refactor crossing a `@map`'d enum or column must enumerate the affected fields explicitly in the plan and add a wire-shape comparison row to the cutover checklist.
7. **Use real Prisma enum values in unit-test fixtures.** `label: "FEATURE_FILM"` not `label: "feature_film"`. A fixture that doesn't match what Prisma actually returns is worse than no fixture — it manufactures false confidence. Lint candidate: flag fixture strings for `@map`'d enum columns that don't match `schema.prisma`'s TS identifiers.
8. **Add a wire-shape parity test for any refactor that swaps the data source upstream of an LLM prompt or external consumer.** Capture a pre-refactor sample of the consumer's input (the actual prompt string, the actual response payload), commit it as a fixture, assert byte-identity on the new path's output.
9. **Defensive normalizers must regex-guard their input shape before transforming.** Unconditional `.toLowerCase()` (or `.toUpperCase()`, `.replace()`) is non-idempotent. Every normalizer needs both a transform-the-expected-input test AND a passthrough-the-already-normalized-input test.
10. **Question whether `@map` is doing useful work post-sunset.** `@map` exists to preserve a legacy storage representation chosen by an earlier writer (Strapi, here). Once the original writer is sunset, the `@map` becomes pure cost — adds a TS-vs-DB asymmetry with no remaining benefit. For `VideoLabel`, the `@map` should be removed in the post-Strapi-sunset cleanup, the column migrated to UPPER_SNAKE storage, and the projection-layer normalizer deleted. Track this as a follow-up so the workaround doesn't outlive the constraint that justified it.

### Cross-references for the read-direction instance

- `apps/admin/src/services/video.service.ts` — picker + `snakeUpperToCamel` normalizer
- `apps/admin/src/services/video.service.test.ts` — camelCase transform + defensive passthrough tests
- `apps/admin/prisma/schema.prisma` `enum VideoLabel` — the `@map` directives
- `apps/manager/src/services/sceneAnalysis.ts` — downstream LLM prompt consumer
- `docs/plans/2026-05-18-001-refactor-decouple-manager-admin-trigger-from-strapi-plan.md` — feat-125 plan (the refactor that surfaced this)
- `docs/roadmap/platform/feat-125-decouple-manager-admin-trigger-from-strapi.md` — roadmap ticket
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — parent learning; this is another worked instance of "mocked tests prove BRANCH SHAPE; real fixtures prove PRODUCTION CONTRACT," now at the Prisma `@map` seam

## Related learnings

- The bind-variable fix that triggered this discovery: `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`. Both fixes typically land together when a `prisma.<Model>.updateMany({ <enumField>: "VALUE", <relation>: { notIn: [...] }})` call is migrated to raw SQL.
- The umbrella fan-out doc that surfaced the bind-var fix: `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`.
- Why mocked tests can't catch this class without a SQL-shape invariant: `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`.
- The META mocked-vs-real testing discipline that the read-direction instance is a textbook case of: `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.
