---
id: "feat-444"
title: "Normalize Watch GA4 measurement"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-28"
duration: 5
depends_on: []
blocks:
  - "feat-456"
  - "feat-643"
tags:
  - "web"
  - "watch"
  - "analytics"
  - "observability"
---

## Problem

GA4 splits the main JESUS experience between canonical and compatibility URLs.
Across `/watch/`, views/user and engagement are well below the property average,
but current key-event coverage cannot distinguish weak behavior from missing
instrumentation. Linear: FGE-115.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — compatibility/canonical navigation behavior.
2. `apps/web/src/components/watch/WatchPageClient.tsx` — client journey orchestration.
3. `apps/web/src/components/watch/HeroPlayer.tsx` — video interaction events.
4. `apps/web/src/components/watch/WatchBody.tsx` — primary actions and page composition.

## Grep These

- `gtag`
- `dataLayer`
- `analytics`
- `page_view`
- `timeupdate`
- `ended`

## What To Build

Define canonical page/event identity, audit page-view and meaningful Watch
events, and produce a PR-ready instrumentation contract for play, progress,
search, language, download, share, and CTA outcomes.

## Constraints

- Preserve raw-path diagnostics while adding canonical dimensions.
- Follow `docs/analytics-and-recommendation-policy.md`: configured analytics require no consent prerequisite. Preserve the GA page views, navigation, Watch events, and Datadog RUM restored in PR #2229 throughout migration and rollback.
- Avoid user/content identifiers that create PII risk.
- Avoid duplicate events during redirects, hydration, and client navigation.

## Verification

- Tests cover event names, parameters, firing rules, and deduplication.
- GA4 DebugView/Realtime validates representative canonical/localized journeys.
- A monitoring query/dashboard reconciles legacy and canonical traffic.

## Progress

- 2026-09-12: U1–U3 landed in
  [PR #2273](https://github.com/JesusFilm/forge/pull/2273) — search-click GA
  leak fixed, route resolver, typed contract, explicit page views behind
  `NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2` (default off).
- 2026-10-08: U4 (player), U5 (search, language, subtitle, download, share,
  and study-CTA outcomes), and the U6 read-only reconciliation query
  (`queryWatchMeasurementReconciliation`) implemented behind the same flag.
  v2 SPA page views now take the previous Watch page as referrer.
- Remaining, all operator-side: the property export, privacy audit,
  custom-dimension registration, Enhanced Measurement change, DebugView
  journeys, enablement, the 7-day and 28-day readouts, and the key-event
  decision. Runbook: `docs/operations/watch-ga4-measurement.md` sections 3,
  4, and 6. Close this ticket only after the 28-day classification.
