---
date: 2026-06-13
type: fix
scope: web-watch-i18n
status: completed
roadmap: docs/roadmap/platform/feat-189-watch-ui-known-language-catalog-promotion.md
owner: codex
---

# Watch UI Known-Language Catalog Promotion

## Goal

Replace English-seeded Watch UI catalogs with localized app-chrome copy for the
languages that can be translated confidently in this pass, starting with
Romanian. Keep the provisional-catalog safety rail for every language that is
not promoted.

## Scope

In this PR:

- Translate selected `apps/web/messages/*.json` catalogs that currently match
  English exactly.
- Update partial authored catalogs that still contain obvious English strings.
- Regenerate `docs/i18n/watch-ui-provisional-catalogs.json` so promoted locales
  move from `provisionalLocales` to `authoredInventoryLocales`.
- Preserve generated UI-locale membership and structural parity.

Out of scope:

- Admin video title, description, chapter, study-question, transcript, subtitle,
  or audio localization.
- Machine-translating every official-language catalog regardless of confidence.
- URL, routing, cache, or Next.js i18n architecture changes.

## Implementation Units

### Unit 1 — Catalog Selection And Translation

Files:

- `apps/web/messages/*.json`

Tasks:

- Identify catalogs that are exact English copies.
- Translate a bounded set of high-confidence locales, preserving every key and
  placeholder.
- Keep low-confidence exact-copy catalogs untouched and provisional.

Validation:

- Compare promoted catalogs against `apps/web/messages/en.json`; each promoted
  catalog should have localized values rather than `178/178` English matches.

### Unit 2 — Manifest And Guardrail Updates

Files:

- `docs/i18n/watch-ui-provisional-catalogs.json`
- `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`

Tasks:

- Regenerate or update the provisional manifest so promoted locales are no
  longer listed as provisional.
- Add a regression assertion for a representative promoted locale such as `ro`
  so it cannot silently return to the provisional set.

Validation:

- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web test -- src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`

### Unit 3 — I18n Validation

Files:

- `apps/web/messages/*.json`
- `apps/web/src/i18n/generated-ui-locales.ts`

Tasks:

- Run generated locale checks and message parity tests.
- Confirm no generated locale membership drift is introduced.

Validation:

- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts`

### Unit 4 — Romanian Smoke Proof

Files:

- none expected

Tasks:

- Probe or browser-smoke a Romanian Watch URL after the catalog changes are in a
  runnable context.
- Confirm visible UI chrome can source Romanian strings from `ro.json`.

Validation:

- Local render/test where feasible; otherwise note the limitation and rely on
  catalog-level verification.
