---
id: "feat-456"
title: "Emit consent-approved Watch page-not-found telemetry"
owner: "codex"
priority: "P1"
status: "not-started"
start_date: null
completed_date: null
duration: 2
depends_on:
  - "feat-444"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "analytics"
---

## Problem

The Watch route alert monitor can launch with its locale-independent heuristic,
but it cannot switch to its preferred GA4 source until Web emits a dedicated,
consent-approved `page_not_found` event with a stable query-free route contract.
The existing Watch GA4 measurement ticket does not explicitly own that event.

## Entry Points — Read These First

1. `docs/roadmap/topic-experiences/feat-444-watch-ga4-measurement.md`
2. `docs/plans/2026-08-28-2331-fix-watch-ga4-measurement-plan.md`
3. `apps/web/src/components/GoogleAnalytics.tsx`
4. `apps/web/src/app/[locale]/[htmlLang]/404/page.tsx`
5. `docs/plans/2026-09-04-1506-feat-watch-route-alerts-plan.md`

## What To Build

1. After the consent decision in `feat-444`, emit one deduplicated
   `page_not_found` event for committed Watch not-found renders.
2. Include only the normalized query-free Watch pathname and the bounded route
   classification needed by the monitor; do not include title, query, referrer,
   user input, or identifiers.
3. Verify event coverage across localized 404 pages, initial loads, and client
   navigations. Any future removal of the heuristic lane requires a separate
   measured decision after at least one full comparison window.

## Constraints

- Do not bypass consent or enable analytics before `feat-444` is approved.
- Do not use localized page titles as the event discriminator.
- Do not change route behavior, canonicals, sitemap output, or 404 rendering.

## Verification

- Pending implementation.
