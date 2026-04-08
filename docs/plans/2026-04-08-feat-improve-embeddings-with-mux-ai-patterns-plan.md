---
title: "feat: Improve embeddings with @mux/ai patterns"
type: feat
status: completed
date: 2026-04-08
deepened: 2026-04-08
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

- [embeddings.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.ts)

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

- Forge transcription already produces `segments` in [transcription.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/transcription.ts), but embeddings only consume `transcription.text`.
- The current artifact omits:
  - chunk IDs
  - chunk timing
  - token counts
  - averaged embedding
  - generation metadata
- There is no dedicated [embeddings.test.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.test.ts) today.
- `runVideoEnrichment(...)` currently calls embeddings with only `transcription.text`, so timestamp-aware chunking requires a workflow contract change, not just a local helper refactor.
- Artifact download and manifest logic are keyed on the logical `embeddings` artifact name and content type, so keeping the artifact key stable is easy; the real compatibility risk is downstream JSON readers.
- [feat-009 pgvector indexing](/Users/o/.codex/worktrees/96cb/forge/docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md) explicitly documents the old `{ text, embedding }[]` shape, so this plan should evolve the artifact additively instead of replacing it outright.
- The shared OpenRouter client in `apps/manager/src/services/openrouter.ts` already applies `timeout: 120_000` and `maxRetries: 3`, so service-local retry behavior should be deliberate and must not create a second generic retry loop by accident.

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

- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/96cb/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - keep the shared OpenRouter client model
  - keep step-local Zod or contract validation at boundaries
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/96cb/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
  - keep artifact persistence shape stable from the storage layer's perspective

## Proposed Solution

### 1. Introduce a typed transcript input and chunk layer

Instead of feeding embeddings a bare transcript string and immediately flattening to `string[]`, the workflow should pass a transcript-shaped input that preserves:

- transcript text
- transcript segments when available
- source language when useful for future debugging or downstream indexing

Chunk planning should then produce repo-local chunk objects with:

- a stable chunk ID
- chunk text
- estimated token count
- optional `startTime` / `endTime`

Those chunks should come from:

- transcript segments when available, or
- a plain-text fallback when segments are absent

This keeps `transcription.ts` as the only source of truth for VTT parsing and lets retrieval systems and QA reason about where each chunk came from in the source media.

### 2. Replace naive word chunking with configurable chunk planning

Borrow the spirit of `muxinc/ai`'s chunking primitives:

- max token budget per chunk
- overlap between chunks
- stable chunk IDs
- optional timestamp preservation

We do not need to port every chunking mode. The first improvement can be:

- token-budget chunking for plain transcript text
- segment-aware chunking when transcript segments are available

Use conservative token targets rather than pushing right up against provider ceilings. OpenAI's current embeddings docs still cap each input at 8192 tokens and a single request at 300,000 total input tokens, so the plan should stay comfortably below those limits when building batches.

### 3. Add batching and response validation while reusing existing client retries

Instead of one giant `embeddings.create(...)` call, process chunks in bounded batches and verify:

- every requested chunk got an embedding
- response counts line up with the input batch
- response indexes map back to the intended chunk order
- every embedding has non-zero dimensions
- all embeddings across all batches have the same dimension length

Failures should surface clearly with provider/model/batch context.

The first pass should rely on the shared OpenRouter client's retry behavior rather than layering a second generic retry policy inside `embeddings.ts`. If later production behavior shows a specific batch-scoped recovery need, that can be added intentionally.

### 4. Enrich the artifact schema without breaking existing consumers

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

Keep the existing top-level `model`, `dimensions`, and `chunks[].text` / `chunks[].embedding` fields so current and planned downstream readers can continue indexing `chunk_text` without a same-PR schema migration. This mirrors the most valuable parts of `muxinc/ai` without forcing provider abstraction or breaking `feat-009`.

### 5. Preserve step idempotency by writing only the final validated artifact

Generate and validate all chunk embeddings in memory, compute the averaged embedding only after all batches succeed, and then write a single `embeddings.json` artifact.

If any batch fails, the step should fail without writing a partial artifact. That keeps retries safe under the existing workflow model.

## Technical Approach

### High-Level Technical Design

1. `transcribe(...)` remains the only place that turns Mux subtitles into `{ text, segments, language }`.
2. `runVideoEnrichment(...)` should pass transcription context into embeddings instead of flattening immediately to `transcription.text`.
3. `generateEmbeddings(...)` should:
   - normalize transcript input
   - choose segment-aware or plain-text chunk planning
   - execute bounded embedding batches
   - validate each batch before merging
   - compute `averagedEmbedding`
   - persist the final additive artifact shape under the existing `embeddings` key

