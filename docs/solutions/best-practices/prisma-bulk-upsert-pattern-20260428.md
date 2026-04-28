---
title: "Bulk upsert in Prisma via `$executeRaw` + `Prisma.join` + `INSERT … ON CONFLICT DO UPDATE`"
category: best-practices
date: 2026-04-28
tags:
  - prisma
  - bulk-upsert
  - raw-sql
  - postgres
  - cuid2
  - core-sync
  - admin
problem_type: best_practice
component: database
root_cause: missing_tooling
resolution_type: code_fix
severity: medium
---

# Bulk upsert in Prisma via `$executeRaw` + `Prisma.join` + `INSERT … ON CONFLICT DO UPDATE`

## Problem

Prisma's typed `model.upsert()` issues one round-trip per row.
For a sync that writes hundreds of rows per page, that's
hundreds of round-trips per page — and as documented in
`docs/solutions/database-issues/prisma-transaction-timeout-wrong-tool-for-per-row-bulk-20260428.md`,
wrapping the loop in an interactive `$transaction` to recover
per-page atomicity reliably hits the 5s timeout in production.

We need an idiom that:
- writes the whole page atomically in **one round-trip**,
- doesn't require an interactive transaction,
- preserves per-row idempotency (re-running is safe),
- supports MANAGER-style per-row protection (see companion doc),
- types cleanly enough to read in code review.

## Solution

Build the page as a list of `Prisma.sql` value tuples, join them
with `Prisma.join`, and dispatch a single
`INSERT … ON CONFLICT DO UPDATE` via `$executeRaw`:

```ts
import { Prisma, type PrismaClient } from "@prisma/client"
import { jsonbParam, newRowId } from "../bulk-upsert"

const now = new Date()
const rowTuples = pageRows.map((row) => {
  // Column order: id, core_id, name, bcp47, iso3, synced_at, updated_at
  return Prisma.sql`(${newRowId()}, ${row.id}, ${jsonbParam(row.name)}, ${row.bcp47}, ${row.iso3}, ${now}, ${now})`
})

const affected = await prisma.$executeRaw(
  Prisma.sql`
    INSERT INTO "language" ("id", "core_id", "name", "bcp47", "iso3", "synced_at", "updated_at")
    VALUES ${Prisma.join(rowTuples, ", ")}
    ON CONFLICT ("core_id") DO UPDATE SET
      "bcp47"      = EXCLUDED."bcp47",
      "iso3"       = EXCLUDED."iso3",
      "name"       = EXCLUDED."name",
      "synced_at"  = EXCLUDED."synced_at",
      "updated_at" = EXCLUDED."updated_at",
      "deleted_at" = NULL
  `,
)
stats.updated += Number(affected)
```

### Required helpers (admin uses these in `apps/admin/src/services/core-sync/bulk-upsert.ts`)

```ts
import { Prisma } from "@prisma/client"
import { createId } from "@paralleldrive/cuid2"

/**
 * Generate a fresh primary-key id. Prisma's `@default(cuid())` is
 * generated JS-side at create-time; raw SQL inserts have no DB-side
 * default to fall back on, so we need to mint it ourselves.
 *
 * Uses cuid v2 (different format from Prisma's default cuid v1, but
 * both are valid `String` ids — the two coexist without issue).
 */
export function newRowId(): string {
  return createId()
}

/**
 * Wrap a JSON-serializable value for INSERT into a `jsonb` column.
 * Postgres requires an explicit `::jsonb` cast on parameterised JSON
 * literals; passing a plain string lands as text and the column type
 * coercion fails. Mandatory on Postgres 18+ where the
 * `?::jsonb::text[]` shortcut is no longer accepted (see
 * `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`).
 */
export function jsonbParam(value: unknown): Prisma.Sql {
  return Prisma.sql`${JSON.stringify(value)}::jsonb`
}

/**
 * Structured-log payload for a bulk-upsert failure. Centralises the
 * extraction of Prisma's `code`/`meta` (Postgres SQLSTATE +
 * constraint name on UNIQUE/CHECK violations) so per-phase catch
 * blocks emit the same diagnostic shape.
 */
export function bulkErrorLogFields(err: unknown): {
  error: string
  errorCode?: string
  errorMeta?: unknown
} {
  if (err instanceof Error) {
    const prisma = err as Error & { code?: string; meta?: unknown }
    return {
      error: err.message,
      ...(typeof prisma.code === "string" ? { errorCode: prisma.code } : {}),
      ...(prisma.meta !== undefined ? { errorMeta: prisma.meta } : {}),
    }
  }
  return { error: String(err) }
}
```

### Multi-statement sequences

