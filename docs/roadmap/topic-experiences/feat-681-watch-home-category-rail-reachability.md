---
id: "feat-681"
title: "Make every Watch home category reachable"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks:
  - "feat-684"
tags: [web, watch, accessibility, i18n]
---

## Problem

The Watch home category carousel clipped cards on mobile until Embla hydrated and
did not expose all categories at rest on desktop (Linear FGE-229 / W-094). The
first native-scroll rewrite then shipped three defects of its own, found by
rendering PR head `660ca4866` in a real Next production build:

1. The list-item wrapper was `min-w-0` with no `shrink-0`, so it collapsed to
   ~12px while its 190px link overflowed. All cards painted on top of each other
   and `scrollWidth` fell to 548/860/1305px at 390/768/1280 (about 2,700 expected).
2. No `scroll-padding`, so mandatory snapping pulled rest `scrollLeft` to
   20/64/25px and the first card sat flush with the viewport edge.
3. Both arrows were always present, `pointer-events: auto`, and computed
   white-on-white once styled; a spent arrow stayed clickable.

## Entry Points

1. `apps/web/src/components/home/WatchHomeCategoryRail.tsx`
2. `apps/web/src/components/home/__tests__/WatchHomeCategoryRail.test.tsx`
3. `apps/web/messages/en.json` (`WatchHomeCategories.previous` / `.next`)
4. `apps/web/scripts/ui-translation-policy.json` (`pendingTranslationPaths`)

## What To Build

Native `overflow-x-auto snap-x snap-mandatory` scroller (swipeable before
hydration), a two-row seven-column grid from 1440px, the list-item wrapper owning
the card width with `shrink-0`, `scroll-px-*` mirroring `px-*`, and state-aware
logical arrows (fine pointer, `md` and up, only in a direction that can still
scroll) with start/end edge fades. No scroller tab stop. Arrow focus is handed to
the opposite arrow only when the arrow that actually holds focus is spent.

## Constraints

- Arrow labels are NEW catalog keys carried as English source fallback in all
  225 catalogs and listed in `pendingTranslationPaths`. Do not claim them
  translated; the translation is feat-684.
- Fine-pointer arrows still sit over the partially clipped edge card; touch
  never shows arrows. Do not claim zero overlay.

## Verification

Focused Web tests, typecheck, lint, `check:provisional-ui-catalogs`, and a real
Next production build measured at 390/768/1280/1440 (including RTL via `dir` on
the real page and an alternating before/after page-load comparison).
