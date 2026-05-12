---
title: Embla Carousel bleed-alignment port pattern (Watch + Experience pages)
date: 2026-05-08
category: design-patterns
module: apps/web
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - Porting a horizontally-scrolling card list from a raw `<ul overflow-x-auto>` to the Embla `Carousel` primitive in `apps/web`
  - The first card must align under a section heading's content margin while later cards bleed to the viewport edge
  - Click-and-drag scroll is required (native overflow-x-auto only supports wheel scrolling, not pointer drag)
  - Adding a new Embla-backed surface to `apps/web` that shares CONTENT_WIDTH_CLASSES + carousel bleed/spacer constants with an existing one
  - Adding the first jsdom test for an Embla-backed component (matchMedia / IntersectionObserver / ResizeObserver polyfills required)
related_components:
  - apps/web/src/components/watch/BibleQuotesSection.tsx
  - apps/web/src/components/sections/BibleQuotesCarousel.tsx
  - apps/web/src/components/ui/carousel.tsx
  - apps/web/src/lib/content-width.ts
  - apps/web/vitest.setup.ts
tags:
  - carousel
  - embla
  - accessibility
  - shadcn
  - vitest
  - jsdom
  - content-width
  - watch-page
---

# Embla Carousel bleed-alignment port pattern (Watch + Experience pages)

## Context

`apps/web` has a recurring shape: a horizontally-scrolling card list inside a section that lives below the video hero. The cards should bleed off the right edge of the viewport while the **first card aligns under the section heading**, not against the viewport edge. The Watch route's `BibleQuotesSection.tsx` originally implemented this with a plain `<ul overflow-x-auto>` and produced two visible bugs:

1. The first card sat flush with the viewport edge instead of aligning under the "BIBLE QUOTES" header.
2. Click-and-drag scroll did not work — only `Shift`+wheel did.

The Experience-route sibling (`apps/web/src/components/sections/BibleQuotesCarousel.tsx`) had already solved this with the Embla `Carousel` primitive at `@/components/ui/carousel`. Bringing the Watch surface to parity surfaced a small recipe of decisions that need to be applied together — partial application produces alignment drift, broken drag, or accessibility gaps. This doc is that recipe.

## Guidance

### The component recipe

The component must be `"use client"` because Embla registers pointer listeners in `useEffect`.

```tsx
"use client"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  CAROUSEL_BLEED_CLASSES,
  CAROUSEL_CONTENT_PADDING,
  CAROUSEL_END_SPACER,
} from "@/lib/content-width"

// Predicate exported for direct unit-testing — jsdom collapses layout to
// zero so scrollSnapList() always returns [], making the disable branch
// the live path on every component test. Exporting lets tests call
// shouldEnableDrag() with a stub api object instead of mounting Embla.
export function shouldEnableDrag(api: {
  scrollSnapList: () => unknown[]
}): boolean {
  return api.scrollSnapList().length > 1
}

// Module-level constant. embla-carousel-reactive-utils compares opts via
// areOptionsEqual which serializes function values with .toString(). An
// inline literal (`opts={{ ... }}`) creates a new function reference every
// render — currently render-stable because shouldEnableDrag has no closure,
// but one captured prop in watchDrag would silently flip the equality and
// trigger reInit mid-scroll, briefly tearing down event listeners.
const CAROUSEL_OPTS = {
  align: "start",
  dragFree: true,
  containScroll: "trimSnaps",
  watchDrag: shouldEnableDrag,
} as const

export function MyCarouselSection({ items }: Props) {
  return (
    <section>
      <SectionHeader />
      {/*
        CAROUSEL_BLEED_CLASSES applies negative horizontal margins that
        cancel the parent's px-* padding. The scroll track now extends to
        the edge of the parent container's max-width box. Content padding
        is re-applied inside CarouselContent so the first card's left edge
        lands exactly on the parent content column.
      */}
      <div className={CAROUSEL_BLEED_CLASSES}>
        <Carousel
          aria-label="Bible Quotes"
          opts={CAROUSEL_OPTS}
          className="w-full"
        >
          <CarouselContent className={`-ml-4 ${CAROUSEL_CONTENT_PADDING}`}>
            {items.map((item) => (
              <CarouselItem
                key={item.id}
                className="basis-[85vw] pl-4 sm:basis-[50%] lg:basis-1/4"
              >
                <YourCard item={item} />
              </CarouselItem>
            ))}
            {/*
              Trailing spacer mirrors the left bleed so the last card has a
              symmetric right gutter. tabIndex=-1 + aria-hidden keep keyboard
              focus and screen readers out — Embla's SlideFocus would
              otherwise auto-focus this empty slide on Tab and scroll into
              the empty gutter.
            */}
            <CarouselItem
              className="basis-auto pl-0"
              aria-hidden="true"
              tabIndex={-1}
            >
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
          {/*
            sr-only buttons give keyboard users and headless agents a
            focus-and-click step path without changing the visual
            drag-and-scroll design.
          */}
          <CarouselPrevious className="sr-only" />
          <CarouselNext className="sr-only" />
        </Carousel>
      </div>
    </section>
  )
}
```

