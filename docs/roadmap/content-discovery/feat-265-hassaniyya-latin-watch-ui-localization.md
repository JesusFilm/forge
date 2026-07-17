---
id: "feat-265"
title: "Hassaniyya-Latin Watch UI localization"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: null
duration: 1
depends_on:
  - "feat-264"
blocks: []
tags:
  - "web"
  - "watch"
  - "languages"
  - "i18n"
  - "content-discovery"
---

## Problem

`mey-Latn` is the final provisional Watch UI catalog after feat-264. Its prior
machine output was Spanish rather than Hassaniyya, so feat-264 restored the
catalog to an explicit English fallback instead of mislabeling bridge-language
copy as localized UI.

## Entry Points - Read These First

1. `apps/web/messages/mey-Latn.json` - current exact English fallback.
2. `apps/web/scripts/ui-translation-policy.json` - reviewed and machine catalog policy.
3. `docs/i18n/watch-ui-provisional-catalogs.json` - provisional ownership and translation provenance.
4. `apps/web/src/i18n/__tests__/messages-parity.test.ts` - structural, ICU, and English-copy gates.
5. `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts` - provisional and digest invariants.

## What To Build

1. Obtain native-speaker or otherwise verifiable Hassaniyya translations in the official Senegal Latin orthography for every shipped UI message.
2. Preserve ICU variables, plural behavior, rich-text tags, and contextual Watch terminology.
3. Remove `mey-Latn` from `provisionalLocales`, add it to machine or human-reviewed ownership as appropriate, and record fresh source/catalog digests.
4. Add target-language identity QA proving the catalog is neither English nor a Spanish/Arabic bridge-language fallback.
5. Browser-smoke a real Hassaniyya Watch route when a public audio-language slug is available.

## Constraints

- Do not transliterate Modern Standard Arabic or Darija and label it Hassaniyya without native validation.
- Do not preserve the previous Spanish fallback as localized copy.
- Keep the English fallback explicit until all catalog messages have defensible target-language copy.

## Verification

- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
