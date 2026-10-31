---
id: "feat-765"
title: "Keep the Watch series header and language picker readable on tablets and phones held sideways"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
---

## Problem

Round-04 design + mobile audit, production `/watch/lumo-the-gospel-of-john.html`,
2026-10-20, headless Chromium viewport emulation:

- **768x1024 (tablet portrait).** The hero's title and action pills sit side
  by side from `md`. The pills do not shrink, so the title gets about 266 px
  and wraps to four lines. The meta grid uses `md:grid-cols-4`, which leaves
  the Languages picker a 130 px column; it shows "English" as "E".
- **844x390 (phone landscape).** The same side-by-side band uses
  `md:text-5xl` with no `compact-landscape:` sizing. The title climbs to
  y=11, under the fixed header that ends at y=60, so "LUMO - The" is hidden
  on arrival. The picker shows "E…".

Desktop (1280) and phone portrait (390) are fine.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SeriesPageClient.tsx` — `series-page-hero-overlay`,
   `series-page-hero-content-row`, `series-page-meta-content`.
2. `apps/web/src/components/watch/WatchHeroOverlay.tsx` — `WATCH_HERO_TITLE_CLASS`,
   which already carries `compact-landscape:` sizing for the film/episode hero.
3. `apps/web/src/app/globals.css` — `@custom-variant compact-landscape`.

## Grep These

- `series-page-hero-content-row`
- `md:grid-cols-4`
- `compact-landscape:`

## What To Build

- Title and pills side by side only from `lg`, and in `compact-landscape`
  (phone held sideways), where the title is `text-2xl` and the overlay
  padding is smaller. Tablets stack the title above the pills.
- Meta grid `md:grid-cols-3 lg:grid-cols-4`, with the description
  `md:col-span-2 lg:col-span-3`.

## Constraints

- No change at `lg+` or on phones in portrait.
- Use the existing `compact-landscape` variant; no new breakpoints.

## Verification

- `vitest run src/components/watch/__tests__/SeriesPageClient.test.tsx`
- A local fixture renders the real `SeriesPageClient`. Before and after on
  the same fixture, measured with Playwright:

  | Viewport | Before                                                   | After                                        |
  | -------- | -------------------------------------------------------- | -------------------------------------------- |
  | 768x1024 | title 4 lines / 266 px; picker 130 px, "English" clipped | 2 lines / 640 px; picker 187 px, not clipped |
  | 844x390  | title top 11 < header bottom 60; picker clipped          | title top 115; picker 212 px, not clipped    |
  | 1280x800 | unchanged                                                | unchanged                                    |
  | 390x844  | unchanged                                                | unchanged                                    |

## Resolution (2026-10-20)

Built as above in `fix/watch-series-tablet-landscape`.
