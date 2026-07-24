---
id: "feat-310"
title: "Watch carousel hover controls"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "experience"
  - "ui"
  - "carousel"
  - "accessibility"
---

## Problem

Watch carousel rails rely on dragging or horizontal wheel gestures, and only
some render arrow buttons. Existing arrow buttons sit outside the rail and stay
visible even when the pointer is elsewhere. Desktop viewers need consistent,
edge-aligned navigation controls that appear while interacting with a carousel,
without showing a direction that cannot currently scroll.

## Entry Points — Read These First

1. `apps/web/src/components/ui/carousel.tsx` - shared Embla carousel and arrow
   primitives.
2. `apps/web/src/components/sections/CarouselVideo.tsx`,
   `NavigationCarousel.tsx`, `BibleQuotesCarousel.tsx`, and
   `MediaCollection.tsx` - authored Experience carousel renderers.
3. `apps/web/src/components/home/WatchHomeTvCarousel.tsx`,
   `apps/web/src/components/watch/SiblingCarousel.tsx`, and
   `BibleQuotesSection.tsx` - Watch home and video-page rails.
4. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   - language inventory section navigation rail.

## Grep These

- `rg -n "<Carousel|CarouselPrevious|CarouselNext" apps/web/src/components`
  audits every production shared-carousel caller and its controls.
- `rg -n "canScrollPrev|canScrollNext|direction" apps/web/src/components/ui/carousel.tsx`
  locates the Embla edge-state and locale-direction contract.
- `rg -n "carousel-(previous|next)" apps/web/src --glob '*test.tsx'` finds
  focused control coverage and caller-specific accessible names.

## What To Build

1. Place desktop carousel arrows over the left and right rail edges.
2. Reveal available arrows on carousel hover and keyboard focus.
3. Hide unavailable directions, including the previous arrow at the initial
   position and the next arrow at the terminal position.
4. Add localized controls to every production use of the shared horizontal
   carousel.
5. Preserve swipe, drag, wheel, keyboard, item ordering, and mobile layouts.
6. Mirror arrow placement and chevron direction for RTL Embla carousels.

## Constraints

- Do not add a dependency, request, runtime event listener, or duplicate
  carousel implementation.
- Preserve the shared viewport clipping, slide spacing, trailing spacer,
  autoplay, drag, wheel, keyboard, and navigation behavior.
- Keep controls out of compact touch layouts below `md`.
- Use each caller's existing localized message namespace for accessible names.
- Derive Embla direction from the same locale identity as the document; do not
  reverse item arrays or infer direction from authored content.

## Verification

- `pnpm --filter @forge/web test -- src/components/ui/__tests__/carousel.test.tsx src/components/watch/__tests__/BibleQuotesSection.test.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/sections/BibleQuotesCarousel.test.tsx src/components/sections/MediaCollection.test.tsx src/components/sections/__tests__/CarouselVideo.test.tsx src/components/watch-language-inventory/LanguageInventoryPage.test.tsx src/components/home/__tests__/WatchHomePage.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Scoped ESLint, Prettier, and `git diff --check`.
- Desktop browser proof for initial, hovered, advanced, and terminal states.
- Compact viewport smoke confirming controls remain hidden and swipe layout is
  unchanged.

## Completion Evidence

- Shared horizontal carousel controls now reveal on desktop hover or keyboard
  focus and hide unavailable directions from Embla's live edge state.
- Every production shared carousel caller renders localized previous and next
  controls.
- Arabic locale coverage verifies that Embla direction, edge placement, and
  chevrons mirror together.
- Focused tests passed: 8 files, 120 tests.
- Full web suite passed: 152 files, 2,425 tests, 2 todo.
- `pnpm --filter @forge/web typecheck` passed.
- Browser smoke passed at 1280px and 390px widths with no console errors or
  document overflow.