### Key Technical Decisions

1. **Pass transcription context, not just text**
   Use a repo-local transcript input derived from `TranscriptionResult` rather than a bare string. That keeps timestamps available without duplicating parsing logic inside embeddings.

2. **Make the artifact additive, not replacement-shaped**
   Keep the existing `chunks[].text` and `chunks[].embedding` fields so downstream indexing work stays unblocked, while adding `chunkId`, timing metadata, token counts, and top-level generation metadata.

3. **Validate by batch semantics, not raw array position alone**
   OpenAI's embeddings response includes per-item indexes, so the safer plan is to validate count and index alignment before trusting response order.

4. **Do not add a second generic retry layer in phase 1**
   The shared OpenRouter client already retries. This plan should improve batching and validation first, then revisit service-local retries only if real provider behavior shows a gap.

### Implementation Units

#### Unit 1: Workflow input contract and chunk planning

Primary files:

- `apps/manager/src/workflows/videoEnrichment.ts`
- `apps/manager/src/services/embeddings.ts`
- optional helper file adjacent to `embeddings.ts` only if it reduces complexity materially

Work:

- change the embeddings step boundary so it receives transcription context instead of only transcript text
- build deterministic chunk planning for:
  - segment-aware transcripts with preserved timing
  - plain-text fallback when segments are absent
- preserve stable sequential chunk IDs and deterministic chunk order

Verification outcome:

- workflow tests still prove embeddings stays in the same post-transcription parallel phase
- chunk-planning tests cover overlap, stable IDs, token-budget tolerance, and timestamp preservation

#### Unit 2: Provider batching and response validation

Primary files:

- `apps/manager/src/services/embeddings.ts`

Work:

- replace the single unbounded embeddings request with bounded batches
- size batches using both chunk count and estimated total token budget
- validate response completeness, index alignment, non-empty embeddings, and consistent dimensions before merging
- raise errors with provider/model/batch context

Verification outcome:

- mocked provider tests reject partial responses, misindexed results, empty embeddings, and dimension drift

#### Unit 3: Artifact shaping and compatibility

Primary files:

- `apps/manager/src/services/embeddings.ts`
- `apps/manager/src/workflows/videoEnrichment.test.ts`

Work:

- keep the logical artifact key and download route unchanged
- persist an additive JSON schema that preserves legacy fields while adding chunk metadata and `averagedEmbedding`
- keep the service return type aligned with the persisted artifact shape so future readers do not reverse-engineer two formats

Verification outcome:

- workflow tests confirm the artifact manifest still exposes `embeddings`
- structural assertions confirm both backward-compatible fields and new metadata are present

#### Unit 4: Service and workflow regression coverage

Primary files:

- `apps/manager/src/services/embeddings.test.ts`
- `apps/manager/src/workflows/videoEnrichment.test.ts`

Work:

- add dedicated service-level tests for chunk planning and batch validation
- update workflow mocks and expectations for the richer embeddings input contract
- keep the coverage local; live-provider integration remains optional

Verification outcome:

- manager tests cover both service-level and workflow-level regressions without requiring live credentials

## Resolved During Planning

- **Empty or whitespace-only transcript input should fail loudly rather than persist an empty embeddings artifact.**
  Downstream retrieval and indexing treat embeddings as searchable content, so an "empty but successful" artifact would be misleading.
- **No new env vars or runtime dependency should be introduced for this improvement.**
  Chunking and batching knobs should remain module-local constants unless later operational tuning proves they need configuration.
- **No artifact route or logical key changes are needed.**
  Contract evolution happens inside the JSON payload only.

## System-Wide Impact

- `apps/manager/src/workflows/videoEnrichment.ts` will change its `stepEmbeddings(...)` call signature and corresponding workflow tests, but embeddings should remain in the same post-transcription parallel branch.
- `apps/manager/src/services/transcription.ts` becomes more valuable as the source of timing truth; embeddings should consume its `segments` output rather than re-parse VTT content independently.
- `apps/manager/src/lib/job-artifacts.ts` and the download route under `apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts` should remain unchanged because the logical key, extension, and content type stay stable.
- `docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md` should be treated as a downstream contract consumer during implementation because it still documents the old artifact shape.
- The richer chunk metadata will likely help `feat-037` and `feat-041`, but those plans should still decide their own storage schema rather than inheriting transcript-artifact structure wholesale.

## Red / Green TDD Plan

### Phase 1: Red

Create dedicated tests first:

