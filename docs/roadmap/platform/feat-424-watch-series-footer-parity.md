---
id: "feat-424"
title: "Watch series footer parity"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-08-26"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "i18n"
  - "performance"
---

## Problem

Resolved two-segment Watch collection and series pages end after the series
surface without the shared ministry footer. Video and contextual episode pages
already include that terminal navigation, giving, contact, legal, and
AI-attribution surface.

Implementation contract:
[`docs/plans/2026-08-26-0852-fix-watch-series-footer-plan.md`](../../plans/2026-08-26-0852-fix-watch-series-footer-plan.md).

## Entry Points — Read These First

1. `docs/plans/2026-08-26-0852-fix-watch-series-footer-plan.md` — product,
   implementation, and verification contract.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — server route
   composition for series, video, and contextual episode surfaces.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   — route-family composition regressions.
4. `apps/web/src/components/home/WatchHomeFooter.tsx` — unchanged shared footer
   and lazy logo asset.
5. `docs/solutions/ui-bugs/watch-footer-sticky-player-layering.md` and
   `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — layering and page-load verification constraints.

## Grep These

- `routeModel.kind === "series"`
- `SeriesPageClient`
- `WatchHomeFooter`
- `watch-home-footer`
- `NEXT_NOT_FOUND`

## What To Build

1. Append the existing `WatchHomeFooter` after `SeriesPageClient` in the
   server-rendered series route branch.
2. Cover both collection-labeled and series-labeled route models with exactly
   one footer ordered after the series surface.
3. Preserve the existing single-footer behavior for video and contextual
   episode routes and the footer-free not-found exit.
4. Keep `SeriesPageClient`, the footer component, client boundaries, locale
   behavior, copy, links, styling, and stacking unchanged.

## Constraints

- Do not move the footer into `SeriesPageClient` or another client bundle.
- Do not add the footer to one-segment, authored experience, inventory,
  history, embed, or not-found surfaces.
- Do not change footer content, translations, styling, or generated GraphQL
  artifacts.
- Account for the existing lazy footer-logo request in page-load comparisons;
  add no client JavaScript, hydration work, above-the-fold media, or eager
  loading.

## Verification

- `pnpm --filter @forge/web test -- 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`
- `pnpm --filter @forge/web test -- src/components/home/__tests__/WatchHomeFooter.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm exec prettier --check 'apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx' 'apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' 'docs/roadmap/platform/feat-424-watch-series-footer-parity.md'`
- Verify rendered series HTML contains one series surface followed by one
  footer, then compare scripts, hydration warnings, eager resources, and
  footer-owned requests against the unchanged baseline.
