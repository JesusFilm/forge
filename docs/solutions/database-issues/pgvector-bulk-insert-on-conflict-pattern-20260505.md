---
title: pgvector bulk INSERT … unnest(...) ON CONFLICT pattern with per-row Way A vector cast
date: 2026-05-05
last_updated: 2026-05-05
category: database-issues
module: apps/admin
problem_type: performance
component: database
root_cause: round_trip_amplification
resolution_type: code_fix
severity: high
applies_when:
  - Persisting tens-to-hundreds of rows per logical batch into a Postgres table that has at least one `vector(N)` column (pgvector).
  - The current shape is a per-row `Prisma.<model>.upsert({ … })` loop followed by a per-row `$executeRaw … UPDATE … SET embedding = $1::vector` write.
  - Every batch shares a stable conflict key (e.g. `(parent_id, index)` or `(parent_id, locale)`) so the canonical idiom is `INSERT … ON CONFLICT … DO UPDATE`.
  - The same caller already uses `apps/admin/src/db/pgvector.ts::toPgArray` for non-vector array binds (the bind-variable-cap pattern); the new write should keep the same array-bind discipline.
tags:
  - pgvector
  - postgres
  - prisma
  - bulk-insert
  - on-conflict
  - unnest
  - way-a
  - vector-cast
  - admin
  - performance
  - embed-backfill
related:
  - docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md
  - docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md
  - docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md
  - docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md
  - docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md
  - docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md
  - docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md
  - docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md
---

# pgvector bulk INSERT … unnest(...) ON CONFLICT pattern with per-row Way A vector cast

## Problem

The R1 scene-embedding indexer and R2 transcript-embedding indexer wrote rows in a per-row loop inside `prisma.$transaction`:

1. `tx.<parent>.upsert({ where, create, update })` — round-trip per scene / chunk.
2. `tx.<locale or chunk>.upsert({ … })` — round-trip per locale row.
3. `tx.$executeRaw\`UPDATE … SET embedding = ${toPgVector(v)}::vector …\``— round-trip per row to populate the vector (Prisma's`Unsupported("vector(1536)")?` column can't be set via the standard upsert payload).

A 50-scene × 30-locale video paid ~3,000 round-trips per backfill of a single video; the corpus aggregate ran into the millions. Stage 1 (parallelism) and Stage 2 (S3 cache + batched OpenRouter) had wrung most of the network and OpenRouter cost out of the workflow; the per-target write loop was the remaining bottleneck.

## Symptoms

- Per-target wall time dominated by `prisma.$transaction` body even on local Postgres (~15 ms / scene-locale pair on Railway).
- `pg_stat_statements` shows N copies of the same upsert SQL per logical batch (one per row), each with distinct bind values — index-scan latency per call is fine; the round-trip count is the problem.
- The per-row pattern would also re-trip Postgres's 32,767 prepared-statement parameter cap (`PG_INT16_MAX`) at corpus scale if compaction was attempted via `IN (...)` or `VALUES (...)` literals — a separate documented trap; see the bind-variable-cap doc above.

## What didn't work

