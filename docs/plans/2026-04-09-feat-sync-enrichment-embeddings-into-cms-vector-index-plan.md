---
title: "feat: Sync enrichment embeddings into CMS vector index"
type: feat
status: active
date: 2026-04-09
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - /docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md
  - /docs/roadmap/content-discovery/feat-010-semantic-search-api.md
---

# feat: Sync enrichment embeddings into CMS vector index

## Overview

Sync completed enrichment-job transcript embeddings into the CMS-owned `video_embeddings` pgvector index, using the same product policy we want for broader CMS sync:

- automatically index only when CMS is missing transcript embeddings for the video
- never overwrite an existing CMS vector index automatically
- persist a durable compare/result summary on the enrichment job
- show operators why indexing was skipped or applied
- allow an explicit override action to reindex CMS from the newly generated artifact

This plan is intentionally narrow. It covers the existing transcript-chunk vector index only, not every possible vector the manager now generates.

## Problem Statement

The manager enrichment pipeline now produces a richer `embeddings.json` artifact:

- transcript chunk embeddings with chunk text and timing metadata
- averaged embedding
- optional asset-level `metadataEmbedding`

But those outputs still stop at artifact storage. The CMS already has the correct persistence layer for transcript search:

- `video_embeddings`
- the `embedding/index` CMS endpoint
- `feat-010` semantic search plans that query transcript chunks from pgvector

Without a sync path:

1. newly enriched videos are not searchable through the CMS vector index
2. the existing `video_embeddings` infrastructure and `feat-010` remain disconnected from manager enrich jobs
3. operators cannot tell whether CMS is already indexed, newly indexed, or skipped for safety

## Found Brainstorm

Found brainstorm from 2026-04-02: video-content-vectorization. Using as context for planning.

Relevant decisions carried forward:

- transcript chunk embeddings and scene embeddings are different products and should not be forced into one table
- vector storage belongs in raw pgvector tables, not Strapi content types
- search and recommendation quality depends on preserving chunk text alongside vectors

## Current State Research

### Existing manager embedding artifact

[embeddings.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/embeddings.ts) currently writes:

- `model`
- `dimensions`
- `chunks[]`
  - `chunkId`
  - `text`
  - `embedding`
  - `metadata.tokenCount`
  - optional `metadata.startTime`
  - optional `metadata.endTime`
- `averagedEmbedding`
- optional `metadataEmbedding`
- top-level additive metadata including `generatedAt`

The artifact is already strong enough to drive CMS transcript indexing without recomputing vectors.

### Existing CMS vector destination

[indexer.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/cms/src/api/embedding/services/indexer.ts) and [embedding.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/cms/src/api/embedding/controllers/embedding.ts) already provide:

- `video_embeddings` table
- delete-then-insert transactional indexing
- validation for 1536-dimension chunk vectors
- `POST /api/embedding/index`
- `GET /api/embedding/stats`

Current row shape is transcript-chunk-oriented:

- `video_id`
- `chunk_index`
- `chunk_text`
- `embedding`
- `model`

This is the correct CMS home for transcript embeddings today.

### Existing downstream dependency

[feat-010-semantic-search-api.md](/Users/o/.codex/worktrees/1ec2/forge/docs/roadmap/content-discovery/feat-010-semantic-search-api.md) assumes:

- `video_embeddings` contains transcript chunk rows
- `chunk_text` is returned as the user-facing search snippet

That makes two constraints explicit:

1. we should not change `video_embeddings` away from transcript chunks in this slice
2. we should not stuff `metadataEmbedding` into this same table just to say it is “synced”

### Manager-to-CMS integration path already exists

[cmsClient.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/cmsClient.ts) is already the shared authenticated REST helper for manager-to-CMS calls.

[sceneEmbedder.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneEmbedder.ts) already demonstrates the intended pattern:

- manager owns artifact generation
- CMS owns pgvector writes
- manager calls a CMS indexing endpoint with API-token auth

This is the right shape to reuse for transcript embedding sync.

### Identifier mismatch that the plan must resolve

The current embedding endpoint expects numeric `videoId`.

The enrichment flow and job state currently persist:

- `video.documentId`
- `video.coreId`

not the internal numeric Strapi `videos.id`.

So v1 needs a clean identifier bridge. The best repo-fit is to let CMS resolve the video identity server-side from `videoDocumentId` rather than teaching manager to depend on Strapi internal row IDs.

## Key Decisions

### 1. Sync transcript chunk embeddings only in v1

This plan syncs only `EmbeddingsResult.chunks[]` into `video_embeddings`.

