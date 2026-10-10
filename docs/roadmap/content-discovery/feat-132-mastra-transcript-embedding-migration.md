---
id: "feat-132"
title: "Mastra transcript embedding workflow migration"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-25"
duration: 5
depends_on:
  - "feat-080"
  - "feat-129"
  - "feat-130"
  - "feat-131"
blocks:
  - "feat-133"
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

Mastra is deployed and observable, but transcript embedding generation still
lives in apps/manager. Manager writes `{assetId}/embeddings.json`, and Admin's
transcript backfill imports those vectors into `VideoTranscript` and
`VideoTranscriptChunk`. That leaves provider calls, chunk planning, retries,
and embedding-run diagnostics outside the workflow runtime that should own AI
execution.

Move the transcript phase first: Manager keeps producing transcript source
artifacts, Mastra plans chunks and generates vectors, and Admin validates and
stores vectors through a transcript-specific ingest contract. This should prove
the new ownership boundary before scene, experience, or search-eval retrieval
work moves.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - ownership decisions, transcript-first sequence, and deferred search eval
     boundaries.
2. `docs/plans/2026-05-25-001-feat-mastra-transcript-embedding-migration-plan.md`
   - implementation sequencing for this ticket.
3. `apps/manager/src/workflows/transcriptOnlyPipeline.ts`
   - transcript-only path that currently calls `generateEmbeddings`.
4. `apps/manager/src/workflows/videoEnrichment.ts`
   - full enrichment path; `stepEmbeddings` currently imports Manager's
     embeddings service.
5. `apps/manager/src/services/embeddings.ts`
   - current transcript chunk planner, provider caller, and
     `{assetId}/embeddings.json` writer to migrate out of Manager.
6. `apps/manager/src/services/transcription.ts`
   - source transcript artifact writer for `{assetId}/transcript.json`.
7. `apps/admin/src/services/transcript-embedding.service.ts`
   - current Admin vector persistence service and bulk pgvector write pattern.
8. `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`
   - current backfill that reads manager `embeddings.json` artifacts.
9. `apps/admin/src/services/manager-artifacts.service.ts`
   - manager artifact schemas and readers; add transcript-source reads here.
10. `apps/mastra/src/mastra/index.ts`
    - Mastra runtime registration, service-bearer middleware, and
      observability configuration.

## Grep These

```
grep -rn "generateEmbeddings\\|requestEmbeddingVectors\\|EMBEDDING_MODEL" apps/manager/src
grep -rn "embeddings.json\\|readEmbeddingsArtifact\\|VideoTranscriptChunk" apps/admin/src apps/admin/prisma
grep -rn "triggerTranscriptEmbeddingBackfill\\|runTranscriptEmbeddingBackfill" apps/admin/src
grep -rn "registerApiRoute\\|MASTRA_SERVICE_API_KEYS" apps/mastra/src
grep -rn "WORKFLOW_API_KEYS\\|ADMIN_TRIGGER_API_KEYS\\|ADMIN_EMBED_TRIGGER_API_KEY" apps/admin/src apps/manager/src
```

## What To Build

1. Add a transcript-source artifact reader in Admin for
   `{assetId}/transcript.json`, separate from the current
   `embeddings.json` reader.
2. Add a transcript-specific Admin ingest endpoint for Mastra-written chunks
   and vectors. The endpoint must validate caller auth, target identity,
   model/dimension metadata, source provenance, generation mode, and
   transcript-specific chunk constraints before writing to existing transcript
   tables. Admin-launched runs may use explicit Admin identifiers;
   Manager-launched runs should use available external identifiers such as
   `assetId`, `muxAssetId`, optional Admin-provided `adminVideoId`, and
   `language`, with ambiguous targets rejected before vector writes.
3. Add compact provenance for Mastra-written transcript embeddings so operators
   can trace source content, model/version, generation mode, Mastra run id, and
   generation timestamp without exposing vectors through GraphQL.
