---
status: complete
priority: p2
issue_id: "024"
tags: [cms, embeddings, database, naming, transcript]
dependencies: []
---

# Rename `video_embeddings` to `transcript_embeddings`

## Problem Statement

The current CMS table and code path use `video_embeddings` for transcript chunk vectors. That name is now too broad because the product direction includes multiple video-related vector types: transcript chunks, scene descriptions, metadata, and future video profile vectors. Keeping `video_embeddings` for transcript-only rows will make the model harder to reason about as soon as video-level/profile embeddings are added.

## Findings

- The current table stores transcript chunk data: `video_id`, `chunk_index`, `chunk_text`, `embedding`, and `model`.
- The manager sync path sends generated transcript chunks to CMS, not general video profile vectors.
- Existing scene analysis already uses the clearer `scene_embeddings` naming for scene description vectors.
- Future work may add `video_profile_embeddings` or a generic multi-source embedding system; reserving `video_embeddings` for transcript chunks creates naming conflict with that future shape.
- Renaming now is less costly because the transcript embedding branch is still young and not yet deeply depended on by search/recommendation APIs.

## Proposed Solutions

### Option 1: Rename the table and code references to `transcript_embeddings`

**Approach:** Update CMS bootstrap/schema SQL, indexer queries, tests, docs, UI copy where relevant, and any service references from `video_embeddings` to `transcript_embeddings`.

**Pros:**

- Most accurate current domain language
- Keeps room for `video_profile_embeddings` later
- Aligns with `scene_embeddings` naming style

**Cons:**

- Requires a migration/rename path if any environments already created `video_embeddings`
- Touches SQL, tests, docs, and UI labels

**Effort:** 2-4 hours

**Risk:** Medium

---

### Option 2: Keep table name but rename code/UI concepts only

**Approach:** Keep the physical table as `video_embeddings` but rename TypeScript/domain/UI references to transcript embeddings.

**Pros:**

- Lower database migration risk
- Smaller implementation diff

**Cons:**

- Leaves a permanent mismatch between database and domain naming
- Future engineers will still ask why “video” means “transcript chunk”

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

Do not fold the physical table rename into the current transcript sync PR. For the current PR, use Option 2 only where it reduces review ambiguity: keep `video_embeddings` as the physical table name, but make manager-facing copy/docs say "transcript embeddings" clearly.

Implement Option 1 in a dedicated follow-up PR. Rename `video_embeddings` to `transcript_embeddings` across the CMS SQL/indexer path and manager-facing docs/copy.

## Technical Details

**Affected files:**

- `apps/cms/src/bootstrap/ensure-pgvector.ts`
- `apps/cms/src/api/embedding/services/indexer.ts`
- `apps/cms/src/api/embedding/services/indexer.test.ts`
- `apps/cms/src/api/embedding/controllers/embedding.test.ts`
- `apps/manager/src/services/embeddingSync.ts`
- `apps/manager/src/features/jobs/embedding-sync-card.tsx`
- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`
- `docs/plans/2026-04-09-feat-sync-enrichment-embeddings-into-cms-vector-index-plan.md`
- Any search/recommendation docs or tests that mention `video_embeddings`

**Database changes (if any):**

- Rename the transcript chunk pgvector table definition to `transcript_embeddings`.
- Rename the transcript HNSW index to `transcript_embeddings_embedding_idx`.
- Update snapshot/import helpers and docs to use the new table name.

## Resources

- `docs/scene-vectorization-overview.md`
- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`
- `.context/compound-engineering/todos/022-complete-p2-remove-strapi-embedding-sync-token.md`

## Acceptance Criteria

- [x] The transcript chunk embedding table is named `transcript_embeddings`.
- [x] CMS indexing, summary, stats, and sync code no longer query `video_embeddings`.
- [x] Tests cover the renamed table path.
- [x] Docs/copy distinguish transcript embeddings from scene embeddings and future video profile embeddings.
- [x] Snapshot/import/tooling references use `transcript_embeddings`.

## Work Log

### 2026-04-10 - Created

**By:** Codex

**Actions:**

- Compared the current transcript chunk embedding path with existing scene embeddings and future video profile vector needs.
- Captured the decision that `video_embeddings` is too broad for a transcript-only table.
- Recommended renaming now while the branch is still relatively young.

**Learnings:**

- The cleaner long-term vocabulary is multiple semantic vector types: transcript embeddings, scene embeddings, and future video profile embeddings.

### 2026-04-11 - Sequenced After Current PR

**By:** Codex

**Actions:**

- Decided not to rewrite the current transcript CMS sync PR around the table rename.
- Kept the follow-up recommendation to physically rename `video_embeddings` to `transcript_embeddings` in its own PR.
- Clarified that the current PR should only adjust wording/docs to make transcript-only scope clear.

**Learnings:**

- The safest sequence is scope clarity first, database rename second, scene-enrichment integration third.

### 2026-04-10 - Completed

**By:** Codex

**Actions:**

- Renamed the CMS transcript chunk pgvector table references from `video_embeddings` to `transcript_embeddings`.
- Updated CMS bootstrap SQL, transcript embedding indexer queries, snapshot/import helpers, roadmap docs, and best-practice docs.
- Added focused CMS bootstrap coverage for the renamed table and reran the transcript embedding/controller/bootstrap tests with `pnpm dlx vitest@2.1.9`.

**Learnings:**

- The rename is mechanically small in code, but the semantic-search and roadmap docs need to move with it or they keep reintroducing the old mental model.
