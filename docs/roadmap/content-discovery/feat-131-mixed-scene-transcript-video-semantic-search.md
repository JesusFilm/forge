---
id: "feat-131"
title: "Mixed scene and transcript evidence for admin video semantic search"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-05-21"
duration: 1
depends_on:
  - "feat-010"
  - "feat-041"
  - "feat-080"
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "pgvector"
---

## Problem

Admin video semantic search currently reads only `video_scene_locale.embedding`.
That preserves the original scene-search migration shape, but it misses spoken
phrases and subtitle/transcript-only concepts that already exist in
`video_transcript_chunk.embedding`.

The next phase should treat scene descriptions and transcript chunks as primary
video-semantic evidence without changing the public search contract or adding a
separate top-level RRF list.

## Entry Points - Read These First

1. `apps/admin/src/services/hybrid-search-retrievers.ts` - `searchVideoSemantic`
   owns the raw pgvector SQL for video semantic retrieval.
2. `apps/admin/src/services/hybrid-search.service.ts` - dispatches
   `semantic-video` as one labeled list into RRF and owns debug rank origins.
3. `apps/admin/src/services/hybrid-search-fusion.ts` - RRF property merge and
   dedup input shape.
4. `apps/admin/src/services/video-dedup.ts` - consumes semantic
   `embeddingText` internally for video dedup.
5. `apps/admin/prisma/schema.prisma` - `VideoSceneLocale` and
   `VideoTranscriptChunk` vector storage and locale/language fields.

## Grep These

```
grep -rn "searchVideoSemantic\\|semantic-video" apps/admin/src/services
grep -rn "video_scene_locale\\|video_transcript_chunk" apps/admin/src apps/admin/prisma
grep -rn "embeddingText\\|deduplicateResults" apps/admin/src/services
grep -rn "semantic-transcript-video\\|5th RRF\\|fifth RRF" docs apps/admin
```

## What To Build

1. Extend `searchVideoSemantic` so it queries both:
   - `video_scene_locale.embedding`
   - `video_transcript_chunk.embedding`
2. Keep transcript evidence inside the existing `semantic-video` retriever; do
   not add `semantic-transcript-video` or any fifth RRF list.
3. Collapse scene and transcript evidence to one ranked semantic candidate per
   video before RRF.
4. Preserve published/deleted gates:
   - `video.deleted_at IS NULL`
   - `video_locale.status = 'published'`
   - requested locale/language only
   - `embedding IS NOT NULL`
5. Preserve public REST and GraphQL response shape. Normal results still expose
   `type`, `id`, `slug`, `title`, `imageUrl`, `snippet`, `startSeconds`,
   `playbackId`, and `score`.
6. Preserve query-embedding failure degradation to
   `searchMode: "keyword-only"`.
7. Preserve service-internal `embeddingText` for video dedup, sourced from the
   winning scene or transcript evidence.

## Constraints

- Do not change transcript or scene embedding generation workflows.
- Do not run production backfills from this work.
- Do not expose vector, embedding, similarity, or evidence-source fields on the
  normal public search result.
- Do not make transcript a separate RRF contributor.
- Keep pgvector filters on the same table as the vector column:
  `video_scene_locale.locale` for scenes and `video_transcript_chunk.language`
  for transcripts.

## Verification

- Transcript-only semantic evidence can surface a video.
- Scene-only semantic evidence still works.
- Scene+transcript evidence for one video is mixed into one `semantic-video`
  candidate, not two RRF entries.
- Strong single-source evidence can outrank weaker mixed evidence.
- Snippet, timecode, and `embeddingText` come from the winning evidence source.
- Debug origins still show one `semantic-video` contribution.
- Run:

```
pnpm --filter @forge/admin test -- hybrid-search-retrievers.test.ts hybrid-search.service.test.ts hybrid-search.keyword-first.test.ts hybrid-search.dilution-cap.test.ts hybrid-search.debug.test.ts search-eval/fingerprint.test.ts
```
