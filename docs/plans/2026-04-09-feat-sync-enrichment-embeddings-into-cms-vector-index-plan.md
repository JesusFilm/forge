---
title: "feat: Sync enrichment transcript embeddings into CMS vector index"
type: feat
status: completed
date: 2026-04-09
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - /docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md
  - /docs/roadmap/content-discovery/feat-010-semantic-search-api.md
---

# feat: Sync enrichment transcript embeddings into CMS vector index

## Overview

Sync completed enrichment-job transcript embeddings into the CMS-owned `video_embeddings` pgvector index, using the same product policy we want for broader CMS sync. In this slice, `video_embeddings` remains the physical table name, but the domain concept is transcript chunk embeddings:

- automatically index only when CMS is missing transcript embeddings for the video
- never overwrite an existing CMS transcript vector index automatically
- persist a durable compare/result summary on the enrichment job
- show operators why indexing was skipped or applied
- allow an explicit override action to reindex CMS from the newly generated artifact

This plan is intentionally narrow. It covers the existing transcript-chunk vector index only, not every possible vector the manager now generates.

## Problem Statement

The manager enrichment pipeline now produces a richer `embeddings.json` artifact:

- transcript chunk embeddings with chunk text and timing metadata
- averaged embedding
- optional asset-level `metadataEmbedding`

But the transcript chunk vectors still stop at artifact storage. The CMS already has the correct persistence layer for transcript search:

- `video_embeddings`
- the `embedding/index` CMS endpoint
- `feat-010` semantic search plans that query transcript chunks from pgvector

Without a sync path:

1. newly enriched videos are not searchable through the CMS transcript vector index
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

[embeddings.ts](/Users/o/.codex/worktrees/8e02/forge/apps/manager/src/services/embeddings.ts) currently writes:

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

[indexer.ts](/Users/o/.codex/worktrees/8e02/forge/apps/cms/src/api/embedding/services/indexer.ts) and [embedding.ts](/Users/o/.codex/worktrees/8e02/forge/apps/cms/src/api/embedding/controllers/embedding.ts) already provide:

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

[feat-010-semantic-search-api.md](/Users/o/.codex/worktrees/8e02/forge/docs/roadmap/content-discovery/feat-010-semantic-search-api.md) assumes:

- `video_embeddings` contains transcript chunk rows
- `chunk_text` is returned as the user-facing search snippet

That makes two constraints explicit:

1. we should not change `video_embeddings` away from transcript chunks in this slice
2. we should not stuff `metadataEmbedding` into this same table just to say it is “synced”

### Manager-to-CMS integration path already exists

[cmsClient.ts](/Users/o/.codex/worktrees/8e02/forge/apps/manager/src/services/cmsClient.ts) is already the shared authenticated REST helper for manager-to-CMS calls.

[sceneEmbedder.ts](/Users/o/.codex/worktrees/8e02/forge/apps/manager/src/services/sceneEmbedder.ts) already demonstrates the intended pattern:

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

Manager should thread that `videoDocumentId` directly into `runVideoEnrichment` input from [enrich/route.ts](/Users/o/.codex/worktrees/8e02/forge/apps/manager/src/app/api/enrich/route.ts), because the current job-state and step-detail shapes do not expose a richer sync-specific payload on readback.

Use one canonical resolver everywhere in this slice:

- resolve the published `videos.id` for the `documentId` when a published row exists
- if only a draft row exists, treat the sync as unsupported in v1 with reason/code `unpublished_video`
- use that same resolver for returned compare summaries, `if_missing`, and `override`

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

The April 8 additive contract work in [manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md](/Users/o/.codex/worktrees/8e02/forge/docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md) stays intact.

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

When an authenticated Manager user or approved manager API-key caller explicitly approves override from the manager job detail or manager API:

- manager calls a manager-owned override route, not the CMS endpoint directly from the browser
- interactive authenticated users in the existing `Manager` role may trigger override
- manager API-key callers authenticated with `MANAGER_API_KEY` may also trigger override
- derive override authority directly from the server-side Manager session or manager API-key auth result
- return `403` for non-Manager users and unauthenticated callers
- browser or API-key clients must not supply the target video identity directly
- the manager route re-reads the current CMS summary before writing
- the request must include the compare report's `generated.contentFingerprint` and `cms.contentFingerprint`
- the route must reject with `409 stale_compare` if either fingerprint no longer matches the reviewed report
- CMS performs the existing delete-then-insert transaction
- the job compare report is updated to reflect the overwrite event, acting user, and approval timestamp

