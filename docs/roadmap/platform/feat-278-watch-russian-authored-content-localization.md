---
id: "feat-278"
title: "Watch Russian authored content localization"
owner: "unassigned"
priority: "P1"
status: "not-started"
start_date: null
duration: 2
depends_on:
  - "feat-276"
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch-page"
  - "localization"
  - "data-quality"
---

## Problem

After the Russian UI chrome was localized, real browser proof still found
English Admin-authored collection titles or descriptions on the Russian
inventory page, including `Love Your Neighbor`, `JF Language Stack Collection`,
`Easter`, and `Anticipate the Resurrection`. These are content-locale gaps, not
UI catalog strings, and must be fixed at the Admin/Core metadata source.

## Entry Points - Read These First

1. `apps/admin/src/services/video.service.ts` - localized title/description
   resolution for Watch inventory records.
2. `apps/web/src/lib/watch-language-inventory.ts` - Admin content consumption
   and language inventory grouping.
3. `apps/web/src/lib/watch-home.ts` - localized home-card title/description
   resolution.
4. `/watch/russian.html/videos` - exact browser audit surface.

## Grep These

- `rg -n 'title|description|localized|fallback' apps/admin/src/services/video.service.ts`
- `rg -n 'titleFallback|descriptionFallback|languageSlug' apps/web/src/lib/watch-language-inventory.ts apps/web/src/lib/watch-home.ts`
- `rg -n 'Love Your Neighbor|JF Language Stack Collection|Easter|Anticipate the Resurrection' apps/admin apps/web`
- `rg -n 'russian|ru' apps/admin/src apps/web/src/lib`

## What To Build

1. Inventory Russian Watch records whose selected title or description falls
   back to English or a slug because the Russian locale record is absent.
2. Add or correct reviewed Russian metadata in the authoritative Admin/Core
   content source, preserving product/series names where intentional.
3. Add a report or guard that distinguishes deliberate proper-name fallback
   from missing localized authored content.
4. Re-smoke the Russian inventory and representative video/series pages after
   the corrected content sync reaches Admin.

## Constraints

- Do not move authored titles/descriptions into `apps/web/messages`.
- Do not fabricate translations in the web rendering layer.
- Preserve content IDs, slugs, audio availability, and public route shapes.

## Verification

- Query Admin for Russian locale coverage of every surfaced inventory record.
- Browser audit `/watch/russian.html/videos` and sampled linked content pages.
- Confirm remaining English is limited to approved brands or proper names.
