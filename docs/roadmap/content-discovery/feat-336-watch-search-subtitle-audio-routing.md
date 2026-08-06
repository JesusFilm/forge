---
id: "feat-336"
title: "Watch search subtitle-only audio routing"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
duration: 1
depends_on:
  - "feat-254"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "search"
  - "subtitles"
  - "multilingual"
---

## Problem

Watch search classifies subtitle-only matches correctly but currently uses the
subtitle language as the public audio-route slug. For `мария`, the Russian
subtitle-only `perfect-2` result therefore links to
`/watch/perfect-2.html/russian.html`, even though Russian is not a playable Dub,
and the route correctly returns 404.

## Entry Points - Read These First

1. `docs/plans/2026-08-05-002-fix-watch-search-subtitle-only-playback-plan.md`
2. `apps/admin/AGENTS.md`
3. `apps/admin/CLAUDE.md`
4. `apps/admin/src/services/search-watchability.ts`
5. `apps/admin/src/services/typesense-watch-search.service.ts`
6. `apps/admin/src/services/typesense-watch-search-indexer.ts`
7. `apps/web/AGENTS.md`
8. `apps/web/CLAUDE.md`
9. `apps/web/src/lib/search.ts`
10. `apps/web/src/lib/watch-search-client.ts`
11. `apps/web/src/lib/content.ts`
12. `apps/web/src/components/watch/WatchPageClient.tsx`
13. `apps/web/src/components/watch/SeriesPageClient.tsx`
14. `apps/web/src/app/api/download/route.ts`

## Grep These

- `target_subtitle|hrefLanguageSlug|videoEditionId` in `apps/admin/src/services`
- `subtitleLanguageSlug|availabilityLanguageSlug|watchVideoPath` in `apps/web/src`
- `watch_search_availability|rebuild-transcripts` in `apps/admin/src/services` and `docs/operations`

## What To Build

- Keep the requested subtitle language as availability truth.
- Resolve a deterministic viewer-public playable Dub on the same Video Edition
  and use that Dub's language for the watch action.
- Preserve semantic candidate edition identity and direct-video subtitle
  ownership in DEFAULT and MODERN search.
- Carry the requested subtitle slug as a validated one-shot Web intent, enable
  it through the existing explicit v2 preference, and clean the URL after use.
- Apply the same subtitle contract to collection trailers and their language
  picker, and deliver Core VTT files through a bounded exact-origin same-origin
  response so browser tracks are not broken by upstream CORS.
- Keep MODERN availability hydration compact and compatible with old aliases
  during the versioned rebuild window.

## Constraints

- Public Watch route paths encode playable audio only.
- Subtitle-only results remain classified as `target_subtitle`.
- A direct-video subtitle must not leak to a sibling sharing the same edition.
- Do not change the `(AI-generated)` source transcript text or provenance.
- Do not enable MODERN traffic, swap indexes, or deploy production from this
  worktree.

## Plan

`docs/plans/2026-08-05-002-fix-watch-search-subtitle-only-playback-plan.md`

## Solution

`docs/solutions/logic-errors/watch-search-subtitle-playback-contract.md`

## Verification

- DEFAULT and MODERN focused tests cover target-audio precedence,
  same-edition fallback selection, direct ownership, edition scoping, and old
  Typesense aliases.
- Web tests cover dual-language mapping, route serialization, owner-filtered
  subtitles, one-shot preference reconciliation, and URL cleanup.
- Browser search for `мария` opens `perfect-2` on a 200 playable audio route
  with Russian enabled as the selected Forge subtitle.

```bash
pnpm --filter @forge/admin exec vitest run src/services/search-watchability.test.ts src/services/typesense-watch-search-indexer.test.ts src/services/typesense-watch-search.service.test.ts src/services/watch-search.service.test.ts
pnpm --filter @forge/web exec vitest run src/lib/search.test.ts src/lib/watch-search-client.test.ts src/lib/content.test.ts src/lib/routes.test.ts src/components/search/VideoCard.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx
pnpm lint
pnpm typecheck
```