### 5. Canonical durable storage is `artifacts.embeddingSync`

Persist the compare report in `job.artifacts.embeddingSync` as a metadata artifact entry.

Do **not** use `steps[].details` for this slice:

- current manager `JobStepDetails` normalization only round-trips translation `languageResults`
- artifact metadata already survives the current GraphQL read/write path
- the job detail UI already reads artifact-backed metadata

### 6. Sync stays inside the `embeddings` workflow step but is non-fatal

This slice should not add a new workflow step and should not revive `cms_notify`.

Instead:

- generate and persist the `embeddings.json` artifact first
- run embedding sync immediately afterward inside the existing `embeddings` step branch
- always persist `artifacts.embeddingSync` through the existing serialized artifact-merge helper, not a raw artifact replacement update
- if sync fails, record `status: "failed"` in the report but keep the `embeddings` step itself successful when artifact generation succeeded

### 7. V1 keeps the current CMS request limit

The current CMS controller rejects requests above `MAX_CHUNKS = 500`.

For this narrow slice:

- do not add partial indexing or multi-request batching
- if the generated transcript artifact has more than 500 chunks, record `status: "unsupported"` with reason `chunk_limit_exceeded`
- surface that state in the job UI and leave the artifact as the source of truth

## SpecFlow Notes

Important edge cases to cover in the plan:

- job completed embeddings step, but the artifact cannot be read later from storage
- artifact includes `metadataEmbedding` but no transcript chunks
- CMS already has rows, but with a different chunk count or model than the new artifact
- CMS has zero rows because a prior indexing attempt never committed rows or the rows were removed later
- `videoDocumentId` does not resolve to a live CMS row anymore
- operator overrides after the video has been re-enriched again and the compare report is stale

## Proposed Solution

## 1. Make the indexing endpoint return compare summaries

Do not add a standalone `GET /api/embedding/video/:videoDocumentId` endpoint in v1.

Instead, make `POST /api/embedding/index` the single CMS surface for:

- read-only inspect / compare refresh
- missing-only sync
- explicit override
- current-summary return values in both write and skip cases

Route policy:

- protect `POST /api/embedding/index` with `global::api-token-auth`
- require `STRAPI_INTERNAL_API_TOKEN` for transcript embedding sync and override traffic
- fail closed if `STRAPI_INTERNAL_API_TOKEN` is missing
- treat it as manager-to-CMS service traffic, not a public browser endpoint
- return `404` when `videoDocumentId` does not resolve to any CMS video
- return `409 unpublished_video` when the document resolves only to a draft row with no published row

Recommended response shape for `inspect`, `if_missing`, and `override`:

```json
{
  "status": "applied_missing",
  "videoDocumentId": "abc123",
  "resolvedVideoId": 42,
  "hasEmbeddings": true,
  "chunkCount": 18,
  "model": "text-embedding-3-small",
  "contentFingerprint": "sha256:..."
}
```

This gives manager enough information to:

- decide whether CMS is missing or already indexed
- build a meaningful compare UI without exposing raw vectors
- detect stale compare state without relying on sample text alone

For `mode: "if_missing"` when rows already exist, return `200` with:

- `status: "skipped_existing"`
- the current CMS summary

For `mode: "if_missing"` when rows do not exist, write the rows and return:

- `status: "applied_missing"`
- the resulting CMS summary after insert

For `mode: "inspect"`, never write rows. Return the current CMS summary with:

- `status: "has_embeddings"` when rows exist
- `status: "missing"` when no rows exist

That lets manager build and refresh compare state without maintaining a second read endpoint.

## 2. Extend CMS indexing to accept `videoDocumentId`

Additive contract change:

- add `videoDocumentId` for the new manager flow
- keep existing numeric `videoId` support untouched for current callers in this slice

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
  - require `expectedGeneratedContentFingerprint` and `expectedExistingContentFingerprint`
  - return `409 stale_compare` if either fingerprint no longer matches the reviewed compare report
  - delete current rows and insert new rows

This keeps overwrite logic owned by CMS near the actual vector table.

