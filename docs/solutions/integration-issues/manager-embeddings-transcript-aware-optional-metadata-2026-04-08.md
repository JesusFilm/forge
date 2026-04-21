---
title: "Manager embeddings: transcript-aware chunking with additive metadata artifact contract"
category: integration-issues
module: Manager
date: 2026-04-08
problem_type: integration_issue
component: service_object
symptoms:
  - "Embeddings flattened transcript text even when timestamped transcript segments were available"
  - "The embeddings artifact exposed transcript chunk vectors only, so title and normalized metadata had no separate asset-level vector"
  - "The `embeddings.json` contract had to evolve additively so downstream consumers could keep reading transcript-only output when metadata was unavailable"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - manager
  - embeddings
  - transcript-chunking
  - metadata-embedding
  - mux
  - openrouter
  - artifact-contract
  - fallback
affected_components:
  - apps/manager/src/services/embeddings.ts
  - apps/manager/src/workflows/videoEnrichment.ts
  - apps/manager/src/services/embeddings.test.ts
  - apps/manager/src/workflows/videoEnrichment.test.ts
related_docs:
  - docs/solutions/platform/videoforge-manager-integration.md
  - docs/solutions/platform/new-app-ci-and-deployment-patterns.md
  - docs/solutions/platform/optional-railway-s3-local-fallback.md
  - docs/plans/2026-04-08-feat-improve-embeddings-with-mux-ai-patterns-plan.md
  - docs/plans/2026-04-08-feat-add-separate-metadata-embedding-plan.md
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md
  - docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md
---

# Manager embeddings: transcript-aware chunking with additive metadata artifact contract

## Problem

Manager already had richer enrichment inputs than its embeddings artifact reflected:

- transcription produced `text`, `segments`, and `language`
- metadata produced normalized `title`, `description`, `topics`, `speakers`, `tags`, and `language`
- downstream consumers such as pgvector indexing still expected a single `embeddings.json` artifact

Before this fix, embeddings flattened transcription to plain text, chunked by rough word count, and wrote only transcript chunk vectors. That weakened retrieval quality, removed timing/debug context, and made it hard to add asset-level metadata vectors without risking downstream breakage.

## Root Cause

The workflow contract passed only `transcription.text` into embeddings, so the service lost segment boundaries before chunk planning even started. The artifact contract was also too narrow: it only modeled transcript chunks, even though the pipeline already had separate normalized metadata that should influence search and ranking differently from spoken text.

## Solution

### Preserve transcription structure through the embeddings boundary

`videoEnrichment.ts` now passes structured transcription context into `embeddings.ts` instead of flattening immediately. The embeddings service plans deterministic chunks from transcript segments when available and falls back to plain-text chunking only when segments are absent.

Each chunk now keeps additive metadata that helps retrieval and debugging:

- stable `chunkId`
- `startTime` and `endTime` when segment timing exists
- estimated token count
- top-level chunking metadata and `averagedEmbedding`

### Validate embedding batches before persisting

Embeddings are requested in bounded batches through the shared OpenRouter client. The service validates response count, index alignment, and embedding dimensions before computing the final averaged vector and writing `embeddings.json`.

This keeps the storage contract atomic: only the final validated artifact is written, not partial batch output.

### Add one separate metadata vector instead of polluting transcript chunks

The metadata enhancement stays separate from transcript chunk semantics:

- transcript chunks still answer "what was said here?"
- optional `metadataEmbedding` answers "what is this asset broadly about?"

`metadataEmbedding` is built from the normalized metadata step output in deterministic field order and stored as an additive top-level object with:

- `text`
- `embedding`
- `fieldsUsed`

Existing fields such as `chunks[].text`, `chunks[].embedding`, `model`, and `dimensions` stay intact so older readers can ignore the new shape safely.

## Verification

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- service tests cover segment-aware chunking, sparse metadata handling, metadata embedding generation, and dimension mismatch failures
- workflow tests cover metadata success and transcript-only fallback when metadata fails
- a real local manager run persisted `.tmp/artifacts/{assetId}/embeddings.json` with segment-aware transcript chunks, `averagedEmbedding`, and correct transcript-only fallback when the metadata step failed upstream

One caveat from local smoke testing: the real run that exercised fallback did not persist `metadataEmbedding`, because metadata parsing failed earlier on fenced JSON output. The live metadata-vector path is covered by automated tests, while the local smoke test verified the transcript-only fallback behavior on a real server.

## Prevention

1. Keep `embeddings.json` additive. Evolve the artifact by adding optional fields, not by replacing transcript chunk fields that downstream consumers already read.
2. Keep transcript and metadata semantics separate. Do not prefix title or tags into every transcript chunk.
3. Treat metadata enrichment as optional. Transcript embeddings are the required output; metadata vectors should fail open.
4. Inspect the artifact itself during local validation. Overall job failure can still happen later in `metadata` or `chapters` even when `embeddings` succeeded.
5. Preserve deterministic chunk planning and provider-response validation together. One without the other makes regressions harder to diagnose.
6. Keep CMS storage decisions separate from artifact evolution. `metadataEmbedding` can stay artifact-only until the retrieval strategy justifies a dedicated CMS table or video profile vector.

## Related References

- [VideoForge manager integration](../platform/videoforge-manager-integration.md)
- [New app CI and deployment patterns](../platform/new-app-ci-and-deployment-patterns.md)
- [Optional Railway S3 with local tmp fallback](../platform/optional-railway-s3-local-fallback.md)
- [Plan: improve embeddings with @mux/ai patterns](../../plans/2026-04-08-feat-improve-embeddings-with-mux-ai-patterns-plan.md)
- [Plan: add separate metadata embedding](../../plans/2026-04-08-feat-add-separate-metadata-embedding-plan.md)
- [Roadmap: AI Video Enrichment Pipeline](../../roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- [Roadmap: pgvector embedding indexing](../../roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md)
- [Vector embedding storage scope and PR sequencing](../best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md)
