---
id: "feat-263"
title: "Watch mobile horizontal rubber-band containment"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mobile"
  - "carousel"
---

## Problem

The Watch sibling carousel exposes its full off-screen Embla track below the
`md` breakpoint. Mobile browsers can elastically pan that hidden width, making
the page body move horizontally beneath the fixed header even though the page
does not actually scroll sideways.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` - Watch chapter rail
   and the mobile-visible viewport override.
2. `apps/web/src/components/ui/carousel.tsx` - shared clipped carousel viewport
   contract.
3. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` - Watch
   chapter layout and interaction coverage.
4. `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`
   - established bleed, alignment, and drag behavior.

## Grep These

- `viewportClassName="overflow-x-visible md:overflow-x-clip"`
- `data-slot="carousel-content"`
- `overflow-x-clip overflow-y-visible`

## What To Build

1. Restore horizontal clipping on the Watch sibling-carousel viewport at
   mobile widths.
2. Preserve Embla drag/navigation, edge alignment, card sizing, and desktop
   behavior.
3. Add focused regression coverage and prove page geometry in Mobile Safari.

## Constraints

- Do not add global touch or overscroll suppression.
- Do not change the shared carousel primitive or Watch home carousel.
- Do not change carousel bleed spacing or responsive card widths.

## Verification

- Focused SiblingCarousel and shared CarouselContent tests pass.
- Web typecheck, lint/format checks, and `git diff --check` pass.
- On `/watch/jesus.html/english.html` in Mobile Safari, the document stays at
  viewport width and a horizontal gesture outside the rail does not move the
  page while a swipe inside the rail still advances it.

## Completion Notes

- Restored the shared clipped carousel viewport on Watch chapter pages without
  changing responsive rail geometry or the shared primitive.
- Added a focused regression assertion; the two relevant suites pass 32 tests.
- The production Web build completed successfully.
- Phone-width browser geometry measured the document and body at 375 px. An
  outside drag left the page fixed, while an inside drag moved the Embla rail by
  about 178 px with page `scrollX` still at zero.
- Direct Mobile Safari proof was attempted, but CoreSimulatorService remained
  unable to enumerate devices after the Simulator app was restarted. The same
  interaction should be repeated when simulator service access is restored.