- new [embeddings.test.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.test.ts)
- targeted updates in [videoEnrichment.test.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/workflows/videoEnrichment.test.ts)
- optional helper tests only if chunk-planning logic is extracted into its own module

Required red cases:

- empty or whitespace-only transcript fails loudly and does not write an artifact
- chunk IDs are stable and sequential
- overlap produces repeated context across adjacent chunks
- chunk token counts stay within configured budget tolerance
- segment-aware chunking preserves `startTime` and `endTime`
- large inputs split across multiple provider batches while preserving stable chunk order
- partial or misindexed provider responses are rejected
- zero-dimension or dimension-mismatched embeddings are rejected
- persisted artifact keeps legacy `text` / `embedding` fields while also including `averagedEmbedding` and generation metadata

### Phase 2: Green

Implement the smallest viable changes:

- workflow input contract change
- typed chunk planner
- bounded batch loop
- batch response validation
- averaged embedding calculation
- additive artifact writing

### Phase 3: Refactor

After green:

- simplify chunk planner APIs
- centralize provider error messages
- avoid duplicate chunk/token math
- keep the public workflow surface and artifact route stable even though the JSON payload becomes richer

### Phase 4: Optional integration confidence

Add an opt-in integration test path, inspired by `muxinc/ai`, only if local credentials are available. This should be explicitly optional and not required for standard repo test runs.

## Acceptance Criteria

- [x] Embeddings use a typed chunk layer instead of raw `string[]`
- [x] When transcript segments exist, chunk metadata preserves timing information
- [x] Embedding generation uses bounded batching with response validation
- [x] The `embeddings` artifact includes averaged embedding plus chunk metadata
- [x] Dedicated embeddings tests exist for chunk planning and provider-response validation
- [x] No new provider abstraction or env var is required for this improvement

## Verification

### Automated

- manager service-level unit coverage for chunk planning, batching, and response validation
- manager workflow regression coverage for the transcription-to-embeddings handoff and artifact-manifest persistence
- manager static validation for touched files

### Browser / workflow QA

1. Create a fresh enrich job.
2. Wait for embeddings to complete.
3. Open the `embeddings` artifact from the existing download route and verify:
   - legacy `chunks[].text` / `chunks[].embedding` fields still exist
   - chunk metadata exists when transcript segments exist
   - `averagedEmbedding` exists
   - top-level metadata includes chunk count, total tokens, and dimensions
4. Trigger or simulate an empty-transcript / provider-validation failure path and verify no partial `embeddings` artifact is exposed as successful output.

## Risks / Tradeoffs

- **Schema coupling with downstream indexing**
  `feat-009` still expects the old shape. Mitigation: make the JSON contract additive and keep `text` / `embedding` fields intact.
- **Request-size and provider-limit risk**
  OpenAI still documents 8192 tokens per input and 300,000 total input tokens per request. Mitigation: keep chunk targets conservative and size batches by estimated token budget, not only by item count.
- **Retry amplification**
  The shared OpenRouter client already retries up to 3 times. Mitigation: do not add a second generic retry loop in phase 1.
- **Artifact size growth**
  Richer metadata increases JSON size. Mitigation: store only the metadata needed for retrieval/debugging and avoid embedding raw segment arrays or VTT payloads into the artifact.
- **Idempotency under workflow retries**
  Partial artifacts would make reruns hard to reason about. Mitigation: only write the artifact after all batches validate successfully.
- **Approximate token counting**
  The borrowed `muxinc/ai` patterns also use a word-based approximation. Mitigation: keep tolerance in tests and keep production batch ceilings comfortably below provider hard limits.

## Sources & References

- [Manager embeddings service](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.ts)
- [Manager workflow orchestration](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [Manager transcription service](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/transcription.ts)
- [feat-009 pgvector indexing roadmap ticket](/Users/o/.codex/worktrees/96cb/forge/docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md)
- [`muxinc/ai` text chunking primitives](https://github.com/muxinc/ai/blob/main/src/primitives/text-chunking.ts)
- [`muxinc/ai` embeddings workflow](https://github.com/muxinc/ai/blob/main/src/workflows/embeddings.ts)
- [`muxinc/ai` chunking tests](https://github.com/muxinc/ai/blob/main/tests/unit/text-chunking.test.ts)
- [OpenAI embeddings API reference](https://platform.openai.com/docs/api-reference/embeddings/create)
- [OpenAI embedding models guide](https://platform.openai.com/docs/guides/embeddings/embedding-models)

## Not Doing

- No `@mux/ai` dependency adoption
- No multi-provider embeddings abstraction
- No vector database ingestion or retrieval UI in this plan
- No UI redesign around embeddings metadata
