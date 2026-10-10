---
id: "feat-250"
title: "Watch Firefox backdrop blur fallback"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "firefox"
  - "rendering"
---

## Problem

Firefox computes the Watch body sheet's `backdrop-filter: blur(40px)` but can
stop painting the blur while the sheet scrolls over the sticky hero. The body
then exposes a sharp moving video through a 35% background, reducing text
contrast and producing a visible transition that does not occur in Chromium.

## Entry Points - Read These First

1. `apps/web/src/components/watch/WatchSectionRenderer.tsx` - owns the body
   sheet that scrolls over the sticky `HeroPlayer`.
2. `apps/web/src/app/globals.css` - owns the browser-specific rendering
   fallback.
3. `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx` -
   protects the body-sheet styling hook and block placement.
4. `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
   - documents the sticky-hero/backdrop-filter relationship and compositor
     cost.

## Grep These

- `watch-body-backdrop`
- `backdrop-blur-2xl`
- `-moz-appearance`
- `rgb(var(--color-section-default)`

## What To Build

1. Keep the existing 40px frosted-glass treatment in browsers where it paints
   reliably.
2. In Firefox, disable the ineffective filter and use a more opaque section
   background so scrolling never reveals a sharp moving hero behind body text.
3. Add regression coverage for the stable body-sheet styling hook.
4. Verify the current and fallback styles in real Firefox and ensure Chromium
   retains the original blur.

## Constraints

- Do not change the sticky hero or Watch block layout.
- Do not add user-agent detection or client-side browser state.
- Do not apply the fallback to dialogs, controls, or unrelated Watch surfaces.
- Preserve the existing texture overlay and content order.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- `pnpm --filter @forge/web exec eslint src/components/watch/WatchSectionRenderer.tsx src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- Firefox Playwright scroll proof on `/watch/jesus.html/english.html` confirms
  the stable high-opacity sheet and no active backdrop filter.
- Chromium smoke on the same route confirms `blur(40px)` remains active.