When the page logically requires two statements (e.g. parent before
child, or dedup'd-lookup followed by dependent insert), wrap them in
`$transaction({ timeout: 30_000, maxWait: 5_000 })` for
cross-statement atomicity. **This is safe** vs the per-row anti-
pattern — each statement is a single bulk INSERT (sub-second), not
a 500-iteration loop. 30s is 30x+ headroom.

```ts
const writtenCount = await prisma.$transaction(
  async (tx) => {
    // Step 1: bulk INSERT parent + RETURNING to get the (id, core_id)
    // map for FK resolution.
    const parents = await tx.$queryRaw<
      Array<{ id: string; core_id: string }>
    >(Prisma.sql`INSERT INTO "parent" ... RETURNING "id", "core_id"`)
    const fkMap = new Map(parents.map((p) => [p.core_id, p.id]))

    // Step 2: bulk INSERT child rows that reference the just-inserted
    // parent ids via fkMap.
    return tx.$executeRaw(Prisma.sql`INSERT INTO "child" ...`)
  },
  { timeout: 30_000, maxWait: 5_000 },
)
```

Admin uses this for `sync-countries` (Continent → Country) and
`sync-videos` (Video → VideoLocale).

### Boilerplate per phase

Each phase follows the same skeleton:

```ts
try {
  const now = new Date()
  const rowTuples = pageRows.map(...)
  const affected = await prisma.$executeRaw(Prisma.sql`INSERT ... ON CONFLICT ...`)
  stats.updated += Number(affected)
} catch (err) {
  stats.errors++
  console.error(
    JSON.stringify({
      event: "core-sync.<entity>.error",
      offset,
      firstCoreId: pageRows[0]?.id,
      lastCoreId: pageRows[pageRows.length - 1]?.id,
      ...bulkErrorLogFields(err),
    }),
  )
}
```

## Why This Works

- **One statement, one round-trip**: shipping the entire batch in
  one SQL message means total latency = ~one network round-trip,
  not N. Over Railway's proxy this is the difference between ~5s
  and ~30ms for a 500-row page.
- **Atomic without an interactive transaction**: Postgres applies
  the whole `INSERT … ON CONFLICT` as one statement; partial
  application is impossible. No `BEGIN`/`COMMIT` ceremony, no
  timeout pressure.
- **Idempotent by construction**: re-running with the same input
  is a no-op (every row already conflicts on `core_id`, the UPDATE
  branch sets the same values).
- **`Prisma.sql` + `Prisma.join` is parameterised, not string-
  concatenated**: every `${value}` becomes a bound parameter.
  SQL injection isn't possible even with hostile Core API input.

## Constraints

- **Postgres bind-parameter limit is 65535.** With ~10 cols per
  row, PAGE_SIZE=500 stays at ~5000 params — comfortable headroom.
  When the per-row column count is high (e.g. admin's video_dub
  with 14 cols) or when fan-out is unbounded (e.g. video_locale
  flattens N locales × M videos), audit the worst-case param count
  before raising PAGE_SIZE.
- **Raw SQL loses the typed-schema check**: the column list and
  the `${value}` tuple order must match by position, with no
  compile-time verification. Add a `// Column order: ...` comment
  on every `Prisma.sql\`(${...})\`` builder, and lock invariants
  with the SQL-text scrape pattern from
  `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`.
- **`@default(cuid())` does not generate a Postgres-side default
  for `id`**: you must mint the id JS-side via `newRowId()` (above).
- **`jsonb` columns require the explicit `::jsonb` cast**: use
  `jsonbParam(value)`. Plain `${JSON.stringify(value)}` binds as
  `text` and the column-type coercion fails.
- **The catch block's blast radius is the whole page**: a single
  bad row aborts the entire bulk INSERT, vs the legacy per-row
  upsert where one bad row failed only itself. Tighten upstream
  validation (e.g. Zod's `z.string().datetime()` instead of
  `z.string().min(1)` for ISO timestamps) so bad rows drop at
  parse time and don't reach the bind.

## Prevention

- **Reach for this pattern any time you'd write a per-row Prisma
  loop inside `$transaction`** for bulk write throughput. The
  exception is fixed-N cross-statement coordination (e.g. "insert
  one parent and one child") — there a small interactive
  transaction is fine.
- **Always include a `// Column order: ...` comment** on each
  `Prisma.sql\`(${...})\`` value builder. The columns and the
  values must match by position; the comment is the only thing
  documenting the binding.
- **Always include `firstCoreId`/`lastCoreId` in the catch log**.
  Without them, debugging a failed page means bisecting a 500-row
  Core payload by hand.
- **Lock the SQL invariants** with a unit test that asserts the
  generated SQL contains the load-bearing clauses (`INSERT INTO
  "<table>"`, `ON CONFLICT (...) DO UPDATE`, the `WHERE` clause if
  any). See the SQL-text scrape pattern doc for the technique.

## Related

- `docs/solutions/database-issues/prisma-transaction-timeout-wrong-tool-for-per-row-bulk-20260428.md`
  — the failure mode this pattern replaces.
- `docs/solutions/best-practices/prisma-on-conflict-where-row-protection-20260428.md`
  — companion pattern for per-row protection in a bulk statement
  (admin's MANAGER protection on Video and VideoDub).
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
  — locking the raw-SQL clauses against drift.
- `docs/solutions/cms/core-sync-per-page-upsert-pattern.md` — cms's
  predecessor (Knex-flavoured).
- `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md`
  — cms's alternate approach (temp table + UPDATE FROM); useful
  when ON CONFLICT semantics aren't a fit.
- `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
  — PG18 jsonb cast caveat + `toPgArray()` helper.
- PR #846 in JesusFilm/forge — five worked examples
  (`apps/admin/src/services/core-sync/phases/sync-{languages,countries,keywords,videos,dubs}.ts`)
  + the helpers in `apps/admin/src/services/core-sync/bulk-upsert.ts`.
