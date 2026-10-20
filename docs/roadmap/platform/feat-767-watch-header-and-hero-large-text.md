---
id: "feat-767"
title: "Keep the Watch header and home hero usable at 200% text size"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-21"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "accessibility"
  - "ui"
---

## Problem

Round-04 audit, production `/watch`, 2026-10-20. The page was checked at
390x844 with the root font-size set to 200%, which stands in for large
text settings because the UI sizes in `rem`. There was no horizontal
overflow, but on the home page:

- The header search pill shrinks to its icon and that icon overlaps the
  language globe.
- The hero title breaks mid-word ("Samarita/n") and climbs under the
  header.
- The hero primary action shows only its play icon. With PR #2829's
  wrapping row (local fixture, real carousel, 390x844 at 200%) it reads
  "Watch N…" (166/189 px). The title still climbs under the header there:
  the overlay outgrows the fixed-height muted hero frame
  (`WATCH_MUTED_INTRO_HEIGHT_CLASS` / `useWatchHomeHeroFittedHeight`), so
  the frame or overlay has to account for the overlay's real height.
- The feedback intro pill covers body copy.

Other templates (film, series, episode, languages) reflowed. Their long
titles end in an ellipsis.

Evidence: `round-04/text200/text200-_watch.png` in the audit user-data.

## Entry Points — Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` — header layout
   (`FLOATING_HEADER_LAYOUT_CLASS`, logo slot, field width).
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — overlay title.
3. `apps/web/src/components/watch/WatchHeroOverlay.tsx` — `WATCH_HERO_TITLE_CLASS`
   (`break-words`).

## Grep These

- `FLOATING_HEADER_LAYOUT_CLASS`
- `break-words`
- `text-balance`

## What To Build

- Header controls must not overlap at large text: let the grid drop the
  label, then the wordmark, before any control overlaps.
- Hero titles hyphenate or wrap at word boundaries (`hyphens-auto` with
  `lang`, or `overflow-wrap: break-word` only as a last resort). The overlay
  must stay below the header.

## Constraints

- Do not change the home wordmark at default text size.
- No new catalog keys unless they go through the locale workflow.

## Verification

- A Playwright check at 390x844 with root `font-size: 200%`. Header controls'
  rects do not intersect, and the hero title's top is below the header's
  bottom.
- Real Android large-font and iOS Larger Text spot check.