### The four lockstep constants

`apps/web/src/lib/content-width.ts` exports four ladders. Their numeric tokens MUST match at every breakpoint:

```ts
export const CONTENT_WIDTH_CLASSES = `mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12`
export const CAROUSEL_BLEED_CLASSES =
  "-mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-10 2xl:-mx-12"
export const CAROUSEL_CONTENT_PADDING =
  "pl-4 sm:pl-6 lg:pl-8 xl:pl-10 2xl:pl-12"
export const CAROUSEL_END_SPACER = "w-4 sm:w-6 lg:w-8 xl:w-10 2xl:w-12"
```

The alignment identity is:

```
first_card_left = parent_content_left + bleed_offset + content_padding + item_pl
                = parent_content_left + (-px-N) + (pl-N) + (pl-4)
```

Bleed cancels the parent's content padding; the item's own `pl-4` then matches `CarouselContent`'s `-ml-4`. Any mismatch produces visible first-card drift relative to the section header. The lockstep test at `apps/web/src/lib/__tests__/content-width.test.ts` asserts the four ladders share matching tokens at every breakpoint — run it whenever you touch this file. See also the related convention doc on grepping for inline tier copies before bumping these constants.

### Test infrastructure: polyfills live in vitest.setup.ts

Embla reads `matchMedia`, `IntersectionObserver`, and `ResizeObserver` during init. jsdom omits all three. Stub them once globally in `apps/web/vitest.setup.ts` — never copy them into individual test files:

```ts
// apps/web/vitest.setup.ts (excerpt)

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

if (typeof globalThis !== "undefined" && !globalThis.IntersectionObserver) {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
}

if (typeof globalThis !== "undefined" && !globalThis.ResizeObserver) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
}
```

Individual test files get a 3-line comment pointing at `vitest.setup.ts` — never the polyfill block itself.

### Side effect: extend the media-chrome × jsdom error filter

Once `IntersectionObserver` and `ResizeObserver` are globally available, MuxPlayer's media-chrome reaches a deeper init path that calls `nativeTracks.addEventListener` on jsdom's `<video>.audioTracks`, which doesn't expose `addEventListener`. Extend the error filter in `apps/web/src/components/watch/__tests__/MuxPlayerSpike.test.tsx` to swallow that pattern alongside the existing `this.append is not a function` suppression. Both are jsdom limitations, not application bugs.

## Why This Matters

Each line of the recipe corresponds to a concrete failure mode. Skipping any one of them produces a visible bug or a silent landmine.

| Omission                                               | Consequence                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing `CAROUSEL_BLEED_CLASSES` wrapper               | Scroll track stops at the parent's content edge; first card appears indented                                                                                                                                                                                                           |
| Numeric mismatch across the four ladders               | First card drifts left or right relative to section header                                                                                                                                                                                                                             |
| Inline `watchDrag` arrow inside `opts={{...}}`         | `areOptionsEqual` flags the literal as new every render; `reInit` fires mid-scroll; pointer events land on torn-down listeners for one tick                                                                                                                                            |
| No trailing spacer `CarouselItem`                      | Last card has no right gutter; asymmetric appearance at scroll end                                                                                                                                                                                                                     |
| Spacer without `aria-hidden` + `tabIndex={-1}`         | Embla's SlideFocus auto-focuses the empty spacer slide on Tab and scrolls the carousel into the empty gutter                                                                                                                                                                           |
| No `<CarouselPrevious>` / `<CarouselNext>`             | Keyboard users and headless agents have no focus-and-click step path                                                                                                                                                                                                                   |
| `shouldEnableDrag` defined inline                      | Cannot unit-test the predicate; jsdom layout collapse means the component test only ever exercises the disabled branch                                                                                                                                                                 |
| Polyfill block in individual test files                | Worker-order-dependent stub state; ESM imports are hoisted above the polyfill block, so the pattern only survives because Embla defers browser-API access to `useEffect` — a future Embla version that touches an observer at module scope breaks every consumer with no obvious cause |
| Global polyfills without extending media-chrome filter | MuxPlayer tests start emitting unhandled `nativeTracks.addEventListener` errors after polyfills deepen jsdom's init path                                                                                                                                                               |

