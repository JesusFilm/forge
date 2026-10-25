---
title: "refactor: Rename video_embeddings to transcript_embeddings"
type: refactor
status: completed
date: 2026-04-10
origin: .context/compound-engineering/todos/024-ready-p2-rename-video-embeddings-to-transcript-embeddings.md
related:
  - docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md
  - docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md
  - docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md
  - docs/plans/2026-04-09-feat-sync-enrichment-embeddings-into-cms-vector-index-plan.md
  - docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md
  - docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md
  - docs/roadmap/content-discovery/feat-010-semantic-search-api.md
---

# refactor: Rename video_embeddings to transcript_embeddings

## Overview

Rename the CMS pgvector transcript chunk table from `video_embeddings` to `transcript_embeddings`, and update the code/docs that refer to the physical table name.

This is a naming and model-clarity cleanup. The table row shape remains transcript-specific:

```sql
video_id
chunk_index
chunk_text
embedding
model
```

The PR should not redesign embedding storage, add scene embedding sync, store metadata/profile vectors, or change the manager artifact contract. It should make the existing transcript chunk vector store accurately named before semantic search and future video-profile work deepen the confusion.

## Problem Statement

`video_embeddings` sounds like the canonical table for every video-related vector, but the current table stores transcript chunks only. That conflicts with the system's emerging retrieval grains:

- transcript embeddings answer "where in the spoken transcript does this query match?"
- scene embeddings answer "which visually and thematically analyzed scenes are similar?"
- future video profile embeddings may answer "what is this video broadly about?"

The current physical name forces docs and code to explain that "video" means "transcript chunk". Renaming now keeps the transcript sync PR sequence clean while the table is still young.

## Found Context

Found brainstorm from 2026-04-02: `video-content-vectorization`. Using as context for planning because it explicitly separates transcript embeddings from scene embeddings.

Found ready todo: `.context/compound-engineering/todos/024-ready-p2-rename-video-embeddings-to-transcript-embeddings.md`.

Key decisions carried forward:

- implement the physical table rename in its own PR
- preserve transcript chunk semantics
- keep `scene_embeddings` separate
- leave `metadataEmbedding` artifact-only until a retrieval strategy justifies CMS storage
- keep this PR focused on naming/model clarity, not broad embedding redesign

## Research Summary

External research skipped. This is a repo-internal Strapi/PostgreSQL rename with strong local guidance in `docs/solutions/`.

Relevant files:

- `apps/cms/src/bootstrap/ensure-pgvector.ts` creates `video_embeddings` and `scene_embeddings` on boot.
- `apps/cms/src/api/embedding/services/indexer.ts` reads, deletes, inserts, summarizes, and stats-queries `video_embeddings`.
- `apps/cms/src/api/embedding/services/indexer.test.ts` asserts the current SQL strings.
- `apps/cms/src/api/embedding/controllers/embedding.test.ts` covers the API-mode behavior around the indexer service.
- `apps/cms/src/api/data-snapshot/services/snapshot-tables.ts` includes `video_embeddings` in snapshot exports.
- `apps/cms/src/scripts/data-import.ts` treats `video_embeddings` as a pgvector table to skip when local pgvector is unavailable.
- `docs/roadmap/content-discovery/feat-010-semantic-search-api.md` still uses `video_embeddings` in semantic-search SQL.
- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md` documents `video_embeddings` as the transcript table.

Relevant learnings:

- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`: use raw SQL for pgvector, parameterized vector casts, HNSW indexes, FK cascade, and graceful bootstrap failure when pgvector or dependent tables are unavailable.
- `docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md`: name vector stores by retrieval grain and do this rename as a focused follow-up PR, not as part of scene/profile embedding design.

No `docs/solutions/patterns/critical-patterns.md` file exists in this repo.

## Proposed Solution

Rename the physical table and all direct table-name references to `transcript_embeddings`.

Keep these public/domain surfaces stable unless a direct table-name string forces a change:

- `POST /api/embedding/index`
- `GET /api/embedding/stats`
- manager artifact key `artifacts.embeddingSync`
- response fields like `hasEmbeddings`, `chunkCount`, and `contentFingerprint`
- exported CMS service names such as `syncVideoEmbeddings` unless the implementation diff stays small and tests show no callsite churn

Reason: this PR is the physical storage vocabulary cleanup, not an API contract rename.

## Technical Approach

### 1. CMS bootstrap SQL

Modify `apps/cms/src/bootstrap/ensure-pgvector.ts`.

Tasks:

- Change transcript table DDL from `video_embeddings` to `transcript_embeddings`.
- Change HNSW index name to `transcript_embeddings_embedding_idx`.
- Preserve the current graceful degradation: if `CREATE EXTENSION IF NOT EXISTS vector` fails, Strapi still boots without embedding features.
- Preserve existing `scene_embeddings` DDL and migrations.
- Add or update bootstrap tests for fresh DB creation and extension failure.

### 2. CMS embedding indexer queries

Modify `apps/cms/src/api/embedding/services/indexer.ts`.

Tasks:

- Update all direct SQL references from `video_embeddings` to `transcript_embeddings`.
- Cover read summary, delete-then-insert, `if_missing`, override, and stats queries.
- Keep the transaction and row-locking behavior unchanged.
- Keep chunk indexing order and generated content fingerprint behavior unchanged.
- Prefer a small local table-name constant only if it makes the repeated raw SQL safer without obscuring the SQL.

### 3. CMS tests

Modify `apps/cms/src/api/embedding/services/indexer.test.ts`.

Tasks:

- Update SQL string assertions and raw-query mocks to expect `transcript_embeddings`.
- Keep existing behavior assertions intact for:
  - lock before missing check
  - skip when existing rows appear after lock
  - override stale-compare protection
  - draft-only target rejection

