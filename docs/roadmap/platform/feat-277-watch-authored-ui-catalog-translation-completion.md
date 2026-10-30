---
id: "feat-277"
title: "Watch authored UI catalog translation completion"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 3
depends_on:
  - "feat-276"
blocks:
  - "feat-422"
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "i18n"
  - "localization"
---

## Problem

Russian now has reviewed contextual copy for the expanded Watch UI surface, but
the other authored locale catalogs received English source values for the new
keys to preserve structural parity. The 201 explicitly provisional catalogs
also remain English. The user has now explicitly requested contextual UI copy
for every shipped language and approved sending the English UI catalog to the
OpenAI API for that work.

## Entry Points - Read These First

1. `docs/i18n/watch-ui-provisional-catalogs.json` - authored/provisional locale
   ownership and promotion policy.
2. `apps/web/messages/en.json` and `apps/web/messages/ru.json` - source and the
   completed contextual reference implementation.
3. `apps/web/src/i18n/__tests__/messages-parity.test.ts` - structural parity and
   authored source-copy checks.
4. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   and `apps/web/src/components/home/WatchHomeSection.tsx` - high-context copy
   consumers.

## Grep These

- `rg -n 'useTranslations|createTranslator' apps/web/src`
- `rg -n 'machineTranslatedLocales|fallbackModels|provisionalCatalogs' docs/i18n apps/web`
- `rg -n 'maximumSourceCopiedMessages|validateTranslation|humanReviewedLocales' apps/web`
- `rg -n 'WatchHome|LanguageInventory|WatchHistory|ExperienceError' apps/web/messages/en.json`

## What To Build

1. Preserve existing authored translations and contextually translate every
   remaining English-valued UI message in every non-English catalog.
2. Replace every provisional English clone with locale-specific copy and record
   the machine-translation model/provenance separately from reviewed copy.
3. Preserve ICU placeholders, plural categories, product names, accessibility
   meaning, and string context rather than translating values in isolation.
4. Add source-clone, structural-parity, and provenance gates so future English
   catalog leakage or accidental provisional regeneration fails CI.
5. Browser-smoke representative Latin, Cyrillic, Arabic/RTL, and CJK catalogs.

## Constraints

- Machine output is permitted by the user's explicit approval, but must remain
  identified as machine-translated and recommended for native-speaker review.
- Do not change public locale routing or the Admin language inventory.
- Keep source-copy exceptions limited to proper names, punctuation-only
  templates, and deliberately locale-neutral values.

## Verification

- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts`
- `pnpm --filter @forge/web test -- src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke representative Latin, Cyrillic, Arabic/RTL, and CJK locales.

## Completion Notes

- Shipped exact structural parity across 225 UI catalogs: English plus 224
  non-English catalogs, covering all 223 inventory languages and both existing
  non-inventory UI catalogs. There are no missing catalogs; Western Cree and
  Hassaniyya-Latin remain explicit English-seeded provisional catalogs because
  their generated copy did not meet the translation-quality gate.
- Preserved reviewed English and Russian copy. Another 221 catalogs are
  recorded as contextual machine translations using `gpt-5.6-sol`, with a
  final model, source digest, current catalog digest, and generation date for
  every locale in `docs/i18n/watch-ui-provisional-catalogs.json`.
  Native-speaker review remains recommended.
- Enforced 404 string leaves per catalog, exact ICU variable/rich-tag and
  plural/select contracts, real `next-intl` formatting, and zero non-neutral
  English-source copies. The final audit found zero exact source matches across
  all 87,912 translatable non-provisional leaves; the only eight permitted
  exceptions are explicitly enumerated locale-neutral product/title templates.
- Browser-smoked representative Latin, Cyrillic, Arabic/RTL, and CJK routes.
  The root layout now derives document direction for both Node 20/22's
  `Intl.Locale#textInfo` shape and Node 24's `getTextInfo()` shape.
- Added a resumable, context-aware translation pipeline with structured-output
  validation, retry/backoff, strict source-copy rejection, per-catalog digests,
  final per-locale provenance promotion, and focused failure-path tests.
- Reconciled the later global beta-tester modal with this localization scope.
  Its seven-string client namespace is derived in every catalog from existing
  contextual translations for the beta CTA, generic form actions, loading,
  failure, and close states. The additive source digest and derivation map are
  recorded in `metadata.translation.sourceExtensions`; `crk` and `mey-Latn`
  remain exact English fallbacks.
- Page-loading behavior remains static and locale-scoped: no new runtime
  requests, client hydration, or dependencies were added. Direction is
  resolved once in the server layout, only the active locale is loaded, and
  client messages are scoped by route instead of serializing the full active
  catalog on every Watch page. The beta-modal namespace adds 239 raw / 52 gzip
  bytes for English and 40-62 gzip bytes across all 225 catalogs (52.8-byte
  average); the current English global-message payload is 1,753 gzip bytes.
  The modal implementation remains dynamically imported and only loads after
  interaction.
