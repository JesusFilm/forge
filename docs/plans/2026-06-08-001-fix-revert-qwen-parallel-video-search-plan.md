---
title: "fix: Revert Qwen parallel video search rollout"
type: fix
status: completed
date: 2026-06-08
origin: "user request to revert commit ee0f9b2fdfab4b28994a11df9a55ccec11684e57"
---

# fix: Revert Qwen Parallel Video Search Rollout

## Summary

Revert the Qwen parallel-column video search rollout from PR #1149 while preserving later OpenRouter Qwen query behavior and the deployment recovery hook for databases that already recorded the failed migration.

---

## Problem Frame

PR #1149 added a flag-gated AI video-search path that could switch query embedding and stored vector retrieval to gateway-backed `embedding_qwen` columns. The requested rollback removes that side-by-side vector path and its env switch without undoing the later OpenRouter-only query embedding contract or the branch's migration deploy recovery work.

---

## Requirements

- R1. The `0032_video_embedding_qwen` migration and Prisma `embeddingQwen` fields are removed from the active schema surface.
- R2. Admin no longer exposes `AI_VIDEO_SEARCH_EMBEDDING_SOURCE` or threads a per-call embedding source through the Mastra `searchVideos` tool or hybrid search services.
- R3. Hybrid semantic retrieval continues to read the main `embedding` columns and keeps Qwen-compatible provenance gates introduced after PR #1149.
- R4. OpenRouter remains the required query embedding provider with the Qwen model and explicit 1536-dimension request body.
- R5. Deployment recovery still recognizes `0032_video_embedding_qwen` as recoverable for environments where Prisma already has a failed migration row.
- R6. Focused admin tests and typecheck pass for env validation, embedding generation, hybrid retrieval, hybrid orchestration, regression coverage, and the Mastra search tool.

---

## Key Technical Decisions

- **Revert the parallel vector columns, not every Qwen reference:** Later work moved the main query embedding path to OpenRouter Qwen and added provenance guards on the normal `embedding` column, so those changes remain in scope.
- **Remove the runtime source selector:** With no parallel `embedding_qwen` read path, keeping `AI_VIDEO_SEARCH_EMBEDDING_SOURCE` would create a dead external contract.
- **Keep migration recovery aware of the deleted migration:** A database can still have `0032_video_embedding_qwen` recorded as failed even after the migration file is removed from the branch, so the deploy recovery hook remains useful.
- **Update tests to assert absence instead of alternate routing:** The important regression is that the removed column and env switch do not reappear while the retained OpenRouter/provenance path still works.

---

## Implementation Units

### U1. Remove Parallel Schema And Env Surface

- **Goal:** Remove the schema, migration, and env contract that made `embedding_qwen` selectable.
- **Requirements:** R1, R2
- **Dependencies:** None
- **Files:**
  - Modify: `apps/admin/prisma/schema.prisma`
  - Modify: `apps/admin/src/config/env.ts`
  - Modify: `apps/admin/src/config/env.test.ts`
  - Delete: `apps/admin/prisma/migrations/0032_video_embedding_qwen/migration.sql`
  - Delete: `docs/plans/2026-06-05-001-feat-content-embeddings-gateway-migration-plan.md`
- **Approach:** Remove the additive `embedding_qwen` fields, remove the source-selector schema fragment and runtime env binding, and delete the rollback target's planning artifact.
- **Patterns to follow:** Existing env fragments in `apps/admin/src/config/env.ts`; forward-only migration recovery conventions in `apps/admin/src/scripts/migrate-deploy-known-recovery.ts`.
- **Test scenarios:**
  - Env tests no longer import or assert `aiVideoSearchEmbeddingSourceEnvSchema`.
  - A repo scan finds no live `AI_VIDEO_SEARCH_EMBEDDING_SOURCE` contract.
  - Prisma schema no longer contains `embeddingQwen` fields.
- **Verification:** The env test suite passes and no live code references the removed env key or Prisma fields.

### U2. Remove Per-Call Gateway Routing From Search

- **Goal:** Collapse query embedding and semantic retrieval back to the retained main-column path.
- **Requirements:** R2, R3, R4, R6
- **Dependencies:** U1
- **Files:**
  - Modify: `apps/admin/src/mastra/tools/search-videos.ts`
  - Modify: `apps/admin/src/mastra/tools/search-videos.test.ts`
  - Modify: `apps/admin/src/services/embeddings.service.ts`
  - Modify: `apps/admin/src/services/embeddings.service.test.ts`
  - Modify: `apps/admin/src/services/hybrid-search-retrievers.ts`
  - Modify: `apps/admin/src/services/hybrid-search-retrievers.test.ts`
  - Modify: `apps/admin/src/services/hybrid-search.service.ts`
  - Modify: `apps/admin/src/services/hybrid-search.service.test.ts`
  - Modify: `apps/admin/src/services/hybrid-search.regression.test.ts`
