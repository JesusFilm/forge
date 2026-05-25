---
id: "feat-133"
title: "Mastra scene embedding workflow migration"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-25"
duration: 5
depends_on:
  - "feat-132"
blocks:
  - "feat-134"
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

After transcript embeddings move to Mastra, scene embeddings are the next
background embedding type that still runs outside the intended workflow owner.
Admin currently reads Manager's `scene-analysis.json`, generates scene vectors,
and stores them in `video_scene_locale`. That leaves provider calls, retry
behavior, generation provenance, and detailed run diagnostics in Admin instead
of Mastra.

Move scene embedding generation to a Mastra-owned workflow while keeping Admin
as the owner of vector storage, search indexes, publication gates, and public
search contracts. Manager should continue producing scene-analysis source
artifacts only.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - migration order, ownership boundary, and contract proof gate.
2. `docs/roadmap/content-discovery/feat-132-mastra-transcript-embedding-migration.md`
   - transcript migration pattern to mirror without copying transcript-specific
     constraints.
3. `apps/admin/src/services/scene-embedding.service.ts`
   - current scene text selection, provider call, pgvector write, and per-locale
     target behavior.
4. `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`
   - current Admin backfill orchestration and per-target outcome reporting.
5. `apps/admin/src/graphql/mutations/scene-embedding.ts`
   - existing operator trigger surface.
6. `apps/admin/src/services/manager-artifacts.service.ts`
   - `scene-analysis.json` artifact reader and validation patterns.
7. `apps/manager/src/services/sceneEmbeddingSync.ts`
   - Manager-side scene embedding sync path that must be reviewed for stale
     producer assumptions.
8. `apps/admin/src/services/hybrid-search-retrievers.ts`
   - search read path that must continue reading `video_scene_locale.embedding`.
9. `apps/mastra/src/mastra/index.ts`
   - Mastra route and workflow registration pattern.

## Grep These

```
rg -n "sceneEmbeddingBackfill|indexEditionScenes|VideoSceneLocale|video_scene_locale" apps/admin/src apps/admin/prisma
rg -n "scene-analysis.json|readSceneAnalysisArtifact|readEmbeddingsArtifact" apps/admin/src apps/manager/src
rg -n "sceneEmbeddingSync|requestEmbeddingVectors|generateEmbeddings" apps/manager/src
rg -n "registerApiRoute|createWorkflow|MASTRA_SERVICE_API_KEYS" apps/mastra/src
```

## What To Build

1. Add a scene-specific Admin ingest endpoint for Mastra-written scene locale
   vectors. It must validate caller auth, target identity, scene identity,
   locale, text/snippet content, model/dimensions, provenance, generation mode,
   and type-specific scene constraints before writing.
2. Add compact provenance for Mastra-written scene embeddings so operators can
   trace source artifact version, source text, locale, model/version, generation
   mode, Mastra run id, and generation timestamp without exposing vectors.
3. Add a Mastra scene embedding workflow that accepts scene source data,
   generates vectors, validates provider response shape, records workflow
   observability, and submits the final payload to Admin ingest.
4. Update Admin scene backfill and GraphQL trigger paths to launch Mastra
   instead of calling the embedding provider directly.
5. Review and remove any Manager scene embedding producer path that becomes
   obsolete. Manager should still produce scene-analysis source artifacts.
6. Prove the contract with tests: Mastra-shaped scene output is accepted by
   Admin ingest, persisted to `video_scene_locale`, and read by existing Admin
   search/retrieval behavior without response-shape drift.

## Constraints

- Do not move live user search orchestration into Mastra.
- Do not move live query embedding generation into Mastra.
- Do not change public search REST or GraphQL response shapes.
- Do not expose vector, embedding, similarity, or provenance internals through
  normal GraphQL types.
- Do not re-open localized scene translation scope here. Consume whatever scene
  text shape exists when this ticket starts.
- Do not migrate experience embeddings or search eval retrieval in this ticket.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Use Admin/Core/Mux identifiers and Admin-owned source artifacts
  instead of CMS document IDs.
- Do not import from `apps/admin`, `apps/manager`, or `apps/auth` inside
  `apps/mastra`; use HTTP contracts and local types instead.

## Verification

- Admin scene backfill launches Mastra and no longer calls the embedding
  provider directly for scene vectors.
- Admin ingest accepts valid Mastra scene payloads, rejects malformed vectors or
  dimension drift before writing, and supports default idempotent, repair,
  force, and model-upgrade modes.
- Existing Admin search can retrieve scene evidence from vectors written
  through Mastra-owned generation.
- No Manager scene path still claims to own final vector generation.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- scene-embedding.service.test.ts sceneEmbeddingBackfill.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts
pnpm --filter @forge/manager test -- sceneEmbeddingSync.test.ts
```