The ESM-hoisting trap is the one most likely to cause a future debugging marathon. A comment claiming "polyfill before importing the component" is technically wrong: `import` statements are hoisted above top-level `if` blocks. The pattern only works today because Embla does not touch `matchMedia` / `IntersectionObserver` / `ResizeObserver` until inside `useEffect`. `vitest.setup.ts` runs before any module is resolved, so it is genuinely guaranteed-first.

## When to Apply

Apply this recipe when:

1. A horizontally-scrolling card list uses `overflow-x-auto` on a `<ul>` or `<div>` — not the `Carousel` primitive
2. The component lives inside a parent with `CONTENT_WIDTH_CLASSES` padding and the cards should bleed to the viewport edge
3. Pointer drag is missing (only `Shift`+wheel scrolls)
4. A sibling component in the same app already uses `Carousel` with the bleed pattern — bring the new component to parity
5. You are adding the first test file for any Embla-powered component and see polyfill stubs hand-rolled in another test file
6. You are adding a new ladder breakpoint to `content-width.ts` (update all four constants and the lockstep test simultaneously)

Do **not** apply if:

- The list is not intended to scroll — use a grid
- The component is a Server Component and cannot become `"use client"`. Restructure: keep data-fetching in the server shell, extract an inner client carousel

## Examples

### Before — raw overflow scroll

`apps/web/src/components/watch/BibleQuotesSection.tsx` before the fix:

```tsx
// No "use client" — no pointer listener possible
<ul className="flex w-full snap-x snap-mandatory gap-4 overflow-x-auto pb-4 -ml-4 pl-4 sm:pl-6 lg:pl-8 xl:pl-10 2xl:pl-12 pr-4 sm:pr-6 lg:pr-8 xl:pr-10 2xl:pr-12">
  {bibleCitations.map((citation) => (
    <li
      key={citation.documentId}
      className="shrink-0 basis-[85vw] snap-start pl-4 sm:basis-[50%] lg:basis-1/4"
    >
      <BibleQuoteCard>...</BibleQuoteCard>
    </li>
  ))}
  <li className="shrink-0 basis-[85vw] snap-start pl-4 sm:basis-[50%] lg:basis-1/4">
    <PromoCard />
  </li>
</ul>
```

Problems: `gap-4` plus per-item `pl-4` produces a doubled gap; the inline `pr-*` ladder drifts from the constants on every bump (see related convention doc); native `overflow-x-auto` has no pointer-drag handler; no keyboard navigation; no a11y region label; first-card alignment math depends on `-ml-4` cancelling per-item `pl-4` exactly, with no test to assert the invariant.

### After — Embla `Carousel`

```tsx
"use client"
// ... imports from recipe above

const CAROUSEL_OPTS = {
  align: "start",
  dragFree: true,
  containScroll: "trimSnaps",
  watchDrag: shouldEnableDrag,
} as const

<div className={CAROUSEL_BLEED_CLASSES}>
  <Carousel aria-label="Bible Quotes" opts={CAROUSEL_OPTS} className="w-full">
    <CarouselContent className={`-ml-4 ${CAROUSEL_CONTENT_PADDING}`}>
      {bibleCitations.map((citation) => (
        <CarouselItem
          key={citation.documentId}
          className="basis-[85vw] pl-4 sm:basis-[50%] lg:basis-1/4"
        >
          <BibleQuoteCard>...</BibleQuoteCard>
        </CarouselItem>
      ))}
      <CarouselItem className="basis-auto pl-0" aria-hidden="true" tabIndex={-1}>
        <div className={CAROUSEL_END_SPACER} />
      </CarouselItem>
    </CarouselContent>
    <CarouselPrevious className="sr-only" />
    <CarouselNext className="sr-only" />
  </Carousel>
</div>
```

First card aligns at every breakpoint; pointer drag works; Tab steps via sr-only buttons; spacer gives a symmetric right gutter; `shouldEnableDrag` is exported and unit-tested; polyfills live in `vitest.setup.ts`; the ladder lockstep is asserted by `content-width.test.ts`.

## Related

- `docs/solutions/conventions/grep-inline-tier-copies-before-bumping-shared-layout-tokens-2026-05-05.md` — companion convention. Before bumping any of the four ladders, grep for inline tier copies. With this fix, `BibleQuotesSection.tsx` no longer carries an inline `pr-*` ladder — that shrinks the surface area but does not eliminate the discipline.
- `docs/solutions/design-patterns/always-render-cta-section-with-placeholder-row-20260505.md` — companion pattern for the same Watch surface. The Bible Quotes promo card is the always-on CTA referenced there.
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md` — adjacent jsdom × media-chrome territory. The error-filter extension in this doc complements the chrome integration pattern there.
- `docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md` — covers the same `useEffect` lifecycle territory Embla relies on.
