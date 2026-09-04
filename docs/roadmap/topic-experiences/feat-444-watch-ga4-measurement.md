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
- Respect consent and avoid user/content identifiers that create PII risk.
- Avoid duplicate events during redirects, hydration, and client navigation.

## Verification

- Tests cover event names, parameters, firing rules, and deduplication.
- GA4 DebugView/Realtime validates representative canonical/localized journeys.
- A monitoring query/dashboard reconciles legacy and canonical traffic.
