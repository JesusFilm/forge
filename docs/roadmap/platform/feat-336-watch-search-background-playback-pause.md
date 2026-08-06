---
id: "feat-336"
title: "Watch search background playback pause"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "player"
---

## Problem

A reported floating Watch search session appeared to leave background video
playback running underneath the overlay. Browser characterization confirms the
current shared modal activity contract pauses the underlay, but the real
search-to-media handoff lacks integrated regression coverage and could regress
without either isolated suite failing.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - authoritative search
   open and closing lifecycle.
2. `apps/web/src/components/watch/WatchModalActivityProvider.tsx` - shared modal
   token registry and identity-aware media pause/resume hook.
3. `apps/web/src/components/watch/HeroPlayer.tsx` - Watch hero playback owner.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` and
   `apps/web/src/components/watch/WatchModalActivityProvider.test.tsx` - current
   isolated search and playback coverage.

## Grep These

- `useWatchModalActivity`
- `usePauseForWatchModal`
- `modalChromeHidden`
- `SearchOverlayInstantShell`

## What To Build

- Reproduce a cold first search open while Watch background media is advancing
  and identify the actual playback owner.
- Connect the real floating-search lifecycle to a registered media consumer in
  automated coverage.
- Prove the background media remains paused continuously across the instant
  shell, lazy search controller, and closing transition.
- Preserve exact-element and exact-source resume ownership after the final modal
  activity token releases.
- Keep first-open focus, close/reset behavior, and poster-first page loading.

## Constraints

- Repair the existing shared modal activity seam only if characterization proves
  a failure; do not add search-specific player state or bypass the token registry.
- Media that was already paused must remain paused after search closes.
- Replaced or late-attached media must not receive stale resume entitlement.
- Do not mount or start hero media earlier and do not regenerate GraphQL output.

## Verification

- Run the focused search integration suite:
  `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx --reporter=dot`.
- Run the shared modal registry suite:
  `pnpm --filter @forge/web exec vitest run src/components/watch/WatchModalActivityProvider.test.tsx --reporter=dot`.
- These suites must cover cold/warm search open, closing, overlapping modal
  activity, and media identity changes.
- Existing floating-search, modal-activity, hero, home-carousel, and authored
  player test suites.
- At `http://127.0.0.1:3010/watch` in a 2048 x 1024 desktop viewport, wait for
  the full-screen video `currentTime` to advance, record its `currentSrc`,
  `paused`, and `currentTime`, then activate the `Search videos` button on a
  cold first open. Keep search open through the instant shell, full controller,
  and populated results; the same underlay must report `paused === true` with a
  stable `currentTime`. Press Escape and verify the query resets and only the
  previously playing identity resumes after the closing transition.
- Cold-load resource timing still shows no video element or Mux stream request
  at `load` before the established idle/user-intent gate.
