---
id: "feat-760"
title: "Keep caption markers out of Watch search result snippets"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 2
depends_on: []
blocks: []
tags:
  - "admin"
  - "search"
  - "web"
---

## Problem

On 2026-10-20, searching Watch for `is god real` (English) returned
"StoryClubs: Jesus Calms the Storm" with the snippet
`[MUSIC] [MUSIC] [INAUDIBLE] [INAUDIBLE] >> [INAUDIBLE] …`. The video's own
description is a normal sentence ("Jesus gets into a boat and tells His
disciples …"). For a seeker deciding what to watch, a snippet made of caption
markers reads as broken and hides why the result matched.

Cause: semantic video hits use the winning transcript chunk as their
snippet. `hybrid-search-retrievers.ts` selects
`COALESCE(NULLIF(vtc.content_summary, ''), NULLIF(vtc.raw_source_text, ''), vtc.text)`
as `scene_description`, and `mapSemanticCandidate` in
`watch-search.service.ts` passes it through as `snippet` with
`description: null`. A chunk whose text is only caption markers becomes the
visible snippet. Found in the 2026-10-20 website audit round 02
(`docs/reports/2026-10-20-watch-website-audit-round-02.md`).

## Entry Points — Read These First

1. `apps/admin/src/services/hybrid-search-retrievers.ts` — the
   `best_transcript_per_video` CTE and its `scene_description` expression.
2. `apps/admin/src/services/watch-search.service.ts` — `mapSemanticCandidate`
   (`snippet: candidate.sceneDescription`, `description: null`).
3. `apps/web/src/lib/watch-search-client.ts` — `mapWatchSearchResult` /
   `htmlToPlainText`; the card renders `snippet` as-is.
4. `apps/web/src/lib/search.ts` — server-side twin; keep parity tests green.

## Grep These

- `scene_description`
- `snippet: candidate.sceneDescription`
- `INAUDIBLE` (no current handling anywhere)

## What To Build

- In Admin, treat a snippet whose text is empty after removing bracketed
  caption markers (`[MUSIC]`, `[INAUDIBLE]`, `[APPLAUSE]`, `>>`, and
  whitespace) as absent, and fall back to the video's published locale
  description, or to no snippet.
- Pin the production shape (marker-only chunk text) with a unit test on the
  mapper, plus a sibling test where real words around markers survive.

## Constraints

- Do not change ranking, retrieval, scores, or `startSeconds`; this is a
  display fix.
- Do not rewrite stored transcript chunks or re-embed.
- Keep the public `WatchSearchResult` shape. Web's mapping stays a parity
  mirror of `search.ts`.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/services/watch-search.service.test.ts`.
- After deploy, search `is god real` on `/watch`: no result snippet consists
  only of caption markers.

## Implementation disposition (October 29)

PR #2851 implements closed-vocabulary display cleanup in
`apps/admin/src/services/watch-search-snippet.ts`, both search service mappings,
and regression coverage. Ranking, evidence and start times are unchanged.
Complete means implementation is prepared; the PR remains unmerged. Further
non-English/markup cue vocabulary is tracked by feat-781 and must preserve real
editorial brackets. The dated production example above is not a current probe.
