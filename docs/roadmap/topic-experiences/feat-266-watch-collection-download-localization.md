---
id: "feat-266"
title: "Watch collection download localization"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: null
duration: 2
depends_on:
  - "feat-251"
blocks: []
tags:
  - "web"
  - "watch"
  - "download"
  - "i18n"
  - "topic-experiences"
---

## Problem

The collection-download UI was developed while official Watch catalogs still
used provisional English fallbacks. After those catalogs moved to contextual
machine translation, the collection-download paths remain explicitly pending
and must not be represented as translated in catalog provenance.

## Entry Points - Read These First

1. `apps/web/scripts/ui-translation-policy.json` - exact pending message paths.
2. `apps/web/messages/en.json` - source copy and ICU placeholders.
3. `docs/i18n/watch-ui-provisional-catalogs.json` - catalog ownership and translation provenance.
4. `apps/web/src/i18n/__tests__/messages-parity.test.ts` - copy and structural parity gates.
5. `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts` - digest invariants.

## What To Build

1. Contextually translate every `pendingTranslationPaths` entry into each machine-translated catalog.
2. Reuse established localized Watch terms for language, download, account, and retry concepts.
3. Preserve ICU placeholders and plural branches exactly.
4. Remove translated paths from `pendingTranslationPaths` and refresh per-locale source and catalog digests.
5. Browser-smoke collection downloads in representative LTR and RTL locales.

## Constraints

- Do not claim English fallback copy as translated.
- Do not replace existing localized catalog content.
- Keep `en` and `ru` human-review ownership unchanged unless reviewers explicitly approve a change.

## Verification

- `pnpm --filter @forge/web test -- messages-parity.test.ts watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