Keep the current `MAX_CHUNKS = 500` controller limit in v1. Manager should treat larger artifacts as `unsupported` rather than attempt partial writes.

## 3. Add a manager embedding-sync service

Create a dedicated manager service responsible for:

- reading `embeddings.json`
- extracting transcript `chunks[]` only
- computing a deterministic generated `contentFingerprint` from normalized chunk payload + model
- rejecting `chunkCount > 500` as `unsupported`
- calling the CMS index endpoint in `if_missing` mode and using its returned summary/result payload
- building a durable compare/result record for the job
- using a structured CMS transport helper that preserves `404`, `409 unpublished_video`, and `409 stale_compare` semantics instead of collapsing them into generic thrown errors

This should not live inside `embeddings.ts` itself. Generation and sync are different responsibilities.

Suggested placement:

- `apps/manager/src/services/embeddingSync.ts`

## 4. Persist a durable compare report on the job

Persist additive job artifact metadata under:

- `artifacts.embeddingSync`

Recommended durable shape:

```ts
type EmbeddingSyncReport = {
  domain: "embeddings"
  videoDocumentId: string
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
    contentFingerprint: string
    hasMetadataEmbedding: boolean
  }
  cms?: {
    resolvedVideoId: number
    hasEmbeddings: boolean
    chunkCount: number
    model?: string
    contentFingerprint?: string
  }
  override?: {
    approvedByUserId: string
    approvedAt: string
  }
}
```

Important:

- do not persist raw float arrays in the job record
- persist fingerprint + summary only
- never rely on `steps[].details` for this payload in v1

## 5. Add job detail compare UI + override action

On the job page, add a Transcript Embeddings CMS Sync card that shows:

- generated transcript embedding summary
- current CMS transcript vector index summary
- sync status
- explanation text

If CMS already has rows:

- show `skipped_existing`
- surface a button like `Override CMS Transcript Embeddings`
- on approval, call a manager API route that proxies an `override` reindex to CMS
- include `generated.contentFingerprint` and `cms.contentFingerprint` from the stored report
- if the route gets `409 stale_compare`, rerun `embeddingSync.ts` against the stored `embeddings.json` artifact in `inspect` mode to refresh `artifacts.embeddingSync`, then require the operator to review again
- refresh the job record after success

Because raw vectors are not human-reviewable, the compare UI should emphasize:

- chunk count
- model
- generated timestamp
- content fingerprint match/mismatch

UI data policy:

- keep the card summary-only in v1; do not persist or render transcript excerpts
- keep the card transcript-embedding-specific in this slice; do not extract shared compare primitives yet
- read `videoDocumentId` from server-side job data / `artifacts.embeddingSync`, never from client-submitted override payload

## 6. Trigger sync after successful embeddings generation

After the `embeddings` step completes successfully in [videoEnrichment.ts](/Users/o/.codex/worktrees/8e02/forge/apps/manager/src/workflows/videoEnrichment.ts):

- call the embedding sync service from the existing `embeddings` step branch after the downloadable artifact manifest has been persisted
- pass `videoDocumentId` directly through `VideoEnrichmentInput`
- do not block the `embeddings` artifact generation contract on CMS overwrite approval
- do not add a separate workflow step in this slice

Recommended semantics:

- if `videoDocumentId` is absent, treat embedding sync as `unsupported` with reason `no_video_document_id` and leave the generic `/api/jobs` flow otherwise unchanged
- keep the core `embeddings` step successful if artifact generation succeeded
- persist `artifacts.embeddingSync` for both success and failure cases
- treat sync errors as reportable subphase failures, not workflow-failing exceptions, once the artifact exists

That avoids conflating “AI generation succeeded” with “publish/index sync succeeded.”

## Red/Green TDD Plan

### Unit 1: CMS indexing response contract

Red:

- add CMS controller tests for `POST /api/embedding/index`
- cover:
  - `mode: "inspect"` on empty index -> returns `missing` without writes
  - `mode: "inspect"` on existing rows -> returns current summary without writes
  - `mode: "if_missing"` on empty index -> inserts and returns applied summary
  - `mode: "if_missing"` on existing rows -> returns `skipped_existing` plus current summary
  - unknown `videoDocumentId` -> `404`
  - route remains protected by API-token middleware
  - published row is used when both published and draft rows exist
  - draft-only videos return `409 unpublished_video`

