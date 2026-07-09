---
id: "feat-244"
title: "Restore Watch header Lumberman baseline"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "mobile"
  - "video"
---

## Problem

The Watch page mobile portrait header should match the Lumberman-authored
baseline that existed on June 20, 2026: logo, search, and language controls on
a black header band above the square muted media preview. Later non-Lumberman
Watch header design changes removed that band and encoded the new behavior in
tests.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` - mobile portrait preview
   wrapper classes, header-band rendering, media-frame classes, and playback
   reveal behavior.
2. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - mobile
   portrait preview, header-band, media-frame, and reveal assertions.
3. `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md` -
   completed June 20 baseline contract.

## Grep These

- `MOBILE_PORTRAIT_PREVIEW_WRAPPER_CLASS`
- `MOBILE_PORTRAIT_PREVIEW_BAND_CLASS`
- `hero-player-mobile-header-band`
- `data-mobile-portrait-preview`
- `h-[100vw]`

## What To Build

1. Restore the mobile portrait black header band from the June 20 baseline.
2. Restore the mobile portrait square media-frame classes from that baseline.
3. Keep later non-header playback behavior intact unless it directly conflicts
   with the header band.
4. Update tests that currently expect the no-band design so they protect the
   restored baseline.

## Constraints

- Do not revert Watch home, progress/history, subtitles, downloads, Watch Next,
  or GraphQL behavior unless it directly altered the Watch page header design.
- Do not change desktop, tablet, or custom overlay hero behavior.
- Do not hand-edit generated GraphQL or locale artifacts.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- Focused lint or typecheck for touched Web files.
- Browser smoke at mobile portrait dimensions on a representative Watch page:
  the header controls sit on a black band above the square media preview before
  playback reveal.