- **Approach:** Remove the `EmbeddingSource` type, gateway provider branch, source normalization, source propagation, and raw-column allowlist while preserving OpenRouter Qwen generation and Qwen-compatible content provenance filters.
- **Patterns to follow:** Existing graceful keyword-only degradation in `apps/admin/src/services/hybrid-search.service.ts`; provider contract tests in `apps/admin/src/services/embeddings.service.test.ts`; SQL provenance assertions in `apps/admin/src/services/hybrid-search-retrievers.test.ts`.
- **Test scenarios:**
  - `searchVideos` calls `HybridSearchService.search` without an `embeddingSource` field.
  - Embedding generation sends the OpenRouter Qwen model and 1536 dimensions, and refuses to fall back to OpenAI credentials.
  - Hybrid semantic SQL reads `vsl.embedding` and `vtc.embedding`, never `embedding_qwen`.
  - Video and experience semantic retrievers keep required Qwen-compatible provenance predicates.
  - The default-mode regression test confirms the embedder and retriever no longer receive a source override.
- **Verification:** Focused embedding, search retriever, search service, regression, and Mastra tool tests pass.

### U3. Preserve Known Migration Recovery

- **Goal:** Keep deploy recovery available for environments that already have a failed `0032_video_embedding_qwen` migration row.
- **Requirements:** R5, R6
- **Dependencies:** U1
- **Files:**
  - Modify: `apps/admin/src/scripts/migrate-deploy-known-recovery.ts`
  - Modify: `apps/admin/src/scripts/migrate-deploy-known-recovery.test.ts`
- **Approach:** Keep the failed migration ID in the recovery allowlist and ensure tests cover both existing recoverable migrations.
- **Patterns to follow:** Prior admin migration recovery plans in `docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md`.
- **Test scenarios:**
  - P3009 output naming `0032_video_embedding_qwen` is recognized as recoverable.
  - P3009 output naming unrelated migrations is not recovered.
  - Recovery retries `migrate deploy` after `migrate resolve --rolled-back`.
- **Verification:** The migration recovery test suite passes.

### U4. Validate And Ship

- **Goal:** Prove the reverted branch is internally consistent before handoff.
- **Requirements:** R6
- **Dependencies:** U1, U2, U3
- **Files:**
  - Test: `apps/admin/src/config/env.test.ts`
  - Test: `apps/admin/src/services/embeddings.service.test.ts`
  - Test: `apps/admin/src/services/hybrid-search-retrievers.test.ts`
  - Test: `apps/admin/src/services/hybrid-search.service.test.ts`
  - Test: `apps/admin/src/services/hybrid-search.regression.test.ts`
  - Test: `apps/admin/src/mastra/tools/search-videos.test.ts`
- **Approach:** Run focused tests for the reverted surface and admin typecheck, then inspect the branch diff for stale conflict markers or removed-contract references.
- **Patterns to follow:** Admin package validation conventions in `apps/admin/AGENTS.md`.
- **Test scenarios:**
  - Focused admin tests pass for all changed behavior-bearing files.
  - Admin typecheck passes after removing the env schema export.
  - Repo scan shows no live `AI_VIDEO_SEARCH_EMBEDDING_SOURCE` or `embedding_qwen` search path.
- **Verification:** The validation commands complete successfully and the working branch contains a clean revert commit.

---

## Scope Boundaries

- The OpenRouter Qwen query embedding contract from PR #1161 remains in scope and must not be reverted.
- The native 1536 gateway provenance work from PR #1160 remains in scope and must not be reverted.
- The migration recovery script may continue to mention `0032_video_embedding_qwen` as an operational recovery key even though the migration file is removed.
- Broader roadmap/docs that mention historical `embedding_qwen` context are not rewritten unless they describe a live code contract.

---

## System-Wide Impact

This rollback removes an env-controlled alternate vector route from Admin search and deletes an additive migration. The main user-facing search path remains on Admin-owned query embedding generation, main-column pgvector retrieval, and Qwen-compatible provenance filtering.

---

## Risks & Dependencies

- A production or staging database may already contain a failed `0032_video_embedding_qwen` row, so deploy recovery must remain available.
- Removing the env key may require operators to delete stale environment configuration outside the repo.
- The branch depends on preserving later OpenRouter Qwen behavior; over-reverting would reintroduce the old OpenAI fallback contract.

---

## Sources / Research

- Commit to revert: `ee0f9b2fdfab4b28994a11df9a55ccec11684e57`
- Later retained commit: `21430f15` (`feat(admin): use qwen query embeddings via openrouter`)
- Branch recovery commit: `3075b1ab` (`fix(admin): recover qwen embedding migration deploy`)
- Relevant local guidance: `AGENTS.md`, `apps/AGENTS.md`, `apps/admin/AGENTS.md`
- Related learning: `docs/solutions/best-practices/openrouter-only-embedding-provider-contract.md`
