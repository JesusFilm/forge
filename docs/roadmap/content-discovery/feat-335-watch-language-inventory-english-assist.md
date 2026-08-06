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
4. `apps/web/src/components/ui/dialog.tsx`
5. `docs/plans/2026-08-05-001-feat-watch-inventory-english-assist-plan.md`

## Grep These

- `SectionMetricAnchor|InventoryCardFrame|CompactVideoList` in the inventory
  page.
- `triggerWrapper` in `LanguageCombobox.tsx`.
- `CarouselPrevious|CarouselNext` in the inventory page and shared carousel.
- `LanguageInventory` in `apps/web/messages/en.json` and inventory tests.

## What To Build

1. Add one event-delegated English tooltip controller for inventory-owned
   interactive elements, including native HTML `title` fallbacks.
2. Add a compact `EN` English-help trigger and accessible dialog that explains
   the page's universal icons, actions, sections, and availability states.
3. Annotate the language selector, section shortcuts, carousel controls,
   linked videos, linked collections, and collection actions without changing
   localized text, accessible names, routes, or first-tap behavior.
4. Add focused component coverage and representative desktop, keyboard, touch,
   non-Latin, and RTL browser proof.

## Constraints

- Keep existing visible interface text, content titles, routes, and primary
  accessible names localized; only the on-demand assistance is English.
- Do not add Admin, GraphQL, or content-title translation work.
- Do not change the existing multilingual language-picker modal.
- Keep the dense inventory server-rendered with a constant number of hydrated
  assistance roots as item count grows.
- Do not turn noninteractive labels into keyboard focus stops.
- Preserve first-tap navigation on videos, collections, and section shortcuts.

## Verification

- Focused inventory, switcher, tooltip-controller, and guide tests pass.
- `pnpm --filter @forge/web typecheck`
- Browser verification covers hover, keyboard focus, Escape, guide focus
  return, first-tap navigation, 320 CSS pixels, 200% zoom, RTL, and non-Latin
  content with screenshot proof.
- The page adds no data request, no horizontal overflow, and no per-card client
  tooltip root.

## Plan

Implementation plan:
`docs/plans/2026-08-05-001-feat-watch-inventory-english-assist-plan.md`

## Completion

- Added one delegated hover/focus tooltip controller with exact native-title
  fallback restoration and one tap-accessible English guide.
- Preserved localized labels, accessible names, routes, callbacks, and first-tap
  navigation across inventory cards, sections, status labels, and the language
  collection switcher.
- Covered the behavior with 13 focused component tests, web type checking,
  lint, a successful production build, and browser proof across desktop,
  keyboard, mobile, zoomed, non-Latin, and RTL layouts.
- Verified no assistance fetch/XHR, no horizontal overflow, and a constant two
  assistance roots for sparse and dense inventory fixtures.
- Captured the durable implementation pattern in
  `docs/solutions/design-patterns/watch-localized-inventory-delegated-english-assistance.md`.
