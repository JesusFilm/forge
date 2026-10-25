---
id: "feat-332"
title: "Consolidate the two video_transcript_chunk semantic retrievers"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-09-08"
duration: 3
depends_on: []
blocks: []
tags:
  - "search"
  - "pgvector"
---

## Problem

Admin maintains TWO independent semantic retrievers over the same
`video_transcript_chunk` pgvector table:

1. `WatchSearchService`'s semantic lane
   (`apps/admin/src/services/watch-search.service.ts`) — the production watch
   search path, with lane instrumentation, caching, and score fusion.
2. `loadExperienceAiVideoCandidates`'s hand-rolled pgvector query
   (`apps/admin/src/services/experience-ai/experience-ai.service.ts`, raw SQL
   over `video_transcript_chunk`) — the experience-AI candidate retrieval.

Two implementations of the same retrieval drift independently: embedding
model/dimension changes, playability filters, locale handling, and scoring
fixes land in one and silently miss the other. Consolidate to one retriever
with two consumers.

## Entry Points — Read These First

1. `apps/admin/src/services/watch-search.service.ts` — the semantic lane
   (`semantic_retrieval` / `semantic_watchability`), its query embedding
   path, and the result shape.
2. `apps/admin/src/services/experience-ai/experience-ai.service.ts` — the
   raw SQL around `FROM video_transcript_chunk vtc` (candidate retrieval,
   its own embedding call, its own filters).
3. `apps/admin/CLAUDE.md` "Hybrid search" + "Transcript embeddings" sections
   — the retrieval architecture and embedding ownership story.

## Grep These

- `video_transcript_chunk` (every consumer in apps/admin)
- `loadExperienceAiVideoCandidates`
- `semantic_retrieval` (the watch-search lane name)
- Embedding model/dimension constants shared (or not) between the two paths

## What To Build

Pick ONE retriever as the substrate (WatchSearchService's lane is the
maintained, instrumented one) and re-express the other consumer on top of it,
OR extract a shared retrieval module both call. Decide and document:

- Whether experience-AI candidate retrieval needs capabilities the watch
  lane lacks (different filters, no watchability fusion, different limits) —
  if so, the shared module takes parameters rather than the consumers
  diverging.
- Query-embedding path unification (one embedding client, one model stamp).
- A real-DB smoke for the consolidated path (mocked SQL-shape tests don't
  prove function resolution — repo discipline).

## Constraints

- No behavior change to public watch search without explicit sign-off — this
  is a consolidation, not a retrieval-quality change.
- Experience-AI draft generation quality must not silently regress: compare
  candidate sets before/after on a fixed probe set and record the diff in
  the PR.

## Verification

- One retrieval implementation remains (grep `video_transcript_chunk`
  consumers).
- Real-DB smoke green; both consumers' suites green.
- Before/after candidate-set comparison recorded.
