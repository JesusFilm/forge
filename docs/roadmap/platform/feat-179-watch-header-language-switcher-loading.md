---
id: "feat-179"
title: "Watch header language switcher during route loading"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-178"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "regression"
---

## Problem

On watch video pages with the muted hero preview running, clicking an episode
carousel item starts a client-side watch route transition. During the loading
stage, the floating header globe language switch disappears even though the
page is still a watch video context where language switching should remain
available. The switch returns only after the loaded page publishes the next
hero state.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-003-fix-watch-header-language-switcher-loading-plan.md`
   - implementation plan for this regression.
2. `apps/web/src/components/FloatingSearchProvider.tsx` - floating header
   chrome state, pathname resets, and language globe rendering.
3. `apps/web/src/components/watch/HeroPlayer.tsx` - hero-owned language
   switcher event publisher and cleanup.
4. `apps/web/src/lib/watch-player-chrome-events.ts` - shared event contract.
5. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   header chrome and language switcher tests.

## Grep These

- `WATCH_HEADER_LANGUAGE_SWITCHER_EVENT`
- `headerLanguageSwitcher`
- `floating-header-language-button`
- `usePathname`
- `watch-player-chrome-events`

## What To Build

1. Preserve the last valid floating header language switcher during
   watch-video to watch-video loading transitions.
2. Keep loaded-page state authoritative so a new watch page without a language
   switch can still hide the globe.
3. Continue clearing the globe when leaving watch video/episode routes.
4. Add focused tests for the watch loading retention and non-watch clearing
   behavior.

## Constraints

- Do not change public watch URL shape or language-switch navigation.
- Do not make language modal code part of the initial client bundle.
- Do not keep a stale switcher visible after a loaded hero explicitly reports
  that no switcher is available.
- Keep search, share, download, subtitles, and player chrome behavior
  unchanged.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Helium smoke on a watch route confirms the language globe remains visible
  while navigating from the muted preview episode carousel loading state to the
  loaded page.

## Completion Evidence

- Focused tests passed: `FloatingSearchProvider.test.tsx` and
  `HeroPlayer.test.tsx` (92 passed, 2 todo).
- `@forge/web` typecheck and lint passed.
- Helium/agent-browser local smoke at
  `http://127.0.0.1:4911/watch/death-of-jesus.html/english.html` clicked the
  `Burial of Jesus` chapter rail item, landed on
  `/watch/burial-of-jesus.html/english.html`, and recorded `missingCount: 0`
  for the floating header language globe during the transition.
- Screenshot:
  `.tmp/watch-header-globe-after-episode-click.png`.

## Plan

Implementation plan:
`docs/plans/2026-06-11-003-fix-watch-header-language-switcher-loading-plan.md`
