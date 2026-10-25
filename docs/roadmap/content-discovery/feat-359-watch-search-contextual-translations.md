---
id: "feat-359"
title: "Correct contextual Watch search translations"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-12"
duration: 1
depends_on:
  - "feat-358"
blocks:
  - "feat-360"
tags:
  - "watch"
  - "search"
  - "i18n"
  - "web"
---

## Problem

The Watch search context row was translated as disconnected labels in several
locales. The completed-results state is assembled from unrelated message
fragments, and the selected language chip always uses its English name, so a
Russian interface can render copy such as `Искать. Язык: Russian`.

## Entry Points - Read These First

1. `apps/web/src/components/SearchOverlay.tsx`
2. `apps/web/messages/en.json`
3. `apps/web/messages/ru.json`
4. `apps/web/scripts/openai-catalog-translator.mjs`
5. `apps/web/scripts/translate-ui-catalogs.mjs`
6. `docs/i18n/watch-ui-provisional-catalogs.json`

## Grep These

```bash
rg -n "searchSuggestionWithLanguage|searchingInLanguage|semanticLanguageName" apps/web
rg -n "pendingTranslationPaths|localeProvenance" apps/web/scripts docs/i18n
```

## What To Build

1. Give the completed-results context its own full `Searching in {language}`
   message instead of joining translated fragments.
2. Display the selected search language name localized to the interface locale,
   falling back to its native and then English name only when needed.
3. Contextually retranslate the search-suggestion heading, direct-match
   heading, actionable query row, initial language row, and completed-results
   language row across every non-English Watch UI catalog.
4. Preserve ICU placeholders and translation provenance.

## Verification

- Russian and representative LTR/RTL catalogs use natural contextual copy and
  retain the `{language}` and `{suggestion}` placeholders.
- The Russian UI displays `Русский`, not `Russian`, in the selected-language
  chip.
- Catalog parity, translation provenance, focused interaction tests, Web
  typecheck, lint, formatting, and desktop/mobile browser smoke pass.

```bash
pnpm --filter @forge/web test -- --run src/components/__tests__/FloatingSearchProvider.test.tsx src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts
pnpm --filter @forge/web exec vitest run scripts/translate-ui-catalogs.test.mjs
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

## Completion Evidence

- Added complete contextual messages for the initial language scope, actionable
  query row, and completed-results scope instead of assembling fragments.
- Localized the selected search-language display name to the interface locale,
  with native-name fallback when `Intl.DisplayNames` silently falls back and a
  grammar-aware contextual form for natural Russian search sentences.
- Retranslated the seven affected search messages across all 222 authored
  non-English catalogs with a native-first prompt that permits target-language
  word order, idiom, particles, and postpositions; `crk` and `mey-Latn` remain
  explicit provisional English fallbacks pending language-author review.
- Recorded native-speaker review as `feat-360` for endangered and low-resource
  locales where machine output cannot be treated as linguistically authoritative.
- Added executable placeholder-boundary, completed-results, and available explicit-script-family
  validation to the translation pipeline.
- Passed 612 focused Web tests, Web typecheck, lint, Prettier, catalog integrity,
  and live Russian, Arabic RTL, and Japanese browser smoke on 2026-08-12.
- Passed a production Next.js build and a production-mode `/watch` load smoke:
  27 script requests, 688,079 transferred script bytes, 634 ms DOMContentLoaded,
  666 ms load, and zero observed long tasks in the local release build.
