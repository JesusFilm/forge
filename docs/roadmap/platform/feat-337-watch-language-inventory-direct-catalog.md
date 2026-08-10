---
id: "feat-337"
title: "Focus Watch language inventory on the dubbed catalog"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "language-inventory"
---

## Problem

The language inventory page places an authored Experience section, promoted
videos, and several curated category bands before the complete dubbed catalog.
This delays the operator-focused inventory headed by “Fully dubbed”.

## Entry Points

1. `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx` -
   language inventory route data composition.
2. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   - section navigation and inventory ordering.
3. `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx` -
   route-render coverage.

## Grep These

- `resolveLanguageHomeSections`
- `language-inventory-home-sections`
- `language-inventory-promoted`
- `language-inventory-bible-gospels`
- `language-inventory-bible-project`
- `language-inventory-sports`
- `LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES`

## What To Build

1. Remove the authored Experience, promoted, Video Bible, BibleProject, and
   sports bands before the complete dubbed catalog.
2. Remove navigation cards that would point to deleted bands.
3. Keep the hero, language selector, dubbed grouped catalog, and subtitle-only
   catalog unchanged.

## Verification

- Focused route tests prove the removed bands are absent and the dubbed grouped
  catalog remains.
- `@forge/web` typecheck and targeted lint pass.
- Local browser QA on `/watch/malagasy.html/videos` shows the complete dubbed
  catalog immediately after the remaining section navigation.
