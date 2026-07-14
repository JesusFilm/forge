---
title: "Watch authored carousel variants must render as horizontal rails"
date: "2026-07-14"
category: "ui-bugs"
module: "apps/web Watch homepage"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Portrait cards wrapped into a responsive grid even though Experience authored the section with variant carousel."
  - "Cards became substantially larger on tablets and small laptops than in the pre-June 20 horizontal rail."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/sections/MediaCollection.tsx"
  - "apps/web/src/components/sections/MediaCollection.test.tsx"
tags:
  - "watch-page"
  - "carousel"
  - "media-collection"
  - "portrait-cards"
  - "experience-builder"
  - "embla"
---

# Watch authored carousel variants must render as horizontal rails

## Problem

The Experience backend continued to author the Watch homepage Video Bible
section with `MediaCollection.variant: "carousel"`, but the current web
renderer grouped that value with a responsive grid. At tablet and small-laptop
widths the portrait cards wrapped and expanded, losing the compact, horizontally
browsable rail that existed before June 20.

## Root Cause

The regression was not a backend configuration or card-sizing problem. The
Experience Builder migration had collapsed `carousel` into the grid renderer:

```tsx
const isRail = variant === "carousel"

// `isRail` only changed grid column classes.
<div className="grid ..." />
```

Git history immediately before June 20 showed the intended contract: the
carousel variant used the shared Embla wrappers with start alignment,
drag-free scrolling, trimmed snap containment, fixed-width portrait slides,
and a trailing spacer.

## Solution

Dispatch the authored variant to a real carousel branch:

```tsx
<Carousel
  opts={{
    align: "start",
    dragFree: true,
    containScroll: "trimSnaps",
    watchDrag: (api) => api.scrollSnapList().length > 1,
  }}
>
  <CarouselContent>
    <CarouselItem className="max-w-[200px]">...</CarouselItem>
  </CarouselContent>
</Carousel>
```

Keep the current `VideoCard` component inside each slide so image treatment,
Mux hover preview, backdrop updates, progress, focus behavior, and navigation do
not change. Retain the existing grid branch for every non-carousel variant.
Align the rail with the Watch page gutters and add a real final spacer because
Embla's trimmed containment does not preserve CSS right padding at the end.

## Verification

- The focused component test asserts the carousel region, fixed-width slide,
  content gutter, and end spacer.
- A second assertion proves the `grid` variant remains on the grid renderer.
- At a 1024px-class viewport, browser input moved the first slide from `x=44`
  to approximately `x=-253`, confirming real horizontal carousel movement.
- At 1600px, all six cards stayed in one row at exactly 200px wide and the
  trailing spacer measured 96px.
- No browser console errors appeared, and the implementation adds no data or
  media requests.

## Prevention

- Treat Experience variant values as rendering contracts, not only styling
  hints; add a structural test when a variant changes the interaction model.
- Compare the live backend value with the renderer branch before tuning card
  dimensions or breakpoints.
- Use git history when a user identifies a known-good date; it can distinguish
  an interaction regression from a new responsive-design request.
- For carousel changes, prove actual horizontal movement and final-edge spacing
  in a browser in addition to checking class names.

## Related Issues

- [Plan](../../plans/2026-07-14-001-fix-watch-home-portrait-card-sizing-plan.md)
- [Roadmap ticket](../../roadmap/platform/feat-252-watch-home-portrait-card-sizing.md)
- Historical reference: `5aa833998e602da9b8aee67d24e2400a1912769f`
