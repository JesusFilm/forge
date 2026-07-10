---
id: "feat-175"
title: "Watch Mobile Portrait Hero Preview"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
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

Mobile portrait watch pages currently render the muted hero preview as a short 16:9 strip under the floating header. The logo, search, and language controls sit over the video image, making the header visually busy and making the preview feel too small vertically.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` - sticky hero wrapper, muted preview state, MuxPlayer/MuxVideo branches, preview overlays, and post-click chrome reveal.
2. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - focused jsdom coverage for hero layout classes and reveal behavior.
3. `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md` - current sticky hero and measured episode rail overlap decisions.

## Grep These

- `hero-player-wrapper`
- `hero-player-muted-backdrop`
- `scale-y-110`
- `HERO_FRAME_HEIGHT_CLASS`
- `chromeRevealed`

## What To Build

1. Add a preview-only mobile portrait black header band above the muted media frame.
2. Make the muted preview media frame square and fill/cover on mobile portrait.
3. Keep post-click playback on the existing 16:9 hero behavior with custom chrome unchanged.
4. Keep desktop, tablet, custom overlay, search/language header, and subtitle overlay behavior unchanged.
5. Move preview-only absolute layers into the media frame so they cannot cover the black band.

## Constraints

- Do not change playback controls, fullscreen behavior, subtitles, language switching, or data fetching.
- Do not change desktop or tablet hero sizing.
- Do not affect custom overlay consumers such as series hero pages.
- Do not hand-edit generated GraphQL or locale artifacts for this slice.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web lint`
- Browser smoke at `390x778` on `/watch/blessed-are-those-who-hear-and-obey.html/english.html`: header band is 96px tall, media frame starts at `y=96`, media frame height equals width, header controls sit on black, and Watch now reveal returns to the existing 16:9 playback frame.
