---
id: "feat-252"
title: "Watch header control overlap"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on:
  - "feat-245"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "responsive"
  - "accessibility"
---

## Problem

Production Watch renders a second fixed language control on series pages in
addition to the global floating header. At narrow viewport widths that
series-local control intersects the global account control. Normal video routes
using only the global header remain correctly separated.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SeriesPageClient.tsx` - duplicate fixed
   language button and series language modal state.
2. `apps/web/src/components/watch/SeriesHero.tsx` - static-versus-playable hero
   branch and `HeroPlayer` integration.
3. `apps/web/src/components/watch/HeroPlayer.tsx` - existing global-header
   language event publisher and fullscreen visibility owner.
4. `apps/web/src/components/FloatingSearchProvider.tsx` - global Watch header
   consumer, account control, and search-close state.

## Grep These

- `series-page-language-button`
- `WATCH_HEADER_LANGUAGE_SWITCHER_EVENT`
- `onLanguageClick`
- `playableLanguageCount`
- `floating-header-language-button`

## What To Build

1. Remove the independent fixed series language button.
2. Publish the existing global-header language event for a static series hero.
3. Delegate the callback and language count to `HeroPlayer` for playable
   trailers so fullscreen/chrome visibility still has one publisher.
4. Add focused event-wiring coverage and real-browser geometry assertions with
   screenshot proof.

## Constraints

- Do not change language-code derivation, Watch routing, account auth, player
  controls, or search behavior.
- Do not add JavaScript measurement, a dependency, a fetch, or new client
  controller.
- Keep the logo, safe-area positioning, header motion, and focus behavior.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SeriesPageClient.test.tsx src/components/watch/__tests__/SeriesHero.test.tsx src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at 390px and desktop widths proves positive horizontal
  separation, aligned vertical centers, stable search-open geometry, and
  independent keyboard focus for language and account controls.

## Completion Notes

- Removed the fixed `series-page-language-button` and routed static series
  language switching through the existing global Watch header event.
- Kept playable-trailer ownership inside `HeroPlayer` by passing the language
  callback and playable-language count through `SeriesHero`, preserving its
  fullscreen visibility lifecycle.
- Focused tests passed: 63 assertions across `SeriesPageClient`, `SeriesHero`,
  and `FloatingSearchProvider`; web typecheck and lint passed.
- Browser proof on the reproduced LUMO Matthew series route showed exactly one
  language control and zero obsolete series buttons. At 400 px the language
  and account controls had a 4 px gap and 0 px center delta; at 1440 px they
  had an 8 px gap and 0 px center delta. Search-open retained the 4 px gap,
  the language modal opened from the global control, and both controls accepted
  independent focus with no browser errors.
