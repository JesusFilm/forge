---
id: "feat-253"
title: "Watch collection overview bounded sticky scroll"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on:
  - "feat-192"
blocks: []
tags:
  - "web"
  - "watch"
  - "content-discovery"
  - "ux"
---

## Problem

The `/watch/videos` language inventory groups a collection overview beside a
much taller list of videos. The overview currently stretches with the grid row
and scrolls away, so viewers lose the collection artwork, title, CTA, and
description while scanning later videos in the same group.

## Entry Points - Read These First

1. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   - `CollectionGroupOverview` and `GroupedVideoListSection` own the collection
     overview and two-column group layout.
2. `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx`
   - localized inventory route fixture and server-rendered markup assertions.
3. `apps/web/src/components/FloatingSearchProvider.tsx` - fixed Watch header
   height and desktop positioning that the sticky top offset must clear.

## Grep These

- `CollectionGroupOverview|GroupedVideoListSection|lg:grid-cols` in
  `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`.
- `sticky|overflow-hidden|overflow-clip|self-start` in `apps/web/src`.
- `language-inventory-audio-collections` in the localized videos route tests.

## What To Build

1. At the existing desktop two-column breakpoint, keep the full collection
   overview sticky beside its video rows.
2. Keep the sidebar background and divider stretched to the full collection
   height while a nested sticky overview remains bounded by that group.
3. Preserve the existing single-column mobile flow, visual clipping, content,
   routes, and ordering.
4. Add a focused rendered-markup regression test for the responsive sticky and
   containment classes.
5. Browser-smoke the start, middle, and end of a populated group at desktop
   width and the same group at mobile width.

## Constraints

- Do not change inventory queries, grouping, sorting, translations, or routes.
- Do not add JavaScript scroll listeners, observers, or a client-component
  boundary; this is a CSS layout correction.
- Do not change the global Watch header or unrelated sticky hero behavior.
- Preserve page-loading performance by keeping the server-rendered component
  and existing asset behavior unchanged.

## Verification

- `pnpm --filter @forge/web exec vitest run src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx`
- `pnpm --filter @forge/web exec tsc --noEmit --pretty false`
- `pnpm --filter @forge/web lint`
- Desktop browser screenshots show the overview following scroll within one
  group, the sidebar background spanning its rows, and the overview releasing
  before the next group.
- Mobile browser smoke shows the overview in normal flow above its video rows.
