---
id: "feat-767"
title: "Keep the Watch header and home hero usable at 200% text size"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-20"
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

## Progress (2026-10-20)

**Header: done in PR fix/watch-large-text-header-hero.** The header is a
size container. When it is narrower than 17rem, the search field moves to
its own full-width row, and the home wordmark shrinks to the sign's width.
That only happens with enlarged text: a 320 px phone at default text is
17.5rem. Local `next dev`, root `font-size` override, `/watch` and
`/watch/whats-new`:

| Text | 320                 | 390            | 768            | 1024    |
| ---- | ------------------- | -------------- | -------------- | ------- |
| 100% | one row, no overlap | one row        | one row        | one row |
| 150% | field on row 2      | field on row 2 | one row        | one row |
| 200% | field on row 2      | field on row 2 | field on row 2 | one row |

Before the change: at 200%, the search pill overlapped the language
button at 320 and 390. At 320 on home, the language button was partly off
screen. At 768, the field was squeezed to 0 px. After: no overlapping
controls and none off screen in any cell.

**Home hero: in PR #2829** (same component as its CTA wrap). Mark this
ticket complete once both are merged.

Not checked: real Android large-font and iOS Larger Text. The root
`font-size` override does not move `md:` media breakpoints the way a
browser default-font setting does.
