---
title: Watch full-bleed carousel layout pattern
date: 2026-07-22
category: design-patterns
module: apps/web
problem_type: design_pattern
component: frontend_layout
severity: medium
applies_when:
  - Adding or changing a public Watch carousel
  - A Watch rail must browse through content gutters without moving its first card
  - A carousel must remain bounded by the centered 1920px Watch frame
related_components:
  - apps/web/src/components/watch/WatchCarouselContent.tsx
  - apps/web/src/components/ui/carousel.tsx
  - apps/web/src/lib/content-width.ts
tags:
  - watch
  - carousel
  - embla
  - design-system
  - responsive-layout
  - accessibility
---

# Watch full-bleed carousel layout pattern

## Rule

Every public Watch carousel uses `WatchCarousel` and `WatchCarouselContent`.
The carousel root and controls remain in the padded content column. The shared
root supplies a responsive Embla alignment offset so looped and non-zero-start
snaps retain that column. The content wrapper expands only Embla's clipped
viewport through the padding to the centered 1920px Watch frame, then restores
the same leading track padding. An unscrolled first card therefore stays on the
surrounding heading's left edge while later cards can use the full frame as
browsing space.

Do not move the bleed classes back to the carousel root. That changes the
coordinate system used by arrow controls and makes initial alignment a
consumer-specific concern again.

```tsx
<WatchCarousel opts={{ containScroll: "trimSnaps" }}>
  <WatchCarouselContent className="-ml-4">
    {items.map((item) => (
      <CarouselItem key={item.id} className="pl-4">
        {/* card */}
      </CarouselItem>
    ))}
  </WatchCarouselContent>
</WatchCarousel>
```

## Geometry invariant

For the standard Watch rail, all three responsive ladders must match:

| Breakpoint | Viewport bleed | Track leading padding | End spacer |
| ---------- | -------------- | --------------------- | ---------- |
| base       | `-mx-5`        | `pl-5`                | `w-5`      |
| `md`       | `md:-mx-16`    | `md:pl-16`            | `md:w-16`  |
| `xl`       | `xl:-mx-24`    | `xl:pl-24`            | `xl:w-24`  |

The item gap still cancels independently: the generic track's `-ml-4` pairs
with an item's `pl-4`, or a caller may use `-ml-5` with `pl-5`. The complete
initial position is:

```text
frame edge + restored Watch padding - item gap + item padding
= content-column left edge
```

At widths above 1920px, `WATCH_PAGE_CONTENT_CLASSES` centers the 1920px frame.
Cancelling its `xl:px-24` padding reaches that frame edge, not the physical
browser edge.

## Variants

- `layout="rail"` is the default for Watch and Experience rails inside
  `WATCH_PAGE_CONTENT_CLASSES`.
- `layout="inventory"` spans the Watch frame but restores the centered
  `max-w-7xl px-5 sm:px-8` inventory coordinate. Above 1280px its paired
  leading/trailing distance is `max(2rem, calc(50% - 38rem))`.
- `endSpacer={false}` is reserved for looping carousels. Non-looping rails keep
  the default real spacer because Embla `trimSnaps` can trim CSS right padding.

The default spacer is `aria-hidden` and `tabIndex={-1}` so it provides reach
without becoming a focus or screen-reader stop.

## Overflow containment

Unbounded means unbounded relative to the inner content column, not an exposed
Embla track. Keep the generic viewport's
`overflow-x-clip overflow-y-visible`. Never set `overflow-x-visible` on a Watch
carousel: the transformed track can become document overflow and reintroduce
mobile horizontal rubber-banding.

Verify both sides of the rule in a browser:

1. Before scrolling, compare the first card and its nearby heading with
   `getBoundingClientRect().left`; they must match.
2. At 2048px, confirm the carousel stops at the centered 1920px frame.
3. Confirm `document.documentElement.scrollWidth === clientWidth` before and
   after dragging.
4. Drag inside the viewport and confirm the track moves; drag outside it and
   confirm the page does not move horizontally.

## Migration checklist

- Replace direct Watch `Carousel` / `CarouselContent` imports with
  `WatchCarousel` / `WatchCarouselContent` so Embla snaps retain the responsive
  leading inset even for looping and non-zero-start rails.
- Remove local root negative margins, leading Watch padding, and hand-built end
  spacers.
- Preserve item basis/gap classes, Embla options, controls, and accessible
  labels.
- Use a padded Watch parent for `layout="rail"`; use the full
  `CONTENT_WIDTH_ALIGN_CLASSES` frame for `layout="inventory"`.
- Authored `Container` slots that contain a carousel must span all 12 columns.
  A percentage-width slot is a different coordinate system and cannot cancel
  fixed Watch gutters to the frame; non-carousel media variants keep their
  authored spans.
- Run the content-width lockstep and wrapper tests, then the affected consumer
  suites and responsive browser checks.

## Related

- `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`
  documents the generic Experience content-width recipe. Public Watch surfaces
  now use the Watch-specific wrapper because their gutter ladder is different.
- `docs/solutions/ui-bugs/watch-mobile-sibling-carousel-horizontal-rubber-band.md`
  explains why viewport clipping remains mandatory.
