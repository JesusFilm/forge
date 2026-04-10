---
title: "feat: Add separate metadata embedding to embeddings artifact"
type: feat
status: completed
date: 2026-04-08
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - /docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md
---

# feat: Add separate metadata embedding to embeddings artifact

## Overview

Extend Forge's embeddings output with one asset-level metadata embedding built from the normalized metadata step output, while keeping transcript chunk embeddings unchanged and preserving graceful fallback to transcript-only artifacts when metadata is unavailable or fails.

This plan keeps the current runtime architecture:

- keep transcript chunk embeddings as the primary `chunks[]` output
- keep the logical artifact key as `embeddings`
- use the metadata step's normalized output as the source of truth for metadata context
- avoid repeating title/tag text inside every transcript chunk

## Problem Statement / Motivation

Forge's current embeddings improvements made transcript chunking much stronger, but the vectors still represent only what was said in the transcript:

- [embeddings.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.ts)
- [metadata.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/metadata.ts)

That misses high-signal asset-level context already available elsewhere in the pipeline:

- title
- description
- topics
- speakers
- tags
- language

We do not want to solve this by prefixing metadata onto every transcript chunk. That would duplicate the same context across all chunk vectors, dilute chunk-level semantics, and make downstream ranking harder to reason about.

Instead, we want one separate metadata embedding per asset that complements transcript chunks:

- transcript chunk vectors answer "what was said here?"
- metadata embedding answers "what is this video broadly about?"

## Scope

In scope:

- one optional asset-level `metadataEmbedding` added to the `embeddings` artifact
- deterministic metadata text construction from the metadata step output
- workflow coordination so metadata is used when available without losing transcript-only fallback
- tests for success, skip, and fallback cases

Out of scope:

- changing transcript chunking strategy or transcript chunk schema again
- merging metadata text into transcript chunks
- changing job success semantics for metadata failure
- redesigning `feat-009`'s pgvector table in the same slice

## Research Summary

### Internal findings

- [videoEnrichment.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/workflows/videoEnrichment.ts) currently runs `translation`, `chapters`, `metadata`, and `embeddings` in parallel after transcription.
- [metadata.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/metadata.ts) already produces the normalized fields we want to embed:
  - `title`
  - `description`
  - `topics`
  - `speakers`
  - `tags`
  - `language`
- [embeddings.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.ts) already writes a richer additive artifact and is the clear home for one more optional top-level vector.
- [job-artifacts.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/lib/job-artifacts.ts) has a fixed logical key for `embeddings`; introducing a separate sibling artifact would require extra manifest plumbing and more downstream readers.
- Local server validation already proved the current transcript embeddings step can succeed even when metadata fails later, so transcript-only fallback is both achievable and already partly aligned with real workflow behavior.

### Downstream contract implications

- [feat-009](/Users/o/.codex/worktrees/96cb/forge/docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md) still assumes `embeddings.json` as the source artifact and a transcript-chunk-oriented row model.
- [feat-007](/Users/o/.codex/worktrees/96cb/forge/docs/roadmap/topic-experiences/feat-007-topic-clustering.md) also expects to read `embeddings.json` directly.

That means the safest manager-side change is:

- keep `embeddings.json` as the single artifact
- add `metadataEmbedding` additively
- let current consumers ignore it until they are upgraded intentionally

### Strategic conclusion

The best first implementation is not a new artifact and not a new field-group taxonomy. It is:

1. keep transcript chunks untouched in purpose
2. add one optional `metadataEmbedding`
3. build it from the metadata step output only
4. skip it cleanly when metadata is absent, unusable, or failed

## Proposed Solution

### 1. Add an optional top-level `metadataEmbedding`

Extend the embeddings artifact with one asset-level object:

```ts
type MetadataEmbedding = {
  text: string
  embedding: number[]
  fieldsUsed: Array<
    "title" | "description" | "topics" | "speakers" | "tags" | "language"
  >
}
```

Result shape conceptually becomes:

```ts
type EmbeddingsResult = {
  model: string
  dimensions: number
  chunks: EmbeddingChunk[]
  averagedEmbedding: number[]
  metadataEmbedding?: MetadataEmbedding
  metadata: { ...existing additive metadata... }
  artifactKeys: ["embeddings"]
}
```

This keeps current transcript readers working while exposing a dedicated vector for asset-level recall.

### 2. Build metadata embedding text from the metadata step output

