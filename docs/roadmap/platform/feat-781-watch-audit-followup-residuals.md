---
id: "feat-781"
title: "Close the remaining Watch website audit follow-ups"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-21"
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "accessibility"
  - "performance"
---

## Problem

The 2026-10-21 follow-up audit
(`docs/reports/2026-10-21-watch-website-audit-followup.md`) left small,
verified residuals that no open PR covers. Each is minor alone. Together
they are the last known gaps on the main Watch templates, and some need a
real browser or device that the audit could not use.

## Entry Points — Read These First

1. `docs/reports/2026-10-21-watch-website-audit-followup.md`, "Remaining
   work": the list this ticket owns.
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` (first-slide fix
   in #2853): the after-hydration random hero swap fades in from black.
3. `apps/web/src/components/useWatchErrorRetry.ts` (added by #2849) and
   `apps/web/src/app/[locale]/[htmlLang]/error.tsx`: retry flag after an
   in-place failure, and the `tabindex="-1"` left on `main`.
4. `apps/web/src/components/FloatingSearchProvider.tsx`: the floating
   search pill overlaps the error heading at 390 px with 200% text.
5. `apps/admin/src/services/watch-search-snippet.ts` (added by #2851): cue
   cleanup misses non-English and markup cues.

## Grep These

`useHasLeftInitialSlide`, `watch-home-media-enter`, `data-watch-error-retry`,
`watchMainContentTargetProps`, `CAPTION_CUE`, `CUE_TRAILERS`.

## What To Build

- Crossfade the post-hydration random hero from the server slide, not from
  black. Keep the first poster at full opacity (feat-780).
- Clear the retry flag when a retry fails in place, and remove the
  temporary `tabindex="-1"` from `main` after focus moves.
- Keep the error heading clear of the floating search pill at 320–390 px
  with 200% text.
- Extend cue cleanup to `[MÚSICA]`, `>>JESUS:` and `<i>[music]</i>` only with
  a closed list and tests that keep real text, as #2851 does.
- When a WebKit build, a real phone or a screen reader becomes available,
  re-run the download, captions and retry journeys there.

## Constraints

- Do not merge or depend on the open audit PRs from this ticket; land each
  item after the PR it builds on.
- Do not change search ranking or time budgets here; budgets are an owner
  decision.
- Do not change download size display (feat-310, #1740).
- Preserve GA, Datadog RUM and recommendation behavior.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch src/components/useWatchErrorRetry`
- `pnpm --filter @forge/admin exec vitest run src/services/watch-search-snippet`
- Real build (`next build` + `next start`), Chromium and Firefox at 320,
  390 and 1280 px, 100% and 200% text: error heading below the search pill;
  home LCP unchanged against `main` (see
  `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`).
