---
title: "feat: Improve embeddings with @mux/ai patterns"
type: feat
status: active
date: 2026-04-08
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# feat: Improve embeddings with @mux/ai patterns

## Overview

Improve Forge embedding generation by borrowing `muxinc/ai`'s strongest transcript-chunking and result-shaping patterns without adopting `@mux/ai` as a runtime dependency.

This plan intentionally keeps the current architectural boundaries:

- keep Forge on the existing OpenRouter-based embeddings path
- keep the `embeddings` artifact key and current workflow step
- improve chunk planning, batching, metadata richness, and tests using ideas from `muxinc/ai`

## Problem Statement / Motivation

Forge's embeddings service is structurally thin today:

- [embeddings.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/embeddings.ts)

Current limitations:

1. it throws away timestamped transcript structure and chunks only by approximate word count
2. it stores `{ text, embedding }[]` with no chunk timing or token metadata
3. it sends all chunks in one request and assumes the provider returns a perfect one-to-one response
4. it has no dedicated embeddings unit tests

That makes retrieval, debugging, and quality evolution harder than necessary.

## Scope

In scope:

- transcript-aware chunk planning
- embedding batching and response validation
- richer embeddings artifact metadata
- embeddings unit tests and helper tests

Out of scope:

- adopting `@mux/ai` or its provider abstraction
- switching away from `openai/text-embedding-3-small`
- changing artifact download routes or UI entrypoints
- building a vector database ingestion layer

## Research Summary

### Internal findings

- Forge transcription already produces `segments` in [transcription.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/transcription.ts), but embeddings only consume `transcription.text`.
- The current artifact omits:
  - chunk IDs
  - chunk timing
  - token counts
  - averaged embedding
  - generation metadata
- There is no dedicated [embeddings.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/embeddings.test.ts) today.

### `muxinc/ai` patterns worth borrowing

- Chunk primitives and transcript-aware chunking:
  - [`src/primitives/text-chunking.ts`](https://github.com/muxinc/ai/blob/main/src/primitives/text-chunking.ts)
- Embeddings workflow structure:
  - [`src/workflows/embeddings.ts`](https://github.com/muxinc/ai/blob/main/src/workflows/embeddings.ts)
- Result richness:
  - chunk IDs
  - `startTime` / `endTime`
  - token counts
  - averaged embedding
  - generation metadata
- Test shape:
  - [`tests/unit/text-chunking.test.ts`](https://github.com/muxinc/ai/blob/main/tests/unit/text-chunking.test.ts)
  - [`tests/integration/embeddings.test.ts`](https://github.com/muxinc/ai/blob/main/tests/integration/embeddings.test.ts)

### Relevant repo learnings

- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - keep the shared OpenRouter client model
  - keep step-local Zod or contract validation at boundaries
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
  - keep artifact persistence shape stable from the storage layer's perspective

## Proposed Solution

### 1. Introduce a typed chunk layer

Instead of `string[]`, embeddings should operate on repo-local chunk objects:

```ts
type EmbeddingChunk = {
  id: string
  text: string
  tokenCount: number
  startTime?: number
  endTime?: number
}
```

These chunks should come from:

- transcript segments when available, or
- a plain-text fallback when segments are absent

This lets retrieval systems and QA reason about where each chunk came from in the source media.

### 2. Replace naive word chunking with configurable chunk planning

Borrow the spirit of `muxinc/ai`'s chunking primitives:

- max token budget per chunk
- overlap between chunks
- stable chunk IDs
- optional timestamp preservation

We do not need to port every chunking mode. The first improvement can be:

- token-budget chunking for plain transcript text
- segment-aware chunking when transcript segments are available

### 3. Add batching, retries, and response validation

Instead of one giant `embeddings.create(...)` call, process chunks in bounded batches and verify:

- every requested chunk got an embedding
- every embedding has non-zero dimensions
- response counts line up with the input batch

Failures should surface clearly with provider/model context.

### 4. Enrich the artifact schema

Keep the artifact key as `embeddings`, but extend the JSON shape to include:

- `chunks[].chunkId`
- `chunks[].metadata.startTime`
- `chunks[].metadata.endTime`
- `chunks[].metadata.tokenCount`
- `averagedEmbedding`
- top-level metadata such as:
  - total chunk count
  - total tokens
  - chunking strategy
  - embedding dimensions
  - generated timestamp

This mirrors the most valuable parts of `muxinc/ai` without forcing provider abstraction.

## Technical Approach

Refactor [embeddings.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/embeddings.ts) into:

- `planEmbeddingChunks(...)`
- `generateEmbeddingBatch(...)`
- `validateEmbeddingBatch(...)`
- `averageEmbeddings(...)`
- `generateEmbeddings(...)`

Update the workflow call site in [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts) so the step can accept either:

- full transcription result, or
- `text + segments`

That is the key unlock for timestamp-aware chunk metadata.

## Red / Green TDD Plan

### Phase 1: Red

Create dedicated tests first:

- new [embeddings.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/embeddings.test.ts)
- optional helper tests next to a new chunking helper module

Required red cases:

- empty transcript returns no chunks or fails loudly by agreed contract
- chunk IDs are stable and sequential
- overlap produces repeated context across adjacent chunks
- chunk token counts stay within configured budget tolerance
- segment-aware chunking preserves `startTime` and `endTime`
- partial provider responses are rejected
- zero-dimension embeddings are rejected
- persisted artifact includes `averagedEmbedding` and generation metadata

### Phase 2: Green

Implement the smallest viable changes:

- typed chunk planner
- bounded batch loop
- response validation
- averaged embedding calculation
- richer artifact writing

### Phase 3: Refactor

After green:

- simplify chunk planner APIs
- centralize provider error messages
- avoid duplicate chunk/token math
- keep the public workflow surface as stable as possible

### Phase 4: Optional integration confidence

Add an opt-in integration test path, inspired by `muxinc/ai`, only if local credentials are available. This should be explicitly optional and not required for standard repo test runs.

## Acceptance Criteria

- [ ] Embeddings use a typed chunk layer instead of raw `string[]`
- [ ] When transcript segments exist, chunk metadata preserves timing information
- [ ] Embedding generation uses bounded batching with response validation
- [ ] The `embeddings` artifact includes averaged embedding plus chunk metadata
- [ ] Dedicated embeddings tests exist for chunk planning and provider-response validation
- [ ] No new provider abstraction or env var is required for this improvement

## Verification

### Automated

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
```

### Browser / workflow QA

1. Create a fresh enrich job.
2. Wait for embeddings to complete.
3. Open the `embeddings` artifact and verify:
   - chunk metadata exists
   - averaged embedding exists
   - top-level metadata includes chunk count and dimensions

## Risks / Tradeoffs

- Richer embeddings artifacts increase artifact size.
- Timestamp-aware chunking adds code complexity versus the current naive split.
- Batching can slightly increase latency even while improving reliability.

## Not Doing

- No `@mux/ai` dependency adoption
- No multi-provider embeddings abstraction
- No vector database ingestion or retrieval UI in this plan
- No UI redesign around embeddings metadata
