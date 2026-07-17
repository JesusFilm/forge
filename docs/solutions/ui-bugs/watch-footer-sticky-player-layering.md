---
title: "Watch footer must establish a layer above the sticky player"
date: "2026-07-15"
category: ui-bugs
module: "apps/web watch"
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "The upper strip of the white footer is replaced by the still-visible sticky video when a viewer reaches the bottom of a single-video page"
  - "Footer content remains present, but the player paints above part of its background and controls at tablet and desktop viewport heights"
root_cause: config_error
resolution_type: code_fix
severity: medium
related_components:
  - "apps/web/src/components/home/WatchHomeFooter.tsx"
  - "apps/web/src/components/watch/HeroPlayer.tsx"
  - "apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx"
tags:
  - "watch-page"
  - "footer"
  - "sticky-video"
  - "stacking-context"
  - "z-index"
  - "playwright"
---

# Watch footer must establish a layer above the sticky player

## Problem

Playable Watch pages render the shared ministry footer after a client-side
page whose hero remains sticky during end-of-page scrolling. The footer root
had no positioning or explicit stacking level, so part of the player could
paint above the footer's white surface where those elements overlapped.

## Symptoms

- The footer's upper strip showed video imagery instead of a continuous white
  background.
- Footer links and contact content were still in the DOM, making this look like
  a spacing problem even though the defect was paint order.
- The overlap was easiest to see around tablet landscape and short desktop
  viewport heights.

## What Didn't Work

- Relying on the footer's later normal-flow position was insufficient because
  the preceding player is a sticky stacking context and its portaled overlay
  anchor has its own explicit layer.
- Adding bottom padding or a player-height spacer would avoid a collision only
  by changing page geometry. It would not define which surface owns the
  overlap and would couple the footer to responsive player measurements.
- Restructuring the sticky hero was deliberately avoided because its measured
  negative `top`, portal anchor, and body scroll-over behavior are load-bearing.

## Solution

Make the shared footer a positioned stacking layer above the player's external
overlay anchor while leaving its content and dimensions unchanged:

```tsx
<footer
  data-testid="watch-home-footer"
  className="relative z-20 bg-white py-10 text-[#131111]"
>
```

Pin that contract with a focused component test that asserts `relative`,
`z-20`, and the existing `bg-white` surface remain on the footer root.

Browser verification should scroll the footer into the overlap boundary and
use `document.elementFromPoint()` inside the formerly covered strip. In the
verified `1440x900` case, the sticky hero extended to `y=810` while the footer
started at `y=700`; the sampled topmost element at `y=724` was the footer, with
no browser page errors.

## Why This Works

`position: sticky` creates a stacking context, so the player's internal
`z-30` and `z-40` descendants remain contained by the player wrapper. The
player's portaled chrome attaches to a separate normal-flow anchor at `z-10`.
Giving the later footer `position: relative` and `z-index: 20` makes the entire
white footer surface paint above both player surfaces without changing scroll
height, hero measurements, or route composition.

## Prevention

- Treat the end of a sticky-media page as an explicit layer boundary; a later
  sibling should declare a positioned layer when it must cover the media.
- Keep player internals, body overlays, and terminal page surfaces on named,
  reviewable stacking levels instead of adding responsive spacers.
- Pair a small class-contract test with real-browser overlap proof. jsdom can
  pin the intended utilities but cannot validate compositor paint order.
- At one viewport where the boxes genuinely overlap, record both bounding
  rectangles and verify the topmost element at a point inside the footer.

## Related Issues

- [Mux Player + custom React-rendered chrome](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md)
  documents the sticky wrapper and `z-10` normal-flow overlay anchor.
- [Firefox sticky-hero backdrop fallback](firefox-backdrop-filter-sticky-hero-scroll-fallback.md)
  explains why the established hero geometry should remain intact during
  composition-local visual fixes.
- [Roadmap ticket feat-254](../../roadmap/platform/feat-254-watch-single-page-footer-layering.md)
  records the scoped implementation and verification contract.
