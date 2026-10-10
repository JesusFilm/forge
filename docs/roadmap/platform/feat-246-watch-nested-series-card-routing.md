---
id: "feat-246"
title: "Watch nested-series card routing"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-11"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
---

## Problem

A Watch series can contain another series or collection. `SeriesEpisodeCard`
treats every child as a playable episode and emits a three-segment contextual
URL. The route manifest correctly rejects nested series nodes because they do
not have a playable Dub, leaving a linked card that returns an empty 404.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SeriesEpisodeCard.tsx` - selects the public
   href for each series child card.
2. `apps/web/src/lib/content.ts` - defines the existing label-first
   `isSeriesRecord` discriminator.
3. `apps/web/src/lib/routes.ts` - owns two-segment standalone and
   three-segment contextual Watch URL builders.
4. `apps/web/src/components/watch/__tests__/SeriesEpisodeCard.test.tsx` -
   focused card-routing regression coverage.

## Grep These

- `SeriesEpisodeCard`
- `isSeriesRecord`
- `watchEpisodePath`
- `watchVideoPath`
- `lumo-the-gospel-of-matthew`

## What To Build

1. Make the label-first series/collection discriminator safe for both server
   data resolution and client card rendering without importing the server data
   layer into a client component.
2. Route child records labeled `collection` or `series` to their standalone
   two-segment Watch URL using the selected audio-language slug.
3. Preserve the three-segment contextual route for every non-series child.
4. Add regressions for the LUMO nested collection URL, uppercase Admin labels,
   malformed parent slugs, and normal episode contextual navigation.

## Constraints

- Do not alter Admin GraphQL fields, generated types, the route manifest, or
  the catch-all Watch resolver.
- Do not change the public contextual episode URL contract.
- Do not expose internal locale keys in public Watch URLs.

## Verification

- `pnpm --filter @forge/web test -- src/lib/__tests__/content-series.test.ts src/components/watch/__tests__/SeriesEpisodeCard.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke confirms the LUMO card opens
  `/watch/lumo-the-gospel-of-matthew.html/russian.html` and ordinary episode
  cards retain contextual URLs.
