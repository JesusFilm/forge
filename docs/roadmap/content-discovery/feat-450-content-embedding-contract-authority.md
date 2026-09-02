---
id: "feat-450"
title: "Content embedding contract authority"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-02"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "pgvector"
  - "recommendations"
---

## Problem

Transcript ingest, pgvector retrieval, recommendations, query embeddings, and
full Watch Search transcript loading all depend on one compatible content
embedding contract, but parts of the stack still infer compatibility from loose
provider/model/dimension checks or duplicate tuple literals. Equal stored
dimensions must never make a different provider, model, or transform eligible
for current serving.

## Entry Points — Read These First

1. `apps/admin/prisma/migrations/0072_content_embedding_contract_authority/migration.sql` — immutable registry seed, active pointer, and fail-closed SQL shape.
2. `apps/admin/src/services/content-embedding-contract.ts` — single authority module for active contract resolution and exact tuple matching.
3. `apps/admin/src/services/embeddings.service.ts` — active query-embedding identity resolution and contract mismatch handling.
4. `apps/admin/src/services/watch-search.service.ts` — query embedding cache keying and live Watch Search contract binding.
5. `apps/admin/src/services/scene-recommendations-retriever.ts` and `apps/admin/src/services/hybrid-search-retrievers.ts` — transcript-backed retrieval provenance guards.
6. `apps/admin/src/services/experience-ai/experience-ai.service.ts` and `apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts` — candidate loading and model-upgrade resume checks.
7. `apps/admin/src/services/*.contract.test.ts`, `apps/admin/src/services/*.service.test.ts`, and `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts` — regression coverage for ingest, retrieval, recommendation, and resume behavior.

## Grep These

- `ACTIVE_CONTENT_`
- `content_embedding_contract`
- `contentEmbeddingTupleMatches`
- `resolveActiveContentEmbeddingContract`
- `generateCurrentContentQueryEmbedding`
- `activeTranscriptContentEmbeddingWhere|activeExperienceContentEmbeddingWhere`

## What To Build

- Create an immutable `content_embedding_contract` registry and a single `content_embedding_contract_pointer` active pointer row seeded with the audited current contract.
- Fail closed when active contract state is missing, duplicated, dangling, or incomplete.
- Make transcript ingest, PostgreSQL semantic retrieval, recommendations, query embedding, query-embedding caching, and full transcript loading resolve the same active contract identifier.
- Compare provider, model, native dimensions, stored dimensions, and nullable transform version exactly; reject equal-dimension but different-provider/model/transform rows from current serving.
- Keep the current contract tuple literals single-sourced inside the registry seed and authority module.
- Preserve existing retrieval and fallback behavior except where contract mismatch must now stop current-serving eligibility.

## Constraints

- Do not weaken acceptance to dimension-only compatibility.
- Do not duplicate the current contract tuple in unrelated call sites, tests, or SQL helpers.
- Do not move live query embedding generation out of Admin.
- Do not hand-edit generated Prisma or GraphQL artifacts.
- Keep remediation scoped to CI failure repair for the contract-authority PR.

## Verification

```bash
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin typecheck
pnpm prettier --check docs/roadmap/content-discovery/feat-450-content-embedding-contract-authority.md
```
