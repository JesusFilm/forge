---
id: "feat-335"
title: "Watch language inventory English assistance"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
duration: 1
depends_on:
  - "feat-192"
blocks: []
tags:
  - "web"
  - "watch"
  - "content-discovery"
  - "i18n"
  - "accessibility"
---

## Problem

Watch language inventories intentionally use the selected language so seekers
can navigate and discover them in their own language and script. English-
speaking ministry users who work across many language inventories need concise
English navigation help without replacing that localized interface.

## Entry Points - Read These First

1. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
2. `apps/web/src/components/watch-language-inventory/LanguageCollectionSwitcher.tsx`
3. `apps/web/src/components/watch/LanguageCombobox.tsx`
4. `docs/plans/2026-08-05-001-feat-watch-inventory-english-assist-plan.md`

## Grep These

- `SectionMetricAnchor|InventoryCardFrame|CompactVideoList` in the inventory
  page.
- `triggerWrapper` in `LanguageCombobox.tsx`.
- `CarouselPrevious|CarouselNext` in the inventory page and shared carousel.
- `LanguageInventory` in `apps/web/messages/en.json` and inventory tests.

## What To Build

1. Add concise native English HTML `title` attributes to inventory-owned
   interactive elements and important labels.
2. Annotate the language selector, section shortcuts, carousel controls,
   linked videos, linked collections, and collection actions without changing
   localized text, accessible names, routes, or first-tap behavior.
3. Do not add a custom tooltip, dialog, guide trigger, overlay, event controller,
   or per-item client component.
4. Add focused component coverage and representative desktop browser proof.

## Constraints

- Keep existing visible interface text, content titles, routes, and primary
  accessible names localized; English appears only in native `title` text.
- Do not add Admin, GraphQL, or content-title translation work.
- Do not change the existing multilingual language-picker modal.
- Keep the dense inventory server-rendered with zero hydrated assistance roots.
- Do not turn noninteractive labels into keyboard focus stops.
- Preserve first-tap navigation on videos, collections, and section shortcuts.

## Verification

- Focused inventory and switcher tests pass.
- `pnpm --filter @forge/web typecheck`
- Browser verification confirms native titles are present and the former `EN`
  guide and custom tooltip overlays are absent.
- The page adds no data request, custom event listener, dialog, or tooltip root.

## Plan

Implementation plan:
`docs/plans/2026-08-05-001-feat-watch-inventory-english-assist-plan.md`

## Completion

- Added native English HTML `title` attributes to inventory-owned controls and
  important labels, with no custom popup or guide.
- Preserved localized labels, accessible names, routes, callbacks, and first-tap
  navigation across inventory cards, sections, status labels, and the language
  collection switcher.
- Covered the title-only behavior with focused component tests, web type
  checking, lint, a production build, and local browser verification.
- Verified there are no assistance fetch/XHR calls, hydrated assistance roots,
  custom overlays, or persistent English UI controls.