4. Add a Mastra transcript embedding workflow with deterministic chunk planning,
   embedding provider calls, retries/observability, and an Admin ingest call.
5. Add Manager and Admin launcher clients for the Mastra workflow:
   - Manager launches after transcript source data exists.
   - Admin launches for backfills, repairs, force re-embeds, and model upgrades.
6. Remove transcript embedding generation from Manager's transcript-only and
   full enrichment paths. Keep non-transcript embedding code only if it is still
   used by the scene migration path, and mark it for removal in that later
   phase.
7. Replace Admin's transcript backfill path so it no longer imports
   manager-generated vectors from `embeddings.json`.
8. Prove the contract with tests: Mastra-shaped output is accepted by Admin
   ingest, persisted to existing pgvector-backed transcript tables, and read by
   existing Admin search/retrieval behavior without public response-shape drift.

## Constraints

- Do not move live user search orchestration into Mastra.
- Do not move live query embedding generation into Mastra.
- Do not change public search REST or GraphQL response shapes.
- Do not expose vector, embedding, similarity, or provenance internals through
  normal GraphQL types.
- Do not migrate scene embeddings, experience embeddings, production search
  trace storage, or Mastra eval retrieval in this ticket.
- Do not leave Manager's transcript embedding producer as a long-term fallback
  after the transcript contract proof passes.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Do not use `videoDocumentId` in new transcript embedding
  contracts; use Admin/Core/Mux identifiers instead.
- Do not import from `apps/admin`, `apps/manager`, or `apps/auth` inside
  `apps/mastra`; use HTTP contracts and local types instead.

## Verification

- Manager transcript-only path launches Mastra after writing transcript source
  data and no longer writes manager-generated transcript vectors.
- Manager full enrichment path launches Mastra for transcript embeddings without
  requiring live query embeddings or changing later enrichment steps.
- Admin backfill can launch Mastra from transcript source artifacts and receives
  idempotent ingest results.
- Admin ingest accepts valid Mastra transcript payloads, rejects malformed
  vectors or dimension drift before writing, and supports default idempotent,
  repair, force, and model-upgrade modes.
- Existing Admin search can retrieve transcript evidence from vectors written
  through Mastra-owned generation.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- transcript-embedding.service.test.ts transcriptEmbeddingBackfill.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts
pnpm --filter @forge/manager test -- transcriptOnlyPipeline.test.ts videoEnrichment.test.ts
```

## Completion Notes

Completed on 2026-05-25.

- Added the Mastra transcript embedding workflow, embedding provider adapter,
  and Admin ingest client.
- Added Admin's transcript-specific Mastra ingest endpoint with narrow bearer
  auth, provenance storage, dimension guards, ambiguous-target rejection, and
  idempotent, repair, force, and model-upgrade modes.
- Updated Admin backfill to read Manager transcript source artifacts and launch
  Mastra instead of importing Manager-produced transcript vectors.
- Updated Manager transcript-only and full enrichment paths to write transcript
  source data and launch Mastra, while preserving scene embedding sync helpers.
- Added contract coverage proving Mastra-shaped transcript output is accepted by
  Admin ingest, stored in the existing transcript vector tables, and read by
  existing Admin search retrieval.
- Updated Mastra failure handling so typed workflow failures throw inside
  committed runs and show as failed in Mastra Studio instead of successful
  `{ ok: false }` runs.
- Configured transcript embedding generation to prefer the existing
  `OPENROUTER_API_KEY` provider path, with OpenAI-compatible fallback.
- Kept Mastra Studio's three-step graph
  (`validate-and-plan-transcript-embedding`, `embed-transcript-chunks`,
  `ingest-transcript-embeddings`) while ensuring committed step outputs contain
  only safe summaries, not raw vectors.
- Removed CMS document-id targeting from the transcript embedding contract;
  Manager/Mastra/Admin transcript handoff now uses Admin/Core/Mux identifiers.
- Documented the new durable pattern in
  `docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md`.

Validation passed:

```
pnpm --filter @forge/admin db:generate
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin-graphql typecheck
pnpm --filter @forge/admin lint
pnpm --filter @forge/manager lint
pnpm --filter @forge/mastra lint
pnpm --filter @forge/admin-graphql lint
pnpm --filter @forge/mastra test
pnpm --filter @forge/admin test -- mastra-ingest-bearer.test.ts transcript-embedding-ingest.service.test.ts transcript-embedding-ingest.contract.test.ts route.test.ts transcript-embedding.service.test.ts transcriptEmbeddingBackfill.test.ts mastra-transcript-embedding-client.test.ts manager-artifacts.service.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts graphql/mutations/transcript-embedding.test.ts schema.test.ts schema.security.test.ts
pnpm --filter @forge/manager test -- transcriptOnlyPipeline.test.ts videoEnrichment.test.ts mastra-transcript-embeddings.test.ts embeddings.test.ts sceneEmbeddingSync.test.ts
pnpm --filter @forge/admin-graphql test
pnpm --filter @forge/admin test -- transcript-embedding-ingest.service.test.ts transcript-embedding-ingest.contract.test.ts route.test.ts
pnpm --filter @forge/manager test -- videoEnrichment.test.ts transcriptOnlyPipeline.test.ts mastra-transcript-embeddings.test.ts admin-trigger-route.test.ts app/api/admin-trigger/transcript/route.test.ts
git diff --check
```

Local real-data proof also passed against the local Mastra Studio/API and Admin
Postgres services:

- Clicked the Mastra Studio `Run` button for
  `transcriptEmbeddingWorkflow` with the real Admin target
  `cmp76fchw000wny01oypnsqby` / `cmp721jlf07k8o001im3j8iur`, transcript text
  from Manager artifact `4/transcript.json`, provider `mux`, and `force` mode.
  Studio completed all three steps and Admin stored a 1536-dimensional transcript
  vector row with Mastra run id `0ea2d5f3-8cae-4de3-8fce-297364f6b134`.
- Re-ran the full real transcript+timed-segments payload through the Mastra
  service route and restored the local DB to the segment-aware state:
  `mastraRunId=54f1c0d7-04fa-4470-9400-3093a0e1f892`, `totalTokens=452`,
  `dimensions=1536`, source artifact `4/transcript.json`.
- Ran local Admin core sync against the Docker-backed Admin DB. The full
  video-related scope completed with coverage audit `pass`: 1,099 videos,
  1,531 editions, 10,534 subtitles, 210,104 dubs, 174,124 Mux videos, and
  1,365,085 dub downloads.
- Built a real transcript source payload from the core-synced
  `2_UltimateCoach` English VTT and launched Mastra with external target
  `{ assetId: "2_UltimateCoach", muxAssetId, adminVideoId }` in `force` mode.
  Mastra route returned `ok: true`, `status: created`,
  `mastraRunId=12266fcc-e8da-4275-a1c8-e27292130a66`, `chunks=1`,
  `totalTokens=302`, `dimensions=1536`, and
  `sourceContentHash=sha256:8738ae59d3003c96ce50cfbbfa3d64712c92d4b3b5a649a9da5b612c6e859ab4`.
- Verified the same run in Mastra Studio's graph: all three tiles were green,
  with `validate-and-plan-transcript-embedding`, `embed-transcript-chunks`, and
  `ingest-transcript-embeddings` complete. The ingest step output showed
  `coreId: "2_UltimateCoach"`, the local Admin video and edition IDs, 1536
  dimensions, and the same Mastra run id/source hash.
- Verified the stored vectors through existing Admin search behavior:
  `GET /api/search?q=ultimate%20coach%20game%20plan&locale=en&type=video`
  returned `The Ultimate Coach` / `wc-ultimate-coach` as the first result with
  `semantic-video` rank 1.