It does **not** sync:

- `metadataEmbedding`
- `averagedEmbedding`

Reason:

- the existing CMS table and `feat-010` query contract are transcript-chunk-oriented
- `metadataEmbedding` is semantically different and should not be flattened into per-chunk rows
- `averagedEmbedding` is a derived summary vector, not the current search/query primitive

### 2. Keep `metadataEmbedding` artifact-only for now

The April 8 additive contract work in [manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md) stays intact.

This plan explicitly defers a CMS home for `metadataEmbedding` to future work. That future slice may introduce:

- a separate `video_metadata_embeddings` table
- an additive `embedding_kind` model if we intentionally redesign read paths

but it should not piggyback on transcript search storage by accident.

### 3. Missing-only auto-indexing is the default safety policy

If CMS already has transcript embedding rows for the video:

- do not auto-delete
- do not auto-reindex
- record a durable `skipped_existing` sync result
- show generated vs indexed summaries in the job UI

### 4. Override means explicit reindex

When the user approves override:

- manager calls a CMS reindex endpoint
- CMS performs the existing delete-then-insert transaction
- the job compare report is updated to reflect the overwrite event

## SpecFlow Notes

Important edge cases to cover in the plan:

- job completed embeddings step, but the artifact cannot be read later from storage
- artifact includes `metadataEmbedding` but no transcript chunks
- CMS already has rows, but with a different chunk count or model than the new artifact
- CMS has zero rows because a prior indexing attempt partially failed before commit
- `videoDocumentId` does not resolve to a live CMS row anymore
- operator overrides after the video has been re-enriched again and the compare report is stale

## Proposed Solution

## 1. Add CMS-side video-specific embedding summary/read support

Extend the CMS embedding API with a video-specific summary endpoint, for example:

- `GET /api/embedding/video/:videoDocumentId`

Recommended response shape:

```json
{
  "videoDocumentId": "abc123",
  "resolvedVideoId": 42,
  "exists": true,
  "chunkCount": 18,
  "model": "text-embedding-3-small",
  "sampleChunkTexts": ["Jesus went to...", "The crowd gathered..."],
  "indexedAt": "2026-04-09T12:34:56.000Z"
}
```

This gives manager enough information to:

- decide whether CMS is missing or already indexed
- build a meaningful compare UI without exposing raw vectors

## 2. Extend CMS indexing to accept `videoDocumentId`

Additive contract change:

- keep supporting `videoId` for existing callers if needed
- add support for `videoDocumentId`

Recommended request contract:

```json
{
  "videoDocumentId": "abc123",
  "chunks": [{ "text": "...", "embedding": [0.1, 0.2] }],
  "model": "text-embedding-3-small",
  "mode": "if_missing"
}
```

Recommended indexing modes:

- `if_missing`
  - index only when no current rows exist
  - return `skipped_existing` otherwise
- `override`
  - delete current rows and insert new rows

This keeps overwrite logic owned by CMS near the actual vector table.

## 3. Add a manager embedding-sync service

Create a dedicated manager service responsible for:

- reading `embeddings.json`
- extracting transcript `chunks[]` only
- fetching current CMS embedding summary
- calling the CMS index endpoint in `if_missing` mode
- building a durable compare/result record for the job

This should not live inside `embeddings.ts` itself. Generation and sync are different responsibilities.

Suggested placement:

- `apps/manager/src/services/embeddingSync.ts`

## 4. Persist a durable compare report on the job

Add additive job artifact metadata for embedding sync, for example under:

- `artifacts.cmsSync`
- or `steps[].details`

Recommended durable shape:

```ts
type EmbeddingSyncReport = {
  domain: "embeddings"
  status:
    | "applied_missing"
    | "skipped_existing"
    | "failed"
    | "override_applied"
    | "unsupported"
  reason?: string
  generated: {
    model: string
    dimensions: number
    chunkCount: number
    generatedAt?: string
    sampleChunkTexts: string[]
    hasMetadataEmbedding: boolean
  }
  cms?: {
    resolvedVideoId: number
    chunkCount: number
    model: string
    indexedAt?: string
    sampleChunkTexts: string[]
  }
}
```

Important: do not persist raw float arrays in job compare details. Persist summary and samples only.

## 5. Add job detail compare UI + override action

On the job page, add an Embeddings CMS Sync card that shows:

- generated embedding summary
- current CMS vector index summary
- sync status
- explanation text

If CMS already has rows:

