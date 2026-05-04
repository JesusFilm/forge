---
id: "feat-117"
title: "Embed Backfill — Stage 3 — Bulk DB Writes via INSERT … ON CONFLICT"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-08"
duration: 2
depends_on:
  - "feat-116"
blocks:
  - "feat-118"
tags:
  - "admin"
  - "ai-pipeline"
  - "performance"
  - "postgres"
  - "pgvector"
---

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
