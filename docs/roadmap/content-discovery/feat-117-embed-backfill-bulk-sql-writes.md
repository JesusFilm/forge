---
id: "feat-117"
title: "Embed Backfill — Stage 3 — Bulk DB Writes via INSERT … ON CONFLICT"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-08"
duration: 2
depends_on:
  - "feat-116"
blocks: []
tags:
  - "admin"
  - "ai-pipeline"
  - "performance"
  - "postgres"
  - "pgvector"
---

## Resolution

**Shipped:** 2026-05-05 via [PR #889](https://github.com/JesusFilm/forge/pull/889) (`perf(admin): bulk DB writes via INSERT … unnest(...) ON CONFLICT (feat-117)`). Stage 3 of the four-stage embed-backfill performance plan ([`docs/plans/2026-05-04-002-refactor-admin-embed-backfill-performance-plan.md`](../../plans/2026-05-04-002-refactor-admin-embed-backfill-performance-plan.md)).

**What landed.** Internal reshape of R1 (`apps/admin/src/services/scene-embedding.service.ts`) and R2 (`apps/admin/src/services/transcript-embedding.service.ts`) write paths. GraphQL trigger surface byte-identical to Stage 2. Per-target round-trip count drops from ~90 to ~3 on R1 and from ~30+ to 1 on R2:

1. **R1 parent collapse.** `crypto.randomUUID()` for client-generated ids; bulk `INSERT INTO video_scene … SELECT * FROM unnest(...) ON CONFLICT (video_edition_id, scene_index) DO NOTHING`; one follow-up `SELECT id, scene_index FROM video_scene WHERE video_edition_id = $1 AND scene_index = ANY($2::text[])` recovers the full `scene_index → id` mapping for both new and pre-existing parents (`DO NOTHING` doesn't return rows for existing matches).

2. **R1 locale write + R2 chunk write.** One `$executeRaw INSERT … unnest(...) ON CONFLICT … DO UPDATE SET …` per target with **Way A discipline** at the SELECT seam: per-row `u.embedding_text::vector(1536)` cast (NOT `?::vector(1536)[]` array-param cast — pgvector's array-element parser is less-trodden code) and per-row `ARRAY(SELECT jsonb_array_elements_text(u.col_json::jsonb))` unfold for the multi-value `text[]` columns (`themes`, `bibleVerses`, `demographics`, `spiritualContext` are `String[]` in `schema.prisma:1169-1172`, NOT `jsonb` — the original "JSONB" framing was factually wrong; corrected during plan deepening 2026-05-05).

3. **`toPgArray` extension.** Widened to `readonly (string | null)[]` with unquoted-NULL emission for nullable columns (`startSeconds`, `endSeconds`, `chunkId` in R2). PG18 §8.15.6 confirms quoted `"NULL"` is the literal three-char string, not SQL NULL.

4. **Length-equality preflight (load-bearing).** Per PG18 [`functions-array.html`](https://www.postgresql.org/docs/18/functions-array.html), `unnest(arr1, arr2, ...)` _silently NULL-pads_ unequal-length arrays. Both R1 and R2 throw `*IndexError("artifact_invalid")` BEFORE `$executeRaw` if parallel-array lengths diverge. Test mocks `$executeRaw` and asserts it is NEVER called on length mismatch.

5. **Per-target `prisma.$transaction` boundary preserved** (one txn per `(video, edition, locale)` for R1, per `(video, edition, language)` for R2) — bulk writes are inside the per-target txn, so a single locale's failure cannot poison siblings. Stage 1's `Promise.allSettled` per-target isolation contract carries through unchanged.

**Smoke evidence.** Local run against `forge_admin`: 2/2 R1 targets succeeded for `2_0-Crushing` locale=en after a smoke-caught fix to `jsonb_array_elements_text` (see below). `ON CONFLICT DO UPDATE` rerun confirmed (row count stable at 4, 0 failures, 0 duplicates). `text[]` Way A unfold round-trips correctly (`{identity,grace,redemption,...}`); `vector(1536)` per-row cast persists deterministically. R2 bulk-INSERT path verified by structural mirroring + 21 unit tests; manager bucket has no `embeddings.json` for the local fixture set so a live R2 smoke is deferred to prod readiness.

**Smoke caught one shipped bug** (commit `a9dc8877` on the PR branch): the deepened plan's recommendation to use `json_array_elements_text(u.col_json::jsonb)` was wrong — PG has `json_array_elements_text(json)` and `jsonb_array_elements_text(jsonb)` as DISTINCT functions, NOT overloaded across the json/jsonb seam. Mocked SQL-shape tests passed (regex `/jsonb?_array_elements_text/` matched both spellings); only the real-DB smoke surfaced the parse-time `42883` error. Fixed inline; learning compounded into the new solutions doc and root `CLAUDE.md` "Known Patterns" entry.

**Compounded patterns** in [`docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`](../../solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md): bulk INSERT … unnest(...) ON CONFLICT shape, per-row Way A vector cast, JSONB-vs-`text[]` correction, length-equality preflight, parent two-statement DO NOTHING + follow-up SELECT, `json_array_elements_text(jsonb)` doesn't-exist trap, real-DB smoke as mandatory pre-merge gate. Bidirectionally cross-linked with the Stage 2 sibling docs (`per-parent-child-memoization-loadedartifact-pattern-20260505.md`, `batched-provider-input-position-stable-contract-20260505.md`, `bounded-parallelism-per-target-workflow-pattern-20260505.md`) and the platform indexer docs.

**Verification gates:** typecheck ✓, lint ✓, vitest 61/61 passing on the 3 affected test files (full admin suite 1,517 passing). Real-DB smoke against `forge_admin` ✓.

**Residual risks documented in the PR description** for follow-up:

- `toPgArray` brace-rejection on free-text payloads (P1 manual finding from `/ce:review` — pre-Stage-3, scene descriptions / transcript text flowed through Prisma upsert; now they go through `toPgArray` which throws on `{`/`}`. AI-generated descriptions plausibly contain braces. Three options outlined in the review report; deferred for human judgment).
- R2 bulk-INSERT path live-DB smoke deferred to prod readiness (manager bucket has no `embeddings.json` artifacts for the local fixture set).
- 30s `$transaction` timeout fixed regardless of chunk count — could be tight on long-form audio with hundreds of chunks; flagged for future scale-with-input-size revisit.

## Problem

Per-row `tx.videoSceneLocale.upsert()` and `tx.videoTranscriptChunk.upsert()` cost ~5-15 ms each on a Railway DB. For a 50-scene × 30-locale video that's ~1,500 round-trips just for R1; the corpus aggregate is millions. Replacing with a single `Prisma.sql` template doing `INSERT … SELECT * FROM unnest(...) ON CONFLICT (...) DO UPDATE SET …` collapses each per-`(video, edition, locale)` write batch to one round-trip.

Expected speedup: **10-50× write throughput**. Compounds with feat-115 (parallelism) + feat-116 (S3 cache + batched embeds) for the full effect.

## Entry Points — Read These First

1. `apps/admin/src/services/scene-embedding.service.ts` — current per-row upsert loop inside `prisma.$transaction`.
2. `apps/admin/src/services/transcript-embedding.service.ts` — same shape for chunks.
3. `apps/admin/src/db/pgvector.ts` — `toPgArray` and `toPgVector` helpers; needed for binding string[] and vector[] arrays as single PG-array literals (avoids the 32,767 prepared-statement parameter limit — see `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`).
4. `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md` — every new `$executeRaw` template needs SQL-shape assertions in tests, not just row-mapping checks.
5. `docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md` — any enum-typed column in the raw SQL must use the lowercase `@map`'d DB literal, not the uppercase TS variant name. This bit us on `SourceTier` in feat-104's PR; do not regress.
6. `apps/admin/src/services/core-sync/phases/sync-dubs.ts` (post-merge of refactor branch) — the array-bound `$executeRaw` soft-delete is the canonical example to mirror.

## Grep These

```
grep -rn "videoSceneLocale.upsert\|videoTranscriptChunk.upsert" apps/admin/src/
grep -rn "toPgArray\|toPgVector" apps/admin/src/
grep -rn "ON CONFLICT" apps/admin/src/services/
```

## What To Build

Replace per-row upserts with a single `$executeRaw` per `(video, edition, locale)` write batch. Sketch for R1:

```ts
// Bind every row's columns as parallel PG-array literals; UNNEST them server-side.
const sceneIds = scenes.map((s) => s.videoSceneId)
const localesArr = scenes.map(() => locale)
const descriptions = scenes.map((s) => s.description)
const embeddingTexts = scenes.map((s, i) => toPgVector(embeddings[i]))

await tx.$executeRaw`
  INSERT INTO video_scene_locale (
    video_scene_id, locale, description, embedding, synced_at
  )
  SELECT * FROM unnest(
    ${toPgArray(sceneIds)}::text[],
    ${toPgArray(localesArr)}::text[],
    ${toPgArray(descriptions)}::text[],
    ${toPgArray(embeddingTexts)}::vector(1536)[],
    ARRAY(SELECT NOW() FROM generate_series(1, ${scenes.length}))
  )
  ON CONFLICT (video_scene_id, locale)
  DO UPDATE SET
    description = EXCLUDED.description,
    embedding   = EXCLUDED.embedding,
    synced_at   = EXCLUDED.synced_at
`
```

R2 mirrors the same shape against `video_transcript_chunk`.

### Index considerations

- pgvector HNSW index updates are per-row internally regardless of whether the insert is bulk or single-row; bulk insert helps with **round-trip cost**, not index-maintenance cost.
- For an "operator-mode" full re-embed run, add an opt-in flag `--rebuild-indexes` that does `DROP INDEX video_scene_locale_embedding_idx → bulk INSERT → CREATE INDEX video_scene_locale_embedding_idx`. Out of scope for this ticket; flag as future enhancement.

## Constraints

- **Bind arrays via `toPgArray`, not as separate parameters.** Per `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`. The whole point of this ticket is to keep parameter count constant in batch size.
- **Lowercase enum literals only.** No `'CORE'`-style TS variant names in raw SQL. If `SourceTier` or any other `@map`'d enum appears in the new SQL, use the DB literal or an explicit `::"EnumType"` cast. Per `docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md`.
- **Preserve generated-column behavior.** `video_scene_locale` does not currently have generated columns; `video_locale` does. If R2 writes touch a table with generated tsvector columns, the `INSERT` must omit them (Postgres rejects writes to generated columns).
- **Vector serialization:** `toPgVector` already produces pgvector's canonical `[0.1,0.2,...]` text form. For an array of vectors, the wrapping `toPgArray` must NOT escape the brackets; verify with a fixture test that a multi-row insert round-trips correctly.
- **Per-target idempotency stays:** `ON CONFLICT … DO UPDATE` preserves the upsert semantics. A re-run that produces the same input must produce the same row state.

## Verification

- `pnpm --filter @forge/admin typecheck` ✓
- `pnpm --filter @forge/admin lint` ✓
- New tests (per the raw-SQL invariant pattern):
  - SQL-shape assertions: contains `INSERT INTO`, `unnest(`, `ON CONFLICT`, `DO UPDATE`, `vector(1536)[]` (R1) / `text[]` (R2).
  - Bound-value count: `mock.calls[0][1..]` has exactly `K` parameters where `K` is the column count, regardless of `scenes.length` (the regression guard against re-introducing per-row binding).
  - End-to-end against a docker / testcontainer Postgres (or live local DB if cleaner): bulk insert + idempotent re-run produces identical rows.
  - Mixed insert + update fixture: half new scenes, half existing; `ON CONFLICT` correctly updates the existing rows.
- Local benchmark: `pnpm run-embeds --pipeline=both --locale=en` finishes 1.5-3× faster than the feat-116 baseline (compound with prior stages).
- Solutions doc: capture the bulk-insert-pgvector pattern as a new entry under `docs/solutions/database-issues/` so the next service to want bulk vector writes can reuse it. Reference the bind-var-limit and enum-seam docs.
- `apps/admin/CLAUDE.md` R1 + R2 subsections updated.