- show `skipped_existing`
- surface a button like `Override CMS Embeddings`
- on approval, call a manager API route that proxies an `override` reindex to CMS
- refresh the job record after success

Because raw vectors are not human-reviewable, the compare UI should emphasize:

- chunk count
- model
- generated/indexed timestamps
- sample chunk text excerpts
- whether a `metadataEmbedding` exists but was intentionally not indexed

## 6. Trigger sync after successful embeddings generation

After the `embeddings` step completes successfully in [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts):

- run the embedding sync service
- do not block the `embeddings` artifact generation contract on CMS overwrite approval
- fail loud only for true sync errors in the initial missing-only path

Recommended semantics:

- missing-only sync failure should mark a dedicated `cms_sync` or `embedding_sync` detail as failed
- it should not destroy the already-valid `embeddings` artifact

Whether the overall job should fail on sync failure is a product choice. For v1, the safest path is:

- keep the core `embeddings` step successful if artifact generation succeeded
- record embedding CMS sync as a separate durable status/details path

That avoids conflating “AI generation succeeded” with “publish/index sync succeeded.”

## Red/Green TDD Plan

### Unit 1: CMS embedding summary/read contract

Red:

- add CMS controller tests for `GET /api/embedding/video/:videoDocumentId`
- cover:
  - video with no rows
  - video with rows
  - unknown `videoDocumentId`

Green:

- implement video resolution by `documentId`
- return compact index summaries from `video_embeddings`

Refactor:

- keep video resolution in a small shared service/helper so other CMS sync domains can reuse it later

### Unit 2: CMS missing-only and override indexing modes

Red:

- add controller/service tests for `POST /api/embedding/index`
- cover:
  - `mode: "if_missing"` on empty index -> inserts
  - `mode: "if_missing"` on existing rows -> skips
  - `mode: "override"` on existing rows -> replaces
  - `videoDocumentId` resolution failures -> 404

Green:

- extend the request contract additively
- keep numeric `videoId` compatibility if anything else still depends on it

Refactor:

- centralize “resolve target video + current index existence” logic so read and write paths stay consistent

### Unit 3: Manager embedding-sync service

Red:

- add service tests around a new `embeddingSync.ts`
- cover:
  - successful missing-only index
  - `skipped_existing`
  - missing artifact
  - artifact with zero transcript chunks
  - artifact that includes `metadataEmbedding` but indexes transcript chunks only

Green:

- implement artifact read + generated-summary extraction
- call CMS summary and indexing endpoints through [cmsClient.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/cmsClient.ts)
- return a durable compare/result object

Refactor:

- keep the generated-summary builder pure so it can be reused by the UI and override route

### Unit 4: Workflow persistence and job details

Red:

- add workflow/state tests proving embedding sync results persist into the job record
- cover:
  - applied missing
  - skipped existing
  - failed sync without losing the artifact manifest

Green:

- write compare report into job artifacts/details after embeddings generation
- preserve current artifact manifest behavior and additive job fields

Refactor:

- normalize compare-report storage with the broader CMS sync design so subtitles/metadata/chapters can follow the same pattern later

### Unit 5: Job detail compare UI and override action

Red:

- add UI/API tests for the embeddings compare card
- cover:
  - skipped-existing explanation
  - generated vs CMS summaries rendering
  - override button visibility only when override is valid
  - override success refresh

Green:

- add a manager API route for override
- wire the job details UI to render the compare report
- make the override action call CMS with `mode: "override"`

Refactor:

- extract shared compare-card primitives if the broader CMS sync work will reuse them

## Verification

- `pnpm --filter @forge/cms test`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- manual local run:
  - enrich one video to completion
  - confirm a new job records embedding sync as `applied_missing` when CMS had no rows
  - rerun the same video and confirm the next job records `skipped_existing`
  - use the override button and confirm CMS row count/model update while the job compare report changes to `override_applied`
- DB verification:
  - `video_embeddings` row count increases for the first run
  - chunk text remains searchable and aligned with the generated artifact

## Out of Scope

- syncing `metadataEmbedding` into CMS
- redesigning `video_embeddings` to hold multiple embedding kinds
- syncing scene embeddings as part of the enrichment-job flow
- exposing raw vector values in the manager UI
- changing the `feat-010` semantic search query contract in this slice

## Follow-up Work

If this lands cleanly, the next likely follow-ups are:

1. add a separate CMS home for `metadataEmbedding`
2. fold embeddings into the broader `cms_sync` job card system planned in [2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md)
3. optionally add checksum/fingerprint comparison instead of sample-text-only compare summaries