Use the same normalized metadata object that is written to `metadata.json`. Do not rebuild title, tags, or topics from transcript text inside the embeddings service.

Build the embedding input text from non-empty fields only, in deterministic order:

1. title
2. description
3. topics
4. speakers
5. tags
6. language

Suggested formatting pattern:

```text
Title: ...
Description: ...
Topics: ...
Speakers: ...
Tags: ...
Language: ...
```

This keeps regeneration stable and makes debugging straightforward because the exact embedded text is retained in the artifact.

### 3. Keep one artifact and coordinate metadata availability at workflow level

Do not create `metadata-embedding.json`.

Instead, keep `embeddings` as the single logical artifact and update workflow coordination so the embeddings step can:

1. generate transcript chunk embeddings immediately from transcription input
2. observe the metadata step outcome
3. include `metadataEmbedding` if the metadata result is available and usable
4. otherwise write the transcript-only artifact shape

The key requirement is deterministic behavior, not strict serialization. The cleanest repo-fit is to let the embeddings step depend on the metadata step result as an input source, while still preserving transcript-only fallback if metadata rejects.

### 4. Treat metadata embedding as an additive enhancement, not a hard requirement

Transcript chunk embeddings remain the required output of the step.

The embeddings step should not fail solely because metadata is unavailable. It should skip `metadataEmbedding` when:

- the metadata step failed
- the metadata result has no usable non-language fields
- the workflow cannot obtain the metadata result in time

If metadata is present and usable, generate the extra vector and include it in the final artifact.

### 5. Keep downstream compatibility explicit

This plan does not change the meaning of:

- `chunks[].text`
- `chunks[].embedding`
- top-level `model`
- top-level `dimensions`
- artifact key `embeddings`

Downstream consumers can keep indexing transcript chunks exactly as they do today. Later work can decide how `metadataEmbedding` should map into pgvector storage and ranking.

## Technical Approach

### Workflow contract

Update the workflow so the embeddings path consumes two logical inputs:

- required transcription input
- optional metadata output from the metadata step

The metadata output should be treated as the source of truth because it is already normalized and validated for artifact storage.

This avoids:

- recomputing metadata text from transcript
- read-after-write polling against S3/local artifacts
- divergence between `metadata.json` and the metadata embedding source text

### Artifact writing model

Keep the "write only final validated artifact" rule from the transcript embeddings improvement plan.

Within the embeddings step:

1. validate transcript chunk embeddings
2. resolve whether a usable metadata payload exists
3. if yes, generate and validate one metadata vector
4. write a single final `embeddings.json`

Do not write a partial artifact that later needs in-place mutation.

### Metadata usability rules

`language` alone should not justify creating `metadataEmbedding`.

Require at least one of:

- non-empty title
- non-empty description
- non-empty topics
- non-empty speakers
- non-empty tags

If only `language` is present, skip `metadataEmbedding`.

### Proposed naming and placement

- keep the service in [embeddings.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.ts)
- keep metadata shaping in [metadata.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/metadata.ts)
- add a small repo-local helper for metadata embedding text construction only if it keeps `embeddings.ts` simpler

## Alternative Approaches Considered

### Merge metadata into every transcript chunk

Rejected because it repeats the same context across all chunk vectors and weakens chunk-level semantics.

### Regenerate metadata text directly from transcript inside embeddings

Rejected because it duplicates logic already owned by the metadata step and risks drift from the stored metadata artifact.

### Write a separate `metadata-embedding.json` artifact

Rejected for the first slice because the repo already treats `embeddings` as the canonical artifact key. A sibling artifact would require extra manifest plumbing and would complicate downstream readers before they gain any retrieval value.

## Implementation Units

### Unit 1: Define additive artifact contract

Primary files:

- `apps/manager/src/services/embeddings.ts`
- `docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md` if contract notes need refresh in a follow-up

Work:

- add the optional `metadataEmbedding` type
- preserve all existing transcript chunk fields
- define `fieldsUsed` ordering and embedded source text retention

Verification outcome:

- artifact shape is backward-compatible for transcript-only readers
- metadata embedding presence is optional and explicit

### Unit 2: Add deterministic metadata text builder

Primary files:

- `apps/manager/src/services/embeddings.ts`
- optionally a helper adjacent to `embeddings.ts`

Work:

- build metadata embedding text from normalized metadata output
- ignore empty fields
- skip creation when only `language` exists

Verification outcome:

