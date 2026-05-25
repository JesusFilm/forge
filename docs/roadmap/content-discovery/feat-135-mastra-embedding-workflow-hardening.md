---
id: "feat-135"
title: "Mastra embedding workflow hardening"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-25"
duration: 3
depends_on:
  - "feat-134"
blocks:
  - "feat-136"
tags:
  - "admin"
  - "manager"
  - "mastra"
  - "ai-pipeline"
  - "search"
  - "embeddings"
  - "pgvector"
---

## Problem

Transcript, scene, and experience embedding migrations should land as concrete
type-specific slices first. After those migrations, the repo needs a hardening
pass that extracts only the shared primitives proven useful across all three
embedding types.

The goal is to reduce duplicated provider validation, provenance semantics,
idempotency rules, outcome reporting, and deployment docs without weakening the
decision that each embedding type keeps its own Admin ingest contract.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - R6 shared hardening guidance and separate ingest contract decision.
2. `docs/roadmap/content-discovery/feat-132-mastra-transcript-embedding-migration.md`
   - transcript migration result.
3. `docs/roadmap/content-discovery/feat-133-mastra-scene-embedding-workflow-migration.md`
   - scene migration result.
4. `docs/roadmap/content-discovery/feat-134-mastra-experience-embedding-workflow-migration.md`
   - experience migration result.
5. `apps/mastra/src/mastra/workflows/`
   - migrated embedding workflow implementations.
6. `apps/mastra/src/services/`
   - embedding provider clients and Admin ingest clients.
7. `apps/admin/src/app/api/internal/mastra/`
   - type-specific Admin ingest routes.
8. `apps/admin/prisma/schema.prisma`
   - provenance fields added by each migration.
9. `docs/solutions/`
   - durable patterns to update or add after migration learnings.

## Grep These

```
rg -n "generationMode|model-upgrade|repair|force|unchanged|Mastra run" apps/admin/src apps/mastra/src
rg -n "embeddingDimensions|vector\\(1536\\)|sourceHash|provenance" apps/admin/src apps/admin/prisma apps/mastra/src
rg -n "admin.*ingest|transcript-embeddings|scene-embeddings|experience-embeddings" apps/mastra/src apps/admin/src
rg -n "OPENROUTER|text-embedding-3-small|embedding provider" apps/mastra/src apps/admin/src apps/manager/src
```

## What To Build

1. Consolidate shared Mastra embedding provider validation so transcript, scene,
   and experience workflows all enforce count alignment, finite values, and
   dimensions consistently.
2. Consolidate shared Admin ingest client behavior in Mastra while preserving
   type-specific Admin endpoints and payload schemas.
3. Align generation mode semantics across embedding types: default idempotent,
   repair, force, and model-upgrade.
4. Align compact provenance naming and outcome envelopes across Admin services
   where the concrete migrations revealed useful common language.
5. Remove leftover provider-generation code from Manager/Admin that survived
   only as migration scaffolding.
6. Document the final ownership model in package guides and a durable solution
   note.

## Constraints

- Do not create one generic Admin embedding blob endpoint.
- Do not weaken type-specific validation for transcript, scene, or experience
  payloads.
- Do not move live user search orchestration into Mastra.
- Do not move live query embedding generation into Mastra.
- Do not change public search REST or GraphQL response shapes.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Hardening should remove legacy CMS compatibility from migrated
  embedding paths instead of carrying it forward.
- Do not refactor unrelated workflow or search code for style only.

## Verification

- All migrated embedding workflows share provider validation behavior while
  keeping type-specific ingest schemas.
- All three embedding types expose compatible product-level outcomes for
  operators.
- No old transcript, scene, or experience production embedding producer remains
  outside Mastra.
- Package docs and durable solution notes describe the final ownership boundary.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- transcript-embedding.service.test.ts scene-embedding.service.test.ts experienceEmbeddingBackfill.test.ts hybrid-search-retrievers.test.ts search-eval/fingerprint.test.ts
pnpm --filter @forge/manager test
```