- **Pothos / Prisma `createMany`.** Doesn't support `ON CONFLICT … DO UPDATE` (only `skipDuplicates`). Locale rows MUST upsert: a re-run that finds existing rows needs them updated, not skipped.
- **`prisma.$queryRaw\`INSERT … VALUES ($1, $2, …) ON CONFLICT …\``** with per-row `($1, $2, ...)` tuples. Works for tens of rows; would re-introduce the bind-variable cap at scale (one prepared-statement parameter per row × per column).
- **`?::vector(1536)[]` array-parameter cast.** pgvector documents the per-row `'[…]'::vector(N)` text cast extensively; the array-element parser for `'{[…],[…]}'::vector(1536)[]` is comparatively less-trodden code. The few public references to it require Postgres + pgvector versions that are not currently locked in across local dev / preview / prod. Picking this would have been a "works in development, surprises in production" hazard.
- **Splitting writes into "INSERT all rows that don't exist" + "UPDATE all rows that do".** Loses atomicity for the row-state transition (a parent that got soft-deleted between the two halves leaves dangling locale rows); requires a `SELECT ... FOR UPDATE` on the parent first, which is its own can of worms.
- **Bulk-insert WITHOUT a follow-up SELECT.** `RETURNING id` from `INSERT … ON CONFLICT DO NOTHING` returns rows for inserts only — ids for pre-existing parents are lost. The rerun path cannot proceed without those ids (the locale-row INSERT needs `video_scene_id` for ALL incoming scenes, not just the freshly-created ones). A naive `RETURNING id` rerun silently writes the locale rows ONLY for newly-created scenes; pre-existing scenes' locale data ages.
- **`json_array_elements_text(... ::jsonb)` for the Way A unfold.** PostgreSQL has TWO distinct functions for unfolding a JSON array into a row set of text: `json_array_elements_text(json)` and `jsonb_array_elements_text(jsonb)`. They are NOT overloaded across the json/jsonb seam — there is no `json_array_elements_text(jsonb)` overload, and PG raises `42883 function … does not exist` at parse time. The Stage 3 PR shipped with `json_array_elements_text(u.col_json::jsonb)` (wrong function for the cast we used); every mocked unit test passed (the SQL-shape regex `/jsonb?_array_elements_text/` matched both spellings), and the bug was only caught by a local smoke run against real PG18. **The mocked-SQL test discipline (`docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`) catches clause SHAPE but does NOT catch function-name resolution under PG's overload rules.** A real-DB smoke is the only reliable signal for this class of bug. The fix is to call `jsonb_array_elements_text` whenever the input is `::jsonb` (and `json_array_elements_text` whenever the input is `::json`).

## Solution

**One transaction per logical target. Two-statement parent flow + one-statement leaf flow. Per-row Way A casts at the SELECT seam.**

```ts
// 1. Bulk parent INSERT — `unnest(arr1, arr2, ...)` from PG-array-literal binds,
//    cast per-row via `u.col::int` / `u.col::double precision` etc.
//    `ON CONFLICT DO NOTHING` so reruns don't fail on existing parents.
await tx.$executeRaw`
  INSERT INTO video_scene (
    id, video_edition_id, video_id, scene_index,
    start_seconds, end_seconds, chapter_title,
    created_at, updated_at
  )
  SELECT u.id, u.video_edition_id, u.video_id,
         u.scene_index::int,
         u.start_seconds::double precision,
         u.end_seconds::double precision,
         u.chapter_title,
         NOW(), NOW()
  FROM unnest(
    ${toPgArray(parentIds)}::text[],
    ${toPgArray(parentVideoEditionIds)}::text[],
    ${toPgArray(parentVideoIds)}::text[],
    ${toPgArray(sceneIndexes.map((n) => String(n)))}::text[],
    ${toPgArray(parentStartSeconds)}::text[],
    ${toPgArray(parentEndSeconds)}::text[],     // accepts unquoted NULL elements
    ${toPgArray(parentChapterTitles)}::text[]   // accepts unquoted NULL elements
  ) AS u(id, video_edition_id, video_id, scene_index,
         start_seconds, end_seconds, chapter_title)
  ON CONFLICT (video_edition_id, scene_index) DO NOTHING
`

// 2. Follow-up SELECT recovers ids for ALL incoming sceneIndexes — both
//    freshly inserted AND pre-existing.
const parentRows = await tx.$queryRaw<{ id: string; scene_index: number }[]>`
  SELECT id, scene_index
  FROM video_scene
  WHERE video_edition_id = ${editionId}
    AND scene_index = ANY(
      SELECT s::int FROM unnest(${toPgArray(sceneIndexes.map(String))}::text[]) AS s
    )
