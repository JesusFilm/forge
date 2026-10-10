---
id: "feat-653"
title: "Verify My Last Day and Mostly Tea Watch availability"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on:
  - "feat-649"
blocks: []
tags:
  - "web"
  - "watch-page"
  - "feedback"
---

## Problem

Two high-severity reports say My Last Day and Mostly Tea cannot be opened or
played. Production currently serves My Last Day, while the Conversation
Starters card for Mostly Tea renders without a link. The catalog's canonical
Mostly Tea slug is `çoğu-çay-mostly-tea`, which is admitted by the Unicode route
support in `feat-649`.

## Entry Points — Read These First

1. `apps/web/src/components/watch/__tests__/SeriesEpisodeCard.test.tsx` —
   collection episode card href behavior.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx` —
   direct catch-all route resolution and playable video rendering.
3. `apps/web/src/components/search/VideoCard.test.tsx` — canonical search result
   href mapping.
4. `docs/recommendations/curation/2026-09-10/pg-catalog-videos.csv` —
   source snapshot for canonical slugs and published variant counts.

## Grep These

- `my-last-day`
- `çoğu-çay-mostly-tea`
- `defaultHrefBuilder`
- `WatchPageClient`

## What To Build

1. Add direct-route and collection-card regressions for `my-last-day` and
   `çoğu-çay-mostly-tea`, preserving the canonical published slug.
2. Add search href regressions proving each title resolves to its
   content-specific Watch route.
3. Verify the route page passes the selected published English variant to the
   player client. This fixture validates data flow, not live production playback.

## Constraints

- Depend on `feat-649` for lowercase Latin Unicode route support; do not copy
  its validator, proxy, or page-routing implementation into this ticket.
- Keep invalid or unadmitted source records suppressed.
- Treat catalog snapshots as evidence of published source variants, not as a
  substitute for a live playback acceptance check.

## Verification

- Focused card, page-routing, and search href regression tests for both
  reported titles.
- Web typecheck, scoped lint and format checks, and diff check.
- Recheck the canonical production URLs and playback when the route-support
  dependency is available in production.

## Production validation — 2026-10-10 UTC

- T3 collaborative browser verified the canonical
  `https://www.jesusfilm.org/watch/my-last-day.html` page renders My Last Day.
  English playback started, with `readyState=4`, `paused=false`, no media error,
  and `currentTime` advancing from 42.68 to 57.90 seconds. This part of the
  historical report is not reproducible now.
- The exact Mostly Tea catalog slug is `çoğu-çay-mostly-tea` (Core ID
  `2_0-MostlyTea`, Admin video ID `cmp788a2505m6qm016vbgw620`). Opening
  `https://www.jesusfilm.org/watch/%C3%A7o%C4%9Fu-%C3%A7ay-mostly-tea.html`
  still renders the native 404 page. The catalog's two published media languages
  do not establish playback availability through the current production route.
- Keep this ticket in progress and PR #2667 in draft until #2662 reaches
  production and Mostly Tea can be verified end to end. No production deployment
  was performed during validation.
