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
last_updated: 2026-06-12
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
3. Collapse each source to one scene row and one transcript row per video before
   the per-source candidate limit when exact recall parity matters.
4. Keep expensive survivor-only fields out of the source collapse: image
   lookup, dub playback lookup, and `embedding::text` should be hydrated after
   the candidate window is already bounded.
5. Resolve matching `language.bcp47` rows once for late dub hydration, but keep
   all matching language ids. Do not use `LIMIT 1` because `bcp47` is not a
   unique language identity.
6. In service code, group rows by video and choose one winning evidence row.
7. Score the video by best raw source score plus a small bounded agreement bonus
   when both sources support it.
8. Return one `VideoSemanticResult` per video.

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

Ordering the full corpus by `video_id` before the vector distance also risks
planner index bypass. That shape asks Postgres to group every embedding row
before applying the source window, which can push production search past web's
15 second upstream budget. A nearest-neighbor source window can help, but do
not apply it blindly before `DISTINCT ON (video_id)`: long videos can contribute
many top chunks and crowd out distinct videos. Ship that more aggressive shape
only with a distinct-video guarantee or duplicate-heavy Mastra relevance proof.

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