`

// 3. Bulk leaf INSERT … ON CONFLICT … DO UPDATE — Way A vector cast at the
//    SELECT seam, NOT a `::vector(1536)[]` parameter cast. Way A also applied
//    to the `text[]` columns (themes etc.) via `jsonb_array_elements_text`.
await tx.$executeRaw`
  INSERT INTO video_scene_locale (
    id, video_scene_id, locale, source_text, description,
    themes, bible_verses, demographics, spiritual_context,
    model, dimensions, embedding,
    created_at, updated_at
  )
  SELECT
    u.id,
    u.video_scene_id,
    u.locale,
    u.source_text,
    u.description,
    ARRAY(SELECT jsonb_array_elements_text(u.themes_json::jsonb)),
    ARRAY(SELECT jsonb_array_elements_text(u.bible_verses_json::jsonb)),
    ARRAY(SELECT jsonb_array_elements_text(u.demographics_json::jsonb)),
    ARRAY(SELECT jsonb_array_elements_text(u.spiritual_context_json::jsonb)),
    u.model,
    u.dimensions::int,
    u.embedding_text::vector(1536),
    NOW(),
    NOW()
  FROM unnest(
    ${toPgArray(localeIds)}::text[],
    ${toPgArray(videoSceneIds)}::text[],
    ${toPgArray(locales)}::text[],
    ${toPgArray(sourceTexts)}::text[],
    ${toPgArray(descriptions)}::text[],
    ${toPgArray(themesJson)}::text[],          /* JSON.stringify(values) per row */
    ${toPgArray(bibleVersesJson)}::text[],
    ${toPgArray(demographicsJson)}::text[],
    ${toPgArray(spiritualContextJson)}::text[],
    ${toPgArray(models)}::text[],
    ${toPgArray(dimensionsArr)}::text[],
    ${toPgArray(vectorTexts)}::text[]          /* toPgVector(embedding) per row */
  ) AS u(id, video_scene_id, locale, source_text, description,
         themes_json, bible_verses_json, demographics_json, spiritual_context_json,
         model, dimensions, embedding_text)
  ON CONFLICT (video_scene_id, locale)
  DO UPDATE SET
    source_text       = EXCLUDED.source_text,
    description       = EXCLUDED.description,
    themes            = EXCLUDED.themes,
    bible_verses      = EXCLUDED.bible_verses,
    demographics      = EXCLUDED.demographics,
    spiritual_context = EXCLUDED.spiritual_context,
    model             = EXCLUDED.model,
    dimensions        = EXCLUDED.dimensions,
    embedding         = EXCLUDED.embedding,
    updated_at        = NOW()
`
```

**Length-equality preflight is mandatory.** PostgreSQL 18's `unnest(arr1, arr2, ...)` silently NULL-pads unequal-length arrays — a regression that drops a row from a parallel-array bind would corrupt the INSERT without raising. Throw a typed error BEFORE `$executeRaw`:

```ts
function assertParallelArrayLengthsMatch(
  expected: number,
  arrays: ReadonlyArray<{ name: string; length: number }>,
): void {
  for (const arr of arrays) {
    if (arr.length !== expected) {
      throw new SceneIndexError(
        "artifact_invalid",
        `parallel-array length mismatch (expected=${expected}, ${arr.name}=${arr.length})`,
      )
    }
  }
}
```

**`toPgArray` extension.** The helper at `apps/admin/src/db/pgvector.ts` accepts `readonly (string | null)[]` and emits the unquoted `NULL` token for nullish elements (Stage 3 widening). The literal three-character string `"NULL"` survives as a quoted element distinct from a SQL NULL. Brace characters (`{`, `}`) still throw at the input boundary — they are structural in PG array literals.

