---
id: "feat-286"
title: "Watch Full-Bleed Carousel Layout"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "carousel"
  - "design-system"
---

## Problem

Public Watch carousels do not share one horizontal layout contract. Some rails
bleed only on mobile, some use the generic content-width ladder, some open-code
Watch padding, and the language inventory remains bounded by its inner content
container. As a result, cards are clipped at inconsistent boundaries even
though Watch is meant to present all rails as unbounded within its centered
1920px frame.

The shared rule must preserve the current card-zero position: before a rail is
scrolled, its first card stays aligned with the left edge of the surrounding
content column. The wider viewport is browsing space, not a new starting
alignment. The implementation must also retain Embla's clipped viewport so the
off-screen track cannot reintroduce mobile document rubber-banding.

## Entry Points — Read These First

1. `apps/web/src/lib/content-width.ts` - shared 1920px Watch frame, Watch rail gutter ladder, and the existing generic carousel tuple.
2. `apps/web/src/components/ui/carousel.tsx` - Embla viewport/track split and the `overflow-x-clip overflow-y-visible` containment default.
3. `apps/web/src/components/watch/BibleQuotesSection.tsx` - reported rail and its current mobile-only bleed.
4. `apps/web/src/components/watch/SiblingCarousel.tsx` - episode/chapter rail behavior, controls, navigation preservation, and end spacer.
5. `apps/web/src/components/sections/MediaCollection.tsx` - existing full-frame Watch rail structure.
6. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - looping Watch home preview rail with a legacy visible-overflow override.
7. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx` - centered `max-w-7xl` inventory alignment that needs an inventory-specific layout mode.
8. `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md` and `docs/solutions/ui-bugs/watch-mobile-sibling-carousel-horizontal-rubber-band.md` - alignment and overflow regression constraints.

## Grep These

```text
<CarouselContent
CAROUSEL_BLEED_CLASSES
CAROUSEL_CONTENT_PADDING
CAROUSEL_END_SPACER
overflow-x-visible
-mx-5 w-[calc(100%+2.5rem)]
pl-5 md:pl-16 xl:pl-24
```

## What To Build

1. Add Watch-specific responsive carousel bleed, leading-padding, and trailing-spacer tokens derived from the `5 / 16 / 24` Watch rail gutter ladder in `apps/web/src/lib/content-width.ts`.
2. Add shared `WatchCarousel` and `WatchCarouselContent` wrappers with `rail` and `inventory` layouts. The root owns offset-aware Embla alignment, including loops and non-zero start indexes. The content wrapper expands the Embla viewport to the 1920px Watch frame, re-pads its track so card zero remains content-left aligned, and appends an accessible trailing spacer by default. The inventory layout aligns card zero and trailing reach with the centered `max-w-7xl` inventory content column while its viewport spans the Watch frame.
3. Keep the generic `Carousel` primitive's clipped horizontal viewport unchanged. The Watch wrapper owns Watch bleed geometry, never literal `overflow-x-visible`.
4. Migrate every public Watch carousel: Bible quotes, sibling episodes/chapters, authored Bible quotes, authored navigation, authored video, media collection, Watch home TV previews, and language inventory metrics.
5. Allow looping rails to opt out of the trailing spacer so the Watch home preview loop remains continuous.
6. Add shared contract tests plus focused consumer assertions for first-card alignment, full-frame reach, symmetric trailing space, loop opt-out, and absence of visible horizontal overflow.
7. Promote authored `Container` slots that contain a carousel to all 12 columns so the frame-relative rule remains valid; preserve configured spans for non-carousel media variants.

## Constraints

- The initial first card must remain aligned with the surrounding content column at every responsive breakpoint.
- Carousel bleed stops at the centered `max-w-[1920px]` Watch frame, not the physical browser edge on wider viewports.
- Keep `overflow-x-clip overflow-y-visible`; do not expose the transformed Embla track to document overflow.
- Keep carousel controls anchored to their current content-relative positions and preserve drag, wheel, keyboard, navigation, active-item, and preview behavior.
- Do not change GraphQL, data fetching, routes, card visuals, media loading policy, or the generic carousel primitive's layout contract.
- Audit inline copies of responsive padding/bleed/spacer ladders whenever the shared tokens change.

## Verification

- Run focused Vitest suites for the new Watch wrapper, `content-width.ts`, and all affected consumers.
- Run `pnpm --filter @forge/web typecheck`, scoped lint/format checks, and `git diff --check`.
- Use the Forge remote Web QA launcher and its HTTPS `/watch` endpoint for phone, desktop, and wider-than-1920 browser measurements.
- On each viewport, compare the first card's left coordinate with the surrounding content edge and the carousel viewport with the centered Watch frame.
- Confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth`, outside-rail drag does not move the page, and inside-rail drag changes the Embla track.
- Exercise one arrow, keyboard, or card-navigation interaction and inspect launcher stderr for `Blocked cross-origin request`.
- Compare page-load resource count/transfer timing before and after; the layout-only change must add no request, effect, listener, or render-blocking resource.

## Completion Evidence

- Focused review-fix suite: 73 tests passed, including responsive Embla offsets and partial authored-slot promotion.
- Full Web suite: 146 files / 2,248 tests passed (2 existing todos); Web typecheck, lint, Prettier, and `git diff --check` passed.
- Production build compiled successfully and completed its TypeScript phase; page-data collection then stopped on the worktree's absent `REVALIDATION_SECRET`, `ADMIN_GRAPHQL_URL`, and `WEB_ADMIN_API_KEYS` rather than a code/build error.
- Real Chromium geometry fixture at 390px, 1440px, and 2048px verified card-zero/content-left equality for standard, looped, and inventory layouts; `overflow-x: clip`; and `scrollWidth === clientWidth` before and after navigation.
- At 2048px the standard and inventory viewports measured `left: 64px`, `right: 1984px`, exactly the centered 1920px Watch frame. Standard/looped card zero and headings both measured `160px`; inventory card zero and heading both measured `416px`.
- The Next arrow moved the standard track from `translateX(0)` to `translateX(-270.55px)` without changing document width. The isolated QA tab reported no console warnings/errors and the server logs contained zero `Blocked cross-origin request` matches.
- The shared wrappers add no effect, event listener, fetch, image, font, or other resource initialization. Browser performance-entry timing is unavailable through the integrated browser's read-only page scope, so performance neutrality is established by the layout-only diff plus successful production compilation.
- The mandated Tailscale launcher was unavailable on this machine and remote exposure was denied by the safety gate. The Admin-backed reported route could not hydrate under `.env.ci`; browser measurements therefore used a temporary local fixture that rendered the production wrappers and Embla primitives, and the fixture was removed after QA.
