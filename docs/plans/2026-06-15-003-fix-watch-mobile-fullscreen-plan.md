---
title: Watch Mobile Fullscreen Button Fix Plan
type: fix
date: 2026-06-15
origin: docs/roadmap/platform/feat-191-watch-mobile-fullscreen.md
---

# Watch Mobile Fullscreen Button Fix Plan

## Summary

Fix the Watch hero player's fullscreen button on mobile by preserving the
existing wrapper fullscreen path and adding the iPhone Safari-native video
fullscreen fallback documented in the Mux custom chrome pattern.

## Problem Frame

The public route
`/watch/life-of-jesus-gospel-of-john.html/english.html` renders the custom
`HeroPlayerControls` chrome over a bare Mux video element. The fullscreen
button currently tries `wrapper.requestFullscreen()` or
`wrapper.webkitRequestFullscreen()`. That works for browsers that allow
fullscreen on arbitrary elements, but iPhone Safari only allows native
fullscreen through the underlying video element's `webkitEnterFullscreen()`.

## Requirements

- R1. The fullscreen button must still request fullscreen on the hero wrapper
  when standard or wrapper WebKit fullscreen APIs are available.
- R2. On iPhone-style WebKit video surfaces where wrapper fullscreen is
  unavailable, the button must call the current video element's
  `webkitEnterFullscreen()` method.
- R3. If native WebKit video fullscreen is already active and the control is
  reachable, the handler should call `webkitExitFullscreen()`.
- R4. The existing fullscreen portal-target swap, language controls, playback
  controls, subtitles, and data fetching must remain unchanged.

## Implementation Units

### U1. Add Video-Element WebKit Fullscreen Fallback

- **Goal:** Update `HeroPlayerControls` fullscreen handling to route to the
  current player video element when wrapper fullscreen APIs are unavailable.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** none.
- **Files:** `apps/web/src/components/watch/HeroPlayerControls.tsx`.
- **Approach:** Keep `document.fullscreenElement` /
  `document.webkitFullscreenElement` as the wrapper fullscreen state source.
  Before requesting wrapper fullscreen, derive the current media element from
  `playerRef.current`. If it reports `webkitDisplayingFullscreen`, call
  `webkitExitFullscreen()`. Otherwise, prefer the wrapper request path when it
  exists; fall back synchronously to `webkitEnterFullscreen()` on the video
  element when wrapper request APIs are missing.
- **Patterns to follow:**
  `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`,
  `apps/web/src/lib/use-is-fullscreen.ts`.
- **Test scenarios:**
  - Clicking `hero-chrome-fullscreen` calls `wrapper.requestFullscreen()` when
    available.
  - Clicking `hero-chrome-fullscreen` calls
    `player.webkitEnterFullscreen()` when wrapper fullscreen APIs are absent.
  - When `player.webkitDisplayingFullscreen` is true, clicking the button calls
    `player.webkitExitFullscreen()`.
- **Verification:** Focused Vitest file passes.

## Scope Boundaries

- Do not change Watch route resolution, Admin GraphQL, subtitles, language
  picker behavior, or player data mapping.
- Do not change the custom chrome layout or portal-target behavior except for
  the fullscreen request destination.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayerControls.test.tsx`
- Mobile browser smoke on
  `/watch/life-of-jesus-gospel-of-john.html/english.html`.
