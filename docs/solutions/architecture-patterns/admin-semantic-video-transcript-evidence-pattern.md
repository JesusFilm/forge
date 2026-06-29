---
title: "Admin semantic-video retrieval is transcript-backed after feat-192"
date: 2026-06-29
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
  - semantic-video
  - recommendations
related_features:
  - feat-192
  - feat-193
  - feat-198
related:
  - "docs/solutions/platform/admin-hybrid-search-r4-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
  - "docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md"
date_learned: 2026-06-29
supersedes:
  - "docs/solutions/platform/admin-mixed-video-semantic-evidence-pattern-20260521.md"
---

## Context

Admin search originally kept R4 parity with cms: `semantic-video` was backed by
scene embeddings, then temporarily mixed scene and transcript evidence inside
one retriever so transcript chunks would not become a fifth RRF list. feat-192
realigned that architecture again: enriched transcript chunks are now the
runtime evidence source for video semantic search and the legacy
`sceneRecommendations` API shape.

The public family names stay stable for compatibility. `semantic-video` is
still the RRF list label, and `sceneRecommendations` still exists for clients
that expect that API shape. Those names are compatibility names, not proof that
scene embeddings are being read.

## Guidance

Keep the public retrieval topology stable while making transcript chunks the
only consumed video semantic evidence:

The pattern:

1. Embed enriched transcript chunk input text, not raw subtitle text alone.
   Mastra builds `embeddingInputText` with time range, felt needs, Bible
   verses, summary, tone, demographics, spiritual context, and the transcript
   excerpt.
2. Store the same signals as structured chunk fields:
   `rawSourceText`, `embeddingInputText`, `feltNeeds`, `bibleVerses`,
   `contentSummary`, `tone`, `demographics`, `spiritualContext`, and
   `extractionMetadata`.
3. Filter semantic retrieval to the accepted gateway transcript contract:
   provider `jesus-film-ai-gateway`, model `embeddings`, 1536 dimensions,
   native dimensions 1536, and no transform version.
4. Collapse transcript evidence to one best chunk per video inside
   `searchVideoSemantic`, then emit one `semantic-video` candidate per video
   into RRF.
5. Keep `sceneDescription`, `startSeconds`, `playbackId`, and service-internal
   `embeddingText` as compatibility fields owned by the winning transcript
   chunk.
6. Keep `sceneRecommendations` as a compatibility API only. Seed vectors,
   candidate vectors, themes, demographics, and spiritual context should come
   from `video_transcript_chunk`, with `chunk_index` filling the legacy
   `sceneIndex` field.
7. Do not call scene retrieval, scene embedding backfill, or
   `video_scene_locale.embedding` from runtime search/recommendation paths.

## Why This Matters

RRF should combine retrieval families, not implementation eras. Keeping the
`semantic-video` label stable preserves debug labels, keyword-first dilution
semantics, public response shape, and video dedup behavior while allowing the
backing vector evidence to move from scene rows to enriched transcript chunks.

The embedding signal also needs one source of truth. The chunk vector is built
from transcript-grounded text plus structured metadata, and Admin stores both
the text sent to the provider and the extracted fields. That lets operators
debug relevance without reverse-engineering provider input from raw subtitles or
old scene artifacts.

The pgvector constraint is still important: language filters that should use
partial HNSW indexes must live on the same table as the vector. Transcript
semantic search filters on `video_transcript_chunk.language`, with parent
`video_transcript` provenance guarding provider/model compatibility.

Filtering only through joined parent rows risks planner index bypass. Ordering
the full corpus by `video_id` before vector distance can also bypass the
nearest-neighbor shape; bound the vector candidate window before hydrating
survivor-only fields.

Search quality now depends on the enriched transcript payload. If theological,
audience, or brand/entity queries regress, fix the transcript signal, lexical
ranking, or eval gates. Do not re-enable scene retrieval as an implicit
fallback.

## When To Apply

- Maintaining Admin video semantic search after feat-192.
- Debugging `semantic-video` or `sceneRecommendations` results that still have
  scene-flavoured API names.
- Adding transcript chunk metadata that should influence semantic retrieval.
- Reviewing whether legacy scene embedding code can be deleted after eval.

## Examples

Good:

```text
semantic-video = enriched transcript chunk evidence
RRF inputs = semantic-video, keyword-video, semantic-experience, keyword-experience
sceneRecommendations = transcript-backed compatibility API
```

Avoid:

```text
semantic-video = transcript evidence
semantic-scene-video = scene evidence fallback
RRF inputs = five lists
```

The second shape changes scoring semantics and makes a video with both legacy
and current evidence look like it matched two independent retrieval families.

Also avoid:

```text
semantic-video = transcript evidence unless transcript quality is surprising,
then query video_scene_locale.embedding as a fallback
```

That hides transcript signal gaps instead of fixing them. Use feat-198-style
eval/ranking work for keyword-first relevance and feat-193 for legacy scene
code deletion.
