---
id: feat-151
title: Localize visible watch chrome strings
status: "complete"
priority: high
area: platform
tags:
  - web
  - watch-page
  - i18n
depends_on:
  - feat-150
blocks: []
---

## Problem

Russian watch URLs now resolve to the Russian UI catalog, but some first-screen
chrome still renders English because the strings are hardcoded in client
components instead of read from `next-intl`.

## Entry Points

- `apps/web/src/components/FloatingSearchBar.tsx`
- `apps/web/src/components/FloatingSearchField.tsx`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/ExperienceSkeleton.tsx`
- `apps/web/messages/*.json`

## What To Build

Move the visible watch chrome strings for floating search, search overlay,
hero-player pre-reveal controls, and loading skeletons into message catalogs.
Keep search terms themselves stable so backend search behavior does not change.

## Verification

- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts`
- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx`
- Production smoke for `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html` should show `ru` HTML plus localized visible chrome.