Green:

- implement video resolution by `documentId`
- return compact index summaries from `video_embeddings` in the `POST /api/embedding/index` response
- return `hasEmbeddings`, not ambiguous `exists`
- compute and return `contentFingerprint`
- use the published-only resolver consistently

Refactor:

- keep video resolution + fingerprint logic local to the embedding API package until a second CMS sync domain needs it

### Unit 2: CMS missing-only and override indexing modes

Red:

- extend controller/service tests for `POST /api/embedding/index`
- cover:
  - `mode: "if_missing"` on empty index -> inserts
  - `mode: "if_missing"` on existing rows -> skips
  - `mode: "override"` on existing rows -> replaces
  - `mode: "override"` with mismatched `expectedGeneratedContentFingerprint` -> `409 stale_compare`
  - `mode: "override"` with mismatched `expectedExistingContentFingerprint` -> `409 stale_compare`
  - `videoDocumentId` resolution failures -> 404
  - draft-only videos return `409 unpublished_video`
  - published-only resolution matches returned compare summaries

Green:

- extend the request contract additively for `videoDocumentId` while preserving numeric `videoId`

Refactor:

- centralize embedding-local “resolve target video + current fingerprint” logic so read and write paths stay consistent without introducing a cross-domain abstraction yet

### Unit 3: Manager embedding-sync service

Red:

- add service tests around a new `embeddingSync.ts`
- cover:
  - successful missing-only index
  - `skipped_existing`
  - missing `videoDocumentId` -> `unsupported`
  - missing artifact
  - artifact with zero transcript chunks
  - artifact with more than 500 transcript chunks -> `unsupported`
  - artifact that includes `metadataEmbedding` but indexes transcript chunks only

Green:

- implement artifact read + generated-summary extraction
- require `videoDocumentId` in service input
- compute generated `contentFingerprint`
- call the CMS indexing endpoint through [cmsClient.ts](/Users/o/.codex/worktrees/8e02/forge/apps/manager/src/services/cmsClient.ts)
- return a durable compare/result object
- refresh stale compare state by rerunning `inspect` against the stored artifact
- preserve structured HTTP status handling for `404`, `409 unpublished_video`, and `409 stale_compare`

Refactor:

- keep the generated-summary + fingerprint builder pure inside `embeddingSync.ts`; do not extract a broader compare framework yet

### Unit 4: Workflow persistence and job details

Red:

- add workflow/state tests proving embedding sync results persist into the job record
- cover:
  - applied missing
  - skipped existing
  - missing `videoDocumentId` records `unsupported` without breaking the shared workflow
  - failed sync without losing the artifact manifest
  - `artifacts.embeddingSync` survives state normalization / GraphQL round-trip
  - `embeddings` step still completes when sync fails after artifact generation

Green:

- write compare report into `artifacts.embeddingSync` after embeddings generation
- preserve current artifact manifest behavior and additive job fields
- persist through the serialized artifact merge path used by concurrent workflow branches

Refactor:

- keep artifact persistence embedding-specific in this slice and defer broader `cms_sync` storage unification

### Unit 5: Job detail compare UI and override action

Red:

- add UI/API tests for the embeddings compare card
- cover:
  - skipped-existing explanation
  - generated vs CMS summaries rendering
  - override button visibility only when the report contains both `contentFingerprint` values
  - unauthorized override returns `403`
  - stale compare returns `409` and forces refresh
  - override success refresh

Green:

- add a manager API route for override
- wire the job details UI to render the compare report
- make the override action call CMS with `mode: "override"`
- keep the route manager-owned and server-side only

Refactor:

- keep the compare card embedding-specific for now

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
  - trigger a stale compare (for example by changing CMS rows before override) and confirm the route returns `409 stale_compare`
  - if a transcript exceeds 500 chunks, confirm the job records `unsupported` with `chunk_limit_exceeded`
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

1. rename `video_embeddings` to `transcript_embeddings` in a dedicated database/copy cleanup PR
2. integrate scene embedding indexing into the enrichment scene-analysis path
3. design a CMS home for future video profile / metadata-derived embeddings only after the retrieval strategy is clear
4. add a bulk-ingest story if transcript chunk counts above 500 become common in production
