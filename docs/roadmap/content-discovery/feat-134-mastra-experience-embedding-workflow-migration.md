---
id: "feat-134"
title: "Mastra experience embedding workflow migration"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-25"
duration: 4
depends_on:
  - "feat-133"
blocks:
  - "feat-135"
tags:
  - "admin"
  - "mastra"
  - "ai-pipeline"
  - "search"
  - "embeddings"
  - "pgvector"
---

## Problem

Experience embedding generation still belongs to Admin's workflow and provider
call paths. Once transcript and scene embeddings prove the Mastra-owned
workflow pattern, experience embeddings should move too so all background
content embedding generation is owned by Mastra.

Admin must remain the authority for `ExperienceLocale` storage, publication
rules, pgvector indexes, and public search contracts. Mastra should own the
provider call, run diagnostics, retries, provenance, and workflow visibility.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - embedding ownership requirements and experience migration order.
2. `docs/roadmap/content-discovery/feat-133-mastra-scene-embedding-workflow-migration.md`
   - scene migration pattern to mirror for the third embedding type.
3. `docs/roadmap/platform/feat-092-admin-experience-embedding-workflow.md`
   - current Admin experience embedding foundation and safety controls.
4. `apps/admin/src/workflows/experienceEmbeddingBackfill.ts`
   - current Admin experience locale enumeration and embedding write path.
5. `apps/admin/src/graphql/mutations/experience-embedding-backfill.ts`
   - operator trigger surface for experience embedding backfills.
6. `apps/admin/src/services/embeddings.service.ts`
   - current embedding provider client and batched embedding helper.
7. `apps/admin/prisma/schema.prisma`
   - `ExperienceLocale.embedding` and pgvector model constraints.
8. `apps/admin/src/services/hybrid-search-retrievers.ts`
   - search read path that consumes experience vectors.
9. `apps/mastra/src/mastra/index.ts`
   - Mastra route and workflow registration pattern.

## Grep These

```
rg -n "experienceEmbeddingBackfill|launchMastraExperienceEmbeddingForLocale|ExperienceLocale" apps/admin/src apps/admin/prisma
rg -n "generateExperienceEmbedding|generateExperienceEmbeddings|OPENROUTER_EMBEDDING_MODEL" apps/admin/src
rg -n "experience-embedding-backfill|triggerExperienceEmbedding" apps/admin/src/graphql
rg -n "registerApiRoute|createWorkflow|MASTRA_SERVICE_API_KEYS" apps/mastra/src
```

## What To Build

1. Add an experience-specific Admin ingest endpoint for Mastra-written
   `ExperienceLocale` vectors. It must validate caller auth, locale identity,
   source content hash, model/dimensions, provenance, generation mode, and
   experience-specific publication constraints before writing.
2. Add compact provenance for Mastra-written experience embeddings so operators
   can trace source content, model/version, generation mode, Mastra run id, and
   generation timestamp without exposing vectors.
3. Add a Mastra experience embedding workflow that builds the embedding source
   from `ExperienceLocale` content supplied by Admin, generates vectors,
   validates provider response shape, and submits the final payload to Admin
   ingest.
4. Update Admin experience embedding backfill and trigger paths to launch
   Mastra instead of generating vectors inside Admin.
5. Remove or narrow Admin's direct experience embedding provider path once the
   Mastra contract proof passes.
6. Prove existing mixed search can read experience vectors written through
   Mastra without changing public response shapes.

## Constraints

- Do not move live user search orchestration into Mastra.
- Do not move live query embedding generation into Mastra.
- Do not change public search REST or GraphQL response shapes.
- Do not expose vector, embedding, similarity, or provenance internals through
  normal GraphQL types.
- Do not combine experience ingestion with transcript or scene ingestion into a
  generic blob endpoint.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Use Admin/Core identifiers and Admin-owned content sources.
- Do not remove Admin's search ownership or `ExperienceLocale` storage
  authority.

## Verification

- Admin experience backfill launches Mastra and no longer owns provider calls
  for production experience embedding generation.
- Admin ingest accepts valid Mastra experience payloads, rejects malformed
  vectors or dimension drift before writing, and supports default idempotent,
  repair, force, and model-upgrade modes.
- Existing Admin search can retrieve experience results from Mastra-written
  vectors.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- experienceEmbeddingBackfill.test.ts graphql/mutations/experience-embedding-backfill.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts
```