- tests cover deterministic formatting and field omission
- same metadata input always produces the same `text` and `fieldsUsed`

### Unit 3: Coordinate metadata-aware embeddings in the workflow

Primary files:

- `apps/manager/src/workflows/videoEnrichment.ts`
- `apps/manager/src/workflows/videoEnrichment.test.ts`

Work:

- keep metadata and embeddings in the same post-transcription phase
- ensure embeddings can observe the metadata step result without re-reading storage
- preserve transcript-only completion when metadata fails

Verification outcome:

- workflow tests prove metadata success includes `metadataEmbedding`
- workflow tests prove metadata failure still yields transcript-only embeddings behavior

### Unit 4: Add service-level fallback coverage

Primary files:

- `apps/manager/src/services/embeddings.test.ts`

Work:

- test metadata embedding inclusion on usable metadata
- test skip when metadata fields are empty
- test skip when metadata promise/result is unavailable or rejected
- test dimensions stay aligned between transcript chunks and metadata embedding

Verification outcome:

- transcript embeddings remain the required contract
- metadata embedding stays optional and safe

## Acceptance Criteria

- [x] `embeddings.json` keeps existing transcript chunk fields and artifact key unchanged
- [x] When usable metadata exists, the artifact includes one top-level `metadataEmbedding`
- [x] `metadataEmbedding.text` is built only from the normalized metadata output, not recomputed from transcript
- [x] Empty metadata fields are omitted from the metadata embedding text in deterministic field order
- [x] If metadata fails or yields no usable fields, the embeddings step still produces the transcript-only artifact shape
- [x] Automated tests cover metadata success, metadata absence, and metadata failure fallback
- [x] Downstream transcript-only readers can ignore `metadataEmbedding` without breakage

## Success Metrics

- Local enrich runs with successful metadata now produce both transcript chunk embeddings and one asset-level metadata embedding
- Local enrich runs with failed metadata still persist transcript chunk embeddings
- No existing transcript embeddings tests regress

## Dependencies & Risks

### Dependencies

- [2026-04-08-feat-improve-embeddings-with-mux-ai-patterns-plan.md](/Users/o/.codex/worktrees/96cb/forge/docs/plans/2026-04-08-feat-improve-embeddings-with-mux-ai-patterns-plan.md) should remain the baseline artifact contract
- [2026-04-08-feat-improve-metadata-with-mux-ai-patterns-plan.md](/Users/o/.codex/worktrees/96cb/forge/docs/plans/2026-04-08-feat-improve-metadata-with-mux-ai-patterns-plan.md) is the right place to improve metadata quality; this plan should consume its output, not replace it

### Risks

- `feat-009`'s current pgvector row model is still chunk-oriented, so indexing `metadataEmbedding` will need an intentional follow-up design
- if metadata generation quality is poor, the metadata embedding will faithfully encode poor metadata
- coupling the embeddings step to metadata outcome may slightly increase end-to-end latency for the embeddings step

### Mitigations

- keep the new field additive and optional
- use the normalized metadata output only
- preserve transcript-only fallback as the non-negotiable baseline

## Verification

### Automated

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager lint
```

Focused expectations:

- embeddings service tests cover metadata text construction and skip logic
- workflow tests cover metadata success and failure coordination

### Manual

Run one local enrich job where metadata succeeds and inspect `embeddings.json` for:

- `chunks`
- `averagedEmbedding`
- `metadataEmbedding.text`
- `metadataEmbedding.fieldsUsed`
- `metadataEmbedding.embedding`

Run one local enrich job where metadata fails or produces no usable fields and confirm:

- `chunks` are still present
- `metadataEmbedding` is absent

## References & Research

### Internal references

- [videoEnrichment.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [embeddings.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/embeddings.ts)
- [metadata.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/services/metadata.ts)
- [job-artifacts.ts](/Users/o/.codex/worktrees/96cb/forge/apps/manager/src/lib/job-artifacts.ts)
- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/96cb/forge/docs/solutions/platform/videoforge-manager-integration.md)

### Related roadmap work

- [feat-031 AI Video Enrichment Pipeline](/Users/o/.codex/worktrees/96cb/forge/docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- [feat-009 pgvector Setup and Embedding Indexing](/Users/o/.codex/worktrees/96cb/forge/docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md)
- [feat-007 Topic Clustering from Enriched Metadata](/Users/o/.codex/worktrees/96cb/forge/docs/roadmap/topic-experiences/feat-007-topic-clustering.md)
