---
title: "Watch Experience grids use one responsive card tree for mobile carousels"
date: "2026-07-22"
category: "ui-bugs"
module: "apps/web Watch Experience MediaCollection"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Multi-item Experience media grids became long vertical card lists on mobile."
  - "Fixing mobile presentation must not change authored carousels or desktop grid density."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/sections/MediaCollection.tsx"
  - "apps/web/src/components/sections/MediaCollection.test.tsx"
tags:
  - "watch-page"
  - "media-collection"
  - "mobile-carousel"
  - "responsive-grid"
  - "scroll-snap"
---

# Watch Experience grids use one responsive card tree for mobile carousels

## Problem

Experience `MediaCollection` blocks authored as grids preserved a desktop grid
at every viewport. On mobile, horizontal cards therefore collapsed to one card
per row and turned curated collections into long vertical lists. Portrait
collection grids were denser, but still lacked the intended horizontal browsing
behavior.

## Symptoms

- Multi-item horizontal grids rendered as one full-width card per row below
  `md`.
- The mobile page became substantially taller as collection size increased.
- The approved mobile treatment needed a partial next-card cue without changing
  card orientation, content, order, navigation, or the desktop grid.

## What Didn't Work

- Rendering separate mobile carousel and desktop grid branches would duplicate
  every `VideoCard`. Even with one branch hidden by CSS, both image and preview
  component trees would mount, increasing initial client work.
- Treating every non-portrait variant as the same desktop grid initially changed
  `hero` and `player` variants from two columns to three. A dedicated desktop
  column decision and a focused `hero` test preserved that existing contract.
- Reusing the authored Embla carousel for both layouts would leave carousel
  semantics and initialization active after the cards visually returned to a
  desktop grid.

## Solution

Keep a single card tree and change only its responsive CSS composition:

```tsx
const usesMobileCarousel = !isRail && items.length > 1

<div
  role={usesMobileCarousel ? "region" : undefined}
  aria-label={usesMobileCarousel ? title : undefined}
  className={
    usesMobileCarousel
      ? "snap-x snap-mandatory overflow-x-auto md:snap-none md:overflow-visible"
      : WATCH_PAGE_CONTENT_CLASSES
  }
>
  <div
    className={cn(
      "grid",
      usesMobileCarousel &&
        "grid-flow-col md:grid-flow-row md:auto-cols-auto",
      mobileCarouselColumns,
      desktopGridColumns,
    )}
  >
    {/* existing VideoCard elements */}
  </div>
</div>
```

Horizontal cards use wide mobile columns so one card dominates while the next
card remains visible. Keep those widths genuinely compact: the current contract
uses `56vw` horizontal columns and `34vw` portrait columns below `sm`, with
`42vw` and `26vw` respectively from `sm` to `md`. Remove the legacy mobile
minimum-height floor at the same time, otherwise the narrower cards become
distorted rather than shorter. Match the `next/image` `sizes` hint and reduce
mobile overlay padding, labels, titles, and item numbers so the visual hierarchy
still fits the smaller frame.

At `md`, the same elements reset to row flow, desktop minimum heights, and the
pre-existing variant-specific grid columns. Single-item blocks skip the
carousel behavior, and authored `variant: "carousel"` blocks continue through
their existing Embla renderer at every viewport.

Keep the surrounding section rhythm responsive as well. Both the authored
`MediaCollection` renderer and the generated `WatchHomeSection` renderer use
`WATCH_MEDIA_SECTION_VERTICAL_PADDING_CLASS`: `py-10` below `md`, restoring the
established `py-16` desktop spacing at `md+`. A shared token prevents the two
visually equivalent section systems from drifting apart.

## Why This Works

Native horizontal overflow provides touch swiping without adding state,
listeners, dependencies, or a second component tree. CSS scroll snap gives the
rail carousel-like stopping behavior, while explicit mobile auto-columns create
the discovery cue. The breakpoint resets flow, auto-column sizing, overflow,
snap behavior, gaps, and rail padding together, so desktop retains its former
grid contract. Scroll snap belongs on the element that owns `overflow-x-auto`,
not its inner grid; otherwise the cards have snap points but no active snap
container.

The renderer still owns exactly one instance of each card. Images, Mux previews,
progress, focus treatment, links, hover backdrops, and authored ordering are
therefore unchanged.

Linked cards provide their own tab stops and the browser scrolls each focused
card into view. When a rail contains non-link cards, make the labeled overflow
region itself focusable with a visible focus ring so native arrow-key scrolling
can still expose offscreen content without a custom listener. Because `tabIndex`
is not responsive, retain that focus indicator after the desktop overflow reset;
an invisible desktop tab stop is worse than the small extra labeled-region stop.

## Prevention

- When one renderer changes interaction model at a breakpoint, prefer one DOM
  tree with a complete responsive reset over duplicated hidden branches.
- Preserve desktop columns per authored variant; test special variants such as
  `hero`, `player`, and `collection`, not only the default grid.
- Gate carousel presentation on multiple items so a single card keeps its
  established responsive width.
- When compacting carousel columns, update the frame minimum height, image
  `sizes` hint, gap, and overlay typography together; changing width alone can
  create tall distorted cards or request unnecessarily large images.
- Scope compact card treatment to grid-backed mobile rails. Authored carousels
  and the `md+` grid must retain their established dimensions.
- Keep equivalent authored and generated media-section padding behind one
  responsive class token; verify both renderers when changing vertical rhythm.
- Keep rails containing non-link cards keyboard-scrollable; hiding the scrollbar
  must not make offscreen informational cards unreachable.
- Pair mobile overflow classes with `md:overflow-visible`, row-flow, auto-column,
  snap, gap, and padding resets. An incomplete reset can look correct at one
  width while retaining hidden horizontal geometry or compact mobile gaps at
  another.
- Browser proof should confirm mobile horizontal movement, partial next-card
  visibility, desktop grid geometry, document width, and console health. If the
  browser surface blocks localhost, report that limit rather than substituting
  an unapproved browser path.

## Related Issues

- [Responsive authored carousel density](watch-authored-media-collection-responsive-card-density.md)
- [Implementation plan](../../plans/2026-07-22-001-watch-grid-mobile-carousels-plan.md)
- [Roadmap ticket](../../roadmap/platform/feat-299-watch-grid-mobile-carousels.md)
