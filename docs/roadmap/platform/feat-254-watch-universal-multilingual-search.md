---
id: "feat-254"
title: "Watch universal multilingual search"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 8
depends_on: []
blocks:
  - "feat-334"
  - "feat-346"
tags:
  - "platform"
  - "watch"
  - "search"
  - "multilingual"
---

## Problem

Watch search currently compresses query language, display locale, target watch
language, evidence language, and availability language into one locale-shaped
input. Viewers need to find exact films, films in a target language, and useful
felt-need/topic results across a multilingual catalog where audio, transcripts,
and localized metadata have uneven coverage.

## Entry Points - Read These First

1. `docs/brainstorms/2026-07-14-universal-multilingual-watch-search-requirements.md`
2. `apps/admin/AGENTS.md`
3. `apps/admin/CLAUDE.md`
4. `apps/web/AGENTS.md`
5. `apps/web/CLAUDE.md`
6. `packages/admin-graphql/CLAUDE.md`
7. `apps/admin/src/graphql/queries/hybrid-search.ts`
8. `apps/admin/src/services/hybrid-search.service.ts`
9. `apps/admin/src/services/hybrid-search-retrievers.ts`
10. `apps/web/src/lib/search.ts`
11. `apps/web/src/lib/watch-search-analytics.ts`

## Grep These

- `search(q|HybridSearch|SearchResult|SearchResponse` in `apps/admin/src`
- `searchVideoSemantic|video_transcript_chunk|embeddingInputText` in `apps/admin/src`
- `searchVideosOperation|SearchActionResult|WEB_SEARCH_MODE` in `apps/web/src/lib`
- `watch-search-analytics|SearchTrace|recordSearchTraceSafely` in `apps`

## What To Build

1. Replace the viewer search GraphQL contract with a search shape that
   separates query language, named language, target watch language, display
   language, evidence language, and availability language.
2. Add server-owned watchability hydration from published video dub/subtitle
   data, with target-language audio as primary and target-language subtitles as
   labeled fallback.
3. Rework retrieval/ranking for P0 lanes: exact/title/entity, language
   availability, and existing transcript semantic evidence.
4. Bound multilingual transcript retrieval by evidence-language fanout,
   candidate windows, lane timeouts, and partial-response behavior.
5. Update Watch web search to consume the replacement contract and display
   availability/evidence truth without depending on client-invented language
   logic.
6. Capture P0 analytics and production timings with privacy-minimized request,
   click, no-result, lane, ranker version, and latency data.

## Constraints

- Preserve existing transcript embeddings and database storage.
- Do not require mobile or TV adoption in P0.
- Do not require curated metadata/topic ranking in P0.
- Do not expose raw vectors, unpublished/internal content, debug payloads, or
  raw query text outside approved privacy boundaries.
- Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql` outputs
  when the Admin GraphQL schema changes.
- Do not deploy directly to production outside the normal PR-to-main flow.

## Verification

- Search v2 returns exact/title results above semantic matches.
- Title-plus-language queries return target-language audio when available and
  clearly labeled subtitle/fallback results otherwise.
- Mixed-language queries do not require the viewer to preselect the matching
  locale.
- Public search never returns unpublished/internal results, private evidence,
  or unauthorized debug fields.
- P0 production-like measurement demonstrates p50 under 800ms, p95 under
  2000ms, and hard timeout/degraded response by 2500ms.
- Watch web search consumes the new contract and records privacy-minimized P0
  analytics.
