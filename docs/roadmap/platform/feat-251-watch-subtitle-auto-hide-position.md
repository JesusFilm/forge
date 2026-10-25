---
id: "feat-251"
title: "Watch subtitle position follows player chrome visibility"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "subtitles"
  - "player-chrome"
---

## Problem

The Watch subtitle overlay is intentionally lifted above the timeline and bottom controls while player chrome is visible. When those components auto-hide, subtitles can remain lifted and cover the middle of the picture instead of moving down to the usual bottom-edge position.

## Entry Points - Read These First

1. `docs/plans/2026-07-14-001-fix-watch-subtitle-auto-hide-position-plan.md`
2. `apps/web/src/components/watch/SubtitleOverlay.tsx`
3. `apps/web/src/components/watch/HeroPlayer.tsx`
4. `apps/web/src/components/watch/HeroPlayerControls.tsx`
5. `apps/web/src/components/watch/__tests__/SubtitleOverlay.test.tsx`
6. `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`

## What To Build

1. Keep subtitles clear of the visible timeline and bottom player controls.
2. Move subtitles down to the normal bottom-edge position as soon as player chrome enters its hidden state.
3. Raise subtitles again whenever pointer, keyboard, touch, or focus interaction reveals the chrome.
4. Preserve scroll-aware body-zone avoidance, subtitle selection, fullscreen behavior, and initial hero loading performance.

## Constraints

- Do not change chrome hide/reveal timing or opacity behavior.
- Do not change subtitle language selection, VTT track ownership, cue timing, typography, or backdrop styling.
- Keep the change local to the Watch web player and its focused tests.
- Do not hand-edit generated GraphQL outputs.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SubtitleOverlay.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser proof on a Watch page with an active Forge subtitle captures subtitles above visible controls and at the bottom edge after controls auto-hide.

## Completion Evidence

- `SubtitleOverlay` now receives the current chrome visibility from
  `HeroPlayer`'s existing `onVisibilityChange` callback instead of maintaining
  a second DOM-observer visibility channel.
- Focused overlay coverage proves the visible-hidden-visible transition while
  an active cue remains mounted.
- The Watch browser smoke measured `translateY(-64px)` with chrome visible and
  `translateY(0px)` with chrome hidden; the hidden subtitle edge remained 16 px
  above the player frame bottom.
- Focused Web tests, typecheck, lint, formatting, and browser console review
  passed on 2026-07-14.