Modify `apps/cms/src/api/embedding/controllers/embedding.test.ts` only if the indexer mock names or stats payloads change. Do not change controller behavior just to rename the table.

Add `apps/cms/src/bootstrap/ensure-pgvector.test.ts` if the repo does not already have bootstrap test coverage.

### 4. Snapshot and import lists

Modify `apps/cms/src/api/data-snapshot/services/snapshot-tables.ts`.

Tasks:

- Replace `video_embeddings` with `transcript_embeddings` in `SNAPSHOT_TABLES`.
- Keep `scene_embeddings` unchanged.

Modify `apps/cms/src/scripts/data-import.ts` and possibly `apps/cms/src/scripts/data-import-utils.ts`.

Tasks:

- Update pgvector skip handling and snapshot/export lists to use `transcript_embeddings`.
- Add tests only if these helpers already have coverage or the change introduces new branching.

### 5. Docs and roadmap references

Update durable implementation docs:

- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`
- `docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md`
- `docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md`
- `docs/roadmap/content-discovery/feat-010-semantic-search-api.md`
- `docs/roadmap/content-discovery/feat-037-video-content-vectorization.md`
- `docs/roadmap/content-discovery/feat-041-scene-embeddings-table.md`
- `docs/plans/2026-04-09-feat-sync-enrichment-embeddings-into-cms-vector-index-plan.md`
- `docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md`

Recommended wording:

- Use `transcript_embeddings` for the transcript chunk table.
- Keep `scene_embeddings` as the multimodal scene table.
- Keep future video-level/profile vectors separate.
- Where a document is historical, add a short "renamed later" note instead of rewriting the past in a confusing way.

### 6. Todo status

After implementation and verification, update `.context/compound-engineering/todos/024-ready-p2-rename-video-embeddings-to-transcript-embeddings.md` from `ready` to `complete` with a work-log note.

Do not mark it complete during planning.

## Flow Analysis

### Flow 1: Fresh CMS bootstrap

Entry point: Strapi boot calls `ensurePgvector()`.

Expected outcome:

- pgvector extension is enabled
- `transcript_embeddings` is created
- `transcript_embeddings_embedding_idx` is created
- no `video_embeddings` table is created

### Flow 2: Local data import without pgvector

Entry point: `pnpm --filter @forge/cms data-import`.

Expected outcome:

- import strips pgvector blocks for `transcript_embeddings`
- non-embedding CMS tables restore successfully
- Strapi can boot without embedding features, matching current behavior

### Flow 3: Semantic search implementation after rename

Entry point: future `feat-010` work reads roadmap docs.

Expected outcome:

- planned SQL queries `transcript_embeddings`
- aliases make transcript scope clear, for example `FROM transcript_embeddings te`
- snippets still come from `chunk_text`

## Acceptance Criteria

- [x] `ensurePgvector` creates `transcript_embeddings` for fresh databases.
- [x] CMS embedding indexer read/write/stats queries use `transcript_embeddings`.
- [x] CMS indexer tests assert the new table name and keep behavior coverage for missing-only and override flows.
- [x] Snapshot export includes `transcript_embeddings`.
- [x] Data import pgvector filtering handles `transcript_embeddings`.
- [x] Semantic-search docs query `transcript_embeddings` and continue returning `chunk_text` snippets.
- [x] Docs distinguish transcript embeddings from `scene_embeddings` and future video profile embeddings.
- [x] No manager artifact, endpoint, or response contract is renamed unless required by a direct table-name reference.

## Quality Gates

Run focused checks:

```bash
pnpm --filter @forge/cms test -- src/api/embedding/services/indexer.test.ts src/api/embedding/controllers/embedding.test.ts
pnpm --filter @forge/cms test -- src/bootstrap/ensure-pgvector.test.ts
pnpm --filter @forge/cms test -- src/scripts/data-import-utils.test.ts
pnpm --filter @forge/cms typecheck
```

If no bootstrap or import-utils test is added, replace that command with the actual focused test file that covers the touched helper.

Manual SQL checks against a disposable local or staging database:

```sql
SELECT to_regclass('public.transcript_embeddings');
\d transcript_embeddings
SELECT COUNT(*) FROM transcript_embeddings;
```

## Non-Goals

- Do not add scene embedding indexing to enrichment.
- Do not design or create `video_profile_embeddings`.
- Do not store `metadataEmbedding` in the transcript table.
- Do not change the shape of `embeddings.json`.
- Do not rename manager `artifacts.embeddingSync`.
- Do not introduce a Strapi content type for pgvector data.
- Do not require GraphQL codegen; this raw SQL table is not a GraphQL content type.

## Risks

- **Missed table-name reference**: one lingering SQL/doc string could keep pointing at `video_embeddings`. Mitigation: repo-wide search and focused CMS tests.
- **Snapshot/import drift**: local tooling may still export or skip the old name. Mitigation: update the snapshot allowlist and pgvector table set in the same PR.
- **Historical docs become misleading**: future implementers may copy old SQL. Mitigation: update durable docs and active roadmap instructions; add historical notes where needed.

## References

- `.context/compound-engineering/todos/024-ready-p2-rename-video-embeddings-to-transcript-embeddings.md`
- `docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md`
- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`
- `apps/cms/src/bootstrap/ensure-pgvector.ts`
- `apps/cms/src/api/embedding/services/indexer.ts`
- `apps/cms/src/api/data-snapshot/services/snapshot-tables.ts`
- `apps/cms/src/scripts/data-import.ts`
- `docs/roadmap/content-discovery/feat-010-semantic-search-api.md`
