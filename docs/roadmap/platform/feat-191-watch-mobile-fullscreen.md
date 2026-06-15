---
id: "feat-191"
title: "Watch Mobile Fullscreen Button"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mobile"
  - "video"
---

## Problem

On mobile Watch video pages, the custom hero player's fullscreen button does
not enter fullscreen on iPhone Safari. The chrome currently targets the hero
wrapper with the standard Fullscreen API and WebKit wrapper fallback, but
iPhone Safari only exposes native fullscreen through the underlying
`HTMLVideoElement.webkitEnterFullscreen()` method.

## Entry Points - Read These First

1. `docs/plans/2026-06-15-003-fix-watch-mobile-fullscreen-plan.md` -
   implementation plan for this bug.
2. `apps/web/src/components/watch/HeroPlayerControls.tsx` - fullscreen button
   handler and custom chrome portal target.
3. `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx` -
   focused jsdom coverage for fullscreen control behavior.
4. `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
   - prior note documenting iPhone's video-element fullscreen requirement.

## Grep These

- `toggleFullscreen`
- `webkitEnterFullscreen`
- `hero-chrome-fullscreen`
- `useIsFullscreen`

## What To Build

1. Keep the existing wrapper fullscreen request path for browsers that support
   fullscreening the hero wrapper.
2. Add a fallback that calls `webkitEnterFullscreen()` on the current player
   video element when wrapper fullscreen APIs are unavailable.
3. Support native WebKit video fullscreen exit if the video reports that it is
   currently displaying fullscreen.
4. Add regression tests for the standard wrapper path and the iPhone WebKit
   video path.

## Constraints

- Do not fork the mobile controls from desktop controls.
- Do not reintroduce Mux Player native chrome.
- Do not change subtitles, language switching, public Watch URLs, or Admin
  data fetching.
- Do not hand-edit generated GraphQL or locale artifacts.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayerControls.test.tsx`
- Mobile browser smoke on `/watch/life-of-jesus-gospel-of-john.html/english.html`
  confirms the fullscreen button enters fullscreen on an iPhone-sized viewport
  or simulator.
