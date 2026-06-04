---
id: feat-156
title: Watch UI provisional official-language catalogs
status: "complete"
priority: high
area: platform
tags:
  - web
  - watch-page
  - i18n
  - localization
depends_on:
  - feat-155
blocks: []
---

## Problem

The official-language inventory now identifies the UI locale tags represented by
countries in the supplied GA4 report, but most of those tags still do not have a
message catalog. Without a catalog file, watch routes for those languages
continue to fall back to English UI identity instead of exercising the
catalog-driven locale path.

The user requested immediate provisional catalog coverage for every language in
that inventory. This must be clearly marked as provisional because generated
catalog files are not the same as reviewed localization copy.

## Entry Points

- `docs/i18n/watch-ui-official-language-inventory.json`
- `apps/web/messages/en.json`
- `apps/web/messages/*.json`
- `apps/web/scripts/generate-ui-locales.mjs`
- `apps/web/src/i18n/generated-ui-locales.ts`
- `apps/web/src/i18n/__tests__/messages-parity.test.ts`

## What To Build

- Add a generator that creates missing UI message catalogs for every language
  tag in `docs/i18n/watch-ui-official-language-inventory.json`.
- Preserve all existing authored catalogs and seed only missing locales from
  `apps/web/messages/en.json`.
- Record which catalogs are provisional so reviewers and localization owners do
  not mistake English-seeded coverage for reviewed translations.
- Regenerate UI locale membership and add tests that fail when inventory
  languages are missing from `apps/web/messages`.

## Constraints

- Do not overwrite existing translated catalogs.
- Do not invent unreviewed translations for languages where no reviewed source
  exists.
- Preserve ICU placeholders and structural message parity.
- Keep public watch URL shape unchanged.
- Keep provisional catalog coverage separate from audio/content availability.

## Verification

- `pnpm --filter @forge/web generate:provisional-ui-catalogs -- --generated-on 2026-06-02`
- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
