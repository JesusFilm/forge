---
id: "feat-776"
title: "Stop the Watch body from jumping below the player while it streams"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

Field CLS records for mobile Watch views often name the recommendation
loading placeholder as the largest-shift target with `previous_rect` near
y 444 to 474, height 192, and an empty `current_rect`: the viewer has not
scrolled, the placeholder is painted just below the player, and something
then moves it below the viewport shortly after first paint. That is not the
slot growing (feat-775); content above the slot arrives late.

Cause (2026-10-21, local real-content build of main `2bcf98e19`, throttled
mobile Chromium, per-frame recorder): `WatchSectionRenderer` wraps every
block in its own Suspense boundary. React's streaming renderer outlines the
large ones (hero, sibling carousel, `WatchBody`, Bible Quotes) into separate
HTML segments and reveals segments in batches. The small blocks
(recommendation slot, hidden markers) stay inline, and the transcript and
footer render after the body zone. When the hero lands in an earlier batch
than the carousel and `WatchBody`, the browser paints a frame with the hero,
then the slot at y 474 and the transcript at y 730 (390 px wide), because the
pending blocks' `fallback={null}` reserved no space. About 300 ms later the
remaining batch arrives and pushes both off screen: CLS 0.34. This happened
in 1 of 12 natural runs here and 4 of 12 in an earlier session; forcing every
segment to reveal on arrival reproduces it in every run.

## Entry Points — Read These First

1. `apps/web/src/components/watch/WatchSectionRenderer.tsx`: the body-zone
   `Suspense` boundaries and `BodyBlockStreamingFallback`.
2. `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx`:
   "streaming body fallback".
3. `apps/web/src/components/watch/WatchPageClient.tsx`: the transcript renders
   after the body zone.

## Grep These

`BodyBlockStreamingFallback|watch-body-block-streaming-reserve|watch-body-zone`

## What To Build

While a body block is still streaming from the server, its fallback reserves
one viewport height (`min-h-screen`), so anything after it starts below the
fold until it reaches its final position. The reserve is chosen from the
server snapshot of `useSyncExternalStore`, so a fallback first rendered on the
client stays empty, exactly as before.

## Constraints

- No change to the hero, player startup, data fetching, the recommendation
  slot or the order of blocks.
- Do not delay the hero's reveal to batch it with the body: that would move
  LCP later in exactly the runs that benefit.
- The reserve is empty space, not a skeleton; it never contains text,
  links or focusable content.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- Browser: throttled mobile Chromium probe that records every animation frame
  and React's reveal batches, with natural timing (14 runs at 360 and 390 px)
  and with every segment forced to reveal on arrival (6 runs at 320, 360, 390,
  768 and 1280 px), on main and on this change. Firefox geometry with forced
  reveals at 390 px.
- After deployment, compare the mobile Watch share of views with CLS above 0.1
  whose largest shift target is the recommendation placeholder.

## Not covered

- The hero's own Suspense fallback is `h-[66svh]`, taller than the mobile
  portrait hero (466 px at 390 x 844). If the page segment were revealed before
  the hero segment, content below would move up when the hero lands. No run
  showed that order (the hero always revealed with the page segment), so it is
  left unchanged.
