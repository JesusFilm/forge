---
title: "Watch authored media rails need four columns at the tablet breakpoint"
date: "2026-07-14"
category: "ui-bugs"
module: "apps/web Watch homepage"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Portrait cards rendered three per row on tablets and small laptops, making each tile substantially larger than the six-card wide layout."
  - "A nominal 1024px device showed only three cards because the rail retained its medium-breakpoint column count until the extra-large breakpoint."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/sections/MediaCollection.tsx"
  - "apps/web/src/components/sections/MediaCollection.test.tsx"
tags:
  - "watch-page"
  - "responsive"
  - "media-collection"
  - "portrait-cards"
  - "tailwind"
  - "breakpoints"
---

# Watch authored media rails need four columns at the tablet breakpoint

## Problem

The builder-authored Video Bible rail on the Watch homepage used three portrait
cards from the medium breakpoint through the extra-large breakpoint. On tablets
and small laptops, the cards became visually dominant and only three fit in the
row, unlike the denser six-card wide composition.

## Symptoms

- The Video Bible collection showed three roughly 300px-wide portrait cards on
  a 1024px-class device.
- The same section looked appropriately balanced once the extra-large
  six-column rule applied.
- Card content, imagery, crop, and overlays were correct; only the rail density
  was wrong.

## What Didn't Work

- Changing `WatchHomeSection` did not affect the visible rail. The live homepage
  body was builder-authored and rendered through `MediaCollection`; the fallback
  component was not the owner of the screenshot's markup.
- Adding only `lg:grid-cols-4` missed nominal 1024px devices whose usable layout
  viewport stayed below the large breakpoint.
- Adding `min-[960px]:grid-cols-4` beside `md:grid-cols-3` emitted the class, but
  the medium utility still won the generated cascade. The browser continued to
  render three columns.

## Solution

Change the authored carousel rail's existing medium step from three columns to
four, while retaining two columns on mobile and six on extra-large screens:

```tsx
isRail
  ? "grid-cols-2 md:grid-cols-4 xl:grid-cols-6"
  : /* other MediaCollection variants remain unchanged */
```

Keep the change inside the `isRail` branch so collection grids, hero/player
layouts, content, images, links, and hover behavior do not change. Add a focused
component test that asserts both `md:grid-cols-4` and `xl:grid-cols-6` on the
carousel grid.

Verify the real route, not only the class string: at the compact viewport the
authored section should show four cards, and at a wide viewport it should still
show six.

## Why This Works

The card width is controlled by the grid's column count; there was no card-level
sizing bug. Replacing the medium three-column rule with four columns reduces the
intermediate card width using CSS alone and keeps the wide breakpoint intact.
Because the fix changes only a Tailwind class, it adds no client-side viewport
logic, requests, timers, observers, hydration, or media-loading work.

The ownership check is equally important: Watch homepage content can come from
a builder-authored experience. Inspect the rendered DOM or server markup before
editing a similarly named fallback component.

## Prevention

- Trace the rendered component owner from live markup before changing a
  responsive class when authored and fallback surfaces coexist.
- Assert the intermediate and wide breakpoint classes together so the density
  fix cannot silently regress the six-card composition.
- Capture compact and wide browser screenshots for responsive rail changes;
  class presence alone does not prove cascade order or usable viewport behavior.
- For CSS-only layout changes, record that no runtime or network behavior was
  added as the page-load performance proof.

## Related Issues

- [Plan](../../plans/2026-07-14-001-fix-watch-home-portrait-card-sizing-plan.md)
- [Roadmap ticket](../../roadmap/platform/feat-252-watch-home-portrait-card-sizing.md)
- [Watch search overlay breakpoint contract](watch-search-overlay-stacked-control-breakpoints-20260708.md)
