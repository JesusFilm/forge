---
title: "Admin video semantic search: mix scene and transcript evidence inside one retriever"
date: 2026-05-21
problem_type: architecture_pattern
component: service_object
severity: medium
module: apps/admin
tags:
  - admin
  - search
  - pgvector
  - rrf
  - transcript-embedding
  - scene-embedding
related_features:
  - feat-010
  - feat-041
  - feat-080
  - feat-131
related:
  - "docs/solutions/platform/admin-hybrid-search-r4-pattern.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
date_learned: 2026-05-21
---

## Context

Admin search originally kept R4 parity with cms: `semantic-video` was backed by
scene embeddings only. Once transcript chunk vectors became product-relevant,
the tempting implementation was a new `semantic-transcript-video` list in RRF.
That would double-count videos that match both scene and transcript evidence.

## Guidance

Keep the public retrieval topology stable: one `semantic-video` list flows into
RRF. Mix source evidence inside `searchVideoSemantic`.

The pattern:

1. Query scene evidence from `video_scene_locale.embedding`.
2. Query transcript evidence from `video_transcript_chunk.embedding`.
3. Select the best row per video per source before bounding each source window.
4. In service code, group rows by video and choose one winning evidence row.
5. Score the video by best raw source score plus a small bounded agreement bonus
   when both sources support it.
6. Return one `VideoSemanticResult` per video.

The winning evidence row owns `sceneDescription`, `startSeconds`, `playbackId`,
and service-internal `embeddingText`. Do not average vectors or expose evidence
source in the normal REST/GraphQL result.

## Why This Matters

RRF should combine different retrieval families, not independently count every
semantic modality. Keeping transcript inside `semantic-video` preserves debug
labels, keyword-first dilution semantics, public response shape, and video dedup
behavior.

The pgvector constraint is also important: filters that should use partial HNSW
indexes must live on the same table as the vector:

- scenes filter `video_scene_locale.locale`;
- transcripts filter `video_transcript_chunk.language`.

Filtering only through joined parent rows risks planner index bypass.

## When To Apply

Use this pattern when adding another evidence source that is still part of the
same product signal. A new RRF list is appropriate only when the source is a
distinct retrieval family with independent product meaning.

## Examples

Good:

```text
semantic-video = mixed(scene evidence, transcript evidence)
RRF inputs = semantic-video, keyword-video, semantic-experience, keyword-experience
```

Avoid:

```text
semantic-video = scene evidence
semantic-transcript-video = transcript evidence
RRF inputs = five lists
```

The second shape changes scoring semantics and makes a video with both scene and
transcript hits look like it matched two independent retrieval families.