**JSONB-vs-text[] correction.** `themes`, `bibleVerses`, `demographics`, `spiritualContext` are `String[]` in `schema.prisma` (i.e. PG `text[]`), NOT `jsonb`. An earlier version of the implementation plan suggested casting through `jsonb` with `?::jsonb::text[]`; PostgreSQL 18 on Railway rejects that chained cast (see root `CLAUDE.md`'s "Known Patterns"). The Way A unfold via `ARRAY(SELECT jsonb_array_elements_text(u.<col>_json::jsonb))` is the right shape: bind a JSON-stringified payload as `text[]`, parse-and-unfold inside the SELECT, never reach for the chained cast.

## Why this works

- **Round-trip count drops from O(scenes × locales) to O(1)** per `(video, edition, locale)` write batch, plus one parent INSERT and one parent SELECT per `(video, edition)`.
- **Bind-variable count is constant.** Each parallel array binds as ONE positional parameter. Doubling the row count adds zero parameters; the bind-variable cap (`PG_INT16_MAX = 32,767`) is no longer in play.
- **Way A vector cast (`u.embedding_text::vector(1536)` per row in the SELECT) is the documented and well-exercised pgvector idiom.** The avoided alternative (`?::vector(1536)[]` parameter cast) is the multi-element array-input parser path which has fewer real-world references at our pgvector / Postgres version.
- **Way A `text[]` unfold via `jsonb_array_elements_text(u.col_json::jsonb)`** sidesteps PG18's chained-cast trap while keeping the per-row cast at the SELECT seam — same discipline as the vector cast.
- **`DO NOTHING` parent + follow-up SELECT** preserves rerun idempotency for both fresh and pre-existing rows. `RETURNING id` alone fails reruns; the SELECT covers both cases at one round-trip.
- **Length-equality preflight** turns PG's silent NULL-pad-on-mismatch into a typed throw at the call site, before the bad SQL ships. Tests assert `$executeRaw` is never called on length mismatch.

## HNSW maintenance is per-row internally

The `embedding` column carries a partial HNSW index (per-locale on R1, per-language on R2). pgvector's HNSW maintains the graph one vector at a time INSIDE the bulk INSERT — there is no graph-wide batch-build optimization triggered by sending many rows at once. The bulk-insert pattern saves NETWORK round-trip cost, not graph-maintenance cost. For very large one-off backfills the operator-mode `DROP INDEX → bulk INSERT → CREATE INDEX` sequence WOULD save graph-maintenance cost — but that takes AccessExclusiveLock and is dangerous on a live table. **Out of scope for Stage 3; flagged as a future enhancement only.**

## Prevention

- **SQL invariant tests** (per `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`). Capture the `$executeRaw` template-strings argument via mock; assert the SQL contains: `INSERT INTO <table>`, `unnest(`, `::text[]`, `::vector(1536)` (NOT followed by `[]`), `ON CONFLICT (<conflict_key>)`, `DO UPDATE SET`, `EXCLUDED.embedding`, `jsonb_array_elements_text` (proves Way A unfold for text[] columns).
- **Bind-count regression test.** Run the bulk INSERT with N=3 and N=30; assert the bound-parameter count is identical. Catches a regression to per-row `INSERT … VALUES ($1,$2,…)` shape that would re-introduce the bind-variable cap at scale.
- **Length-equality preflight test.** Inject parallel arrays of unequal length; assert `$executeRaw` is never called and the throw fires. Catches a regression that drops the preflight (silent NULL-pad on PG18).
- **Vector position stability test.** Bind two known-distinct vectors (e.g. `[0.111,...]` and `[0.222,...]`); assert the bound `text[]` of vector literals contains them in input-array order. Catches a regression that swaps `embeddings[i]` with `embeddings[j]` somewhere in the prep loop.
- **`toPgArray` round-trip tests.** `toPgArray([null, "x"])` produces `{NULL,"x"}` (unquoted NULL token); `toPgArray(["NULL", "x"])` produces `{"NULL","x"}` (quoted three-char string distinct from SQL NULL); brace input throws.
- **No `::vector(1536)[]` in any new bulk-INSERT site.** Way A discipline is the convention; the test asserts SQL does NOT contain `::vector(1536)[]`.
- **No enum literals in raw SQL on new tables.** R1's `video_scene` / `video_scene_locale` and R2's `video_transcript_chunk` write no enum columns today. If a future field is added, use the `@map`'d lowercase DB literal per `docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md`.
- **Real-DB smoke is mandatory before merging any new bulk-INSERT site.** Mocked SQL-shape tests cannot catch PG function-name resolution errors (`json_array_elements_text(jsonb)` vs `jsonb_array_elements_text(jsonb)`), enum-literal case mismatches at the parse boundary, type-cast incompatibilities specific to a PG version, or the silent NULL-pad on unequal-length unnest. Stage 3 caught its own `json_array_elements_text(jsonb)` regression via local smoke against `forge_admin` — without that step the bug would have shipped to prod and broken every R1 scene write. PR description should include the real-DB smoke run output as evidence. **This lesson is the SQL-side instance of the META rule documented in `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — mocked tests prove BRANCH SHAPE; real fixtures prove PRODUCTION CONTRACT.**
