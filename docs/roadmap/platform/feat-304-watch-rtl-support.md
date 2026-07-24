---
id: "feat-304"
title: "Watch RTL layout, carousel, and bidi support"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
completed_date: "2026-07-23"
duration: 3
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "rtl"
  - "accessibility"
  - "i18n"
---

## Problem

Watch routes emit the correct root language and direction, but shared
carousels, content surfaces, mixed-script labels, and custom player controls
still assume left-to-right layout in several places. Arabic and other RTL
viewers can therefore see reversed navigation, misplaced controls, reordered
dynamic text, or media value axes whose visual direction disagrees with their
interaction behavior.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - authoritative root
   language and direction ownership.
2. `apps/web/src/lib/locale.ts` - script-sensitive direction resolution.
3. `apps/web/src/components/ui/carousel.tsx` - shared Embla direction,
   navigation, and control contract.
4. `apps/web/src/components/watch/LanguagePickerModal.tsx` - existing
   first-strong isolation pattern for localized interpolation.
5. `apps/web/src/components/watch/HeroPlayerControls.tsx` - player chrome and
   explicitly LTR media value axes.
6. `docs/plans/2026-07-23-002-fix-watch-rtl-support-plan.md` - requirements,
   implementation units, test matrix, and browser proof contract.

## Grep These

- `textDirectionForLocale`
- `DirectionProvider`
- `CarouselContext`
- `FIRST_STRONG_ISOLATE`
- `HeroPlayerControls`
- `dir="ltr"`

## What To Build

1. Seed one client-safe direction context from the server-resolved root layout.
2. Make shared Watch carousels mirror layout and interaction semantics without
   reversing slide identity, order, or links.
3. Convert reading-order layout to logical inline geometry and isolate
   mixed-script display values at their final rendering boundaries.
4. Keep timeline and volume value axes explicitly LTR while surrounding player
   chrome follows the page direction.
5. Prove representative Arabic inventory and episode journeys at desktop and
   mobile widths, including focus, overflow, hydration, and loading performance.

## Constraints

- Keep the root `html[dir]` contract authoritative; do not introduce another
  locale or direction store.
- Do not import locale catalogs or language maps into client direction
  primitives.
- Do not reverse carousel data, route identity, links, chronological timelines,
  or magnitude axes.
- Keep bidi isolation display-only; raw identity, route, search, analytics,
  persistence, and filename values must remain unchanged.
- Preserve intentional physical media crop positions and overlay corners unless
  they encode reading order.

## Verification

- Focused root-layout, direction-provider, bidi, carousel, Watch surface, and
  player-control tests in both LTR and RTL branches.
- Web typecheck, lint, format, and build.
- Chromium desktop, Chromium mobile, and WebKit mobile browser proof on
  representative Arabic routes.
- Confirm no hydration warnings, horizontal document overflow, direction-driven
  layout shifts, duplicate carousel initialization, or greater than 10% median
  LCP regression in the same local environment.
