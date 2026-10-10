---
id: "feat-264"
title: "Watch mobile landscape hero layout"
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
  - "responsive-ui"
---

## Problem

The individual Watch video page is unusable in mobile Safari landscape. A
wide but short visual viewport activates desktop header spacing and hero
typography, so the title is clipped behind the unified floating header while
the Watch, Share, and metadata controls overflow the available hero height.

## Entry Points - Read These First

1. `docs/plans/2026-07-16-001-fix-watch-mobile-landscape-hero-layout-plan.md`
   - implementation plan and compact-height acceptance contract.
2. `apps/web/src/components/watch/HeroPlayer.tsx`
   - pre-reveal title, action row, metadata tags, and viewport-capped hero.
3. `apps/web/src/components/FloatingSearchProvider.tsx`
   - unified fixed header and backdrop over the hero.
4. `apps/web/src/lib/content-width.ts`
   - shared header top, height, gap, and Watch rail classes.
5. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
   - focused hero layout and lifecycle coverage.
6. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
   - unified header class contract.

## Grep These

- `hero-player-overlay`
- `hero-player-metadata-tags`
- `floating-header`
- `FLOATING_HEADER_TOP_CLASS`
- `orientation:landscape`
- `max-height`

## What To Build

1. Add a CSS-owned compact landscape contract keyed by short viewport height,
   rather than treating every wide viewport as desktop.
2. Reduce the unified header's vertical offset and backdrop footprint in that
   compact mode while retaining safe-area positioning.
3. Compact the pre-reveal hero title, spacing, actions, and metadata so the
   entire interactive overlay fits below the header and inside the hero.
4. Preserve portrait preview sizing, normal desktop and tablet landscape,
   custom overlays, and revealed player chrome.
5. Add focused class-contract tests and verify the supplied failure shape in
   real Mobile Safari landscape with a screenshot.
6. Let the compact-landscape video consume the full small viewport height,
   keep the episode carousel after the hero, and let unusually long titles
   grow the overlay flow container instead of escaping beneath the header.

## Constraints

- Keep `100svh`; do not regress iOS visible-viewport handling to `100vh`.
- Keep preview/body overlap measurement-driven outside the default compact-
  landscape pre-reveal state, where the carousel must follow the full hero.
- Do not add JavaScript viewport or orientation state for styling.
- Do not change playback, subtitles, language selection, sharing behavior, or
  generated GraphQL and locale artifacts.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at an 844x390 landscape viewport and the supplied compact
  Safari shape: header, title, actions, and metadata do not intersect or clip;
  Watch, Share, and language controls remain usable; portrait and revealed
  playback remain unchanged.
