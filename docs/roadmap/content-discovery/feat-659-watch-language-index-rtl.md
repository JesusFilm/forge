---
id: "feat-659"
title: "Complete RTL and mixed-language markup on the Watch language index"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
---

## Problem

The Watch language index does not fully honor RTL UI direction or identify the language and direction of its English and native language labels. Its search affordances use physical left/right utilities, and search language country suggestions always use English country names. Mixed-script content can therefore be misread by browsers and assistive technology.

## Entry Points — Read These First

- `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx`
- `apps/web/src/lib/language-index.ts`
- `apps/web/src/lib/search-language-actions.ts`
- `apps/web/src/components/FloatingSearchController.tsx`
- `apps/web/src/lib/search-language-actions.test.ts`
- `apps/web/src/components/watch/WatchLanguageIndexBrowser.test.tsx`

## Grep These

- `left-`, `right-`, `pl-`, `pr-`, `ml-`, `mr-` in the language index browser
- `ArrowRight`
- `nativeLabel`, `englishLabel`, `bcp47`
- `countryNameFromCode`
- `searchLanguageOptionsCacheKey`

## What To Build

- Use logical start/end positioning and padding in the language index search; mirror its forward arrow for RTL.
- Set explicit English language/direction metadata on English labels and valid BCP-47 language/direction metadata on endonyms. Keep English country/region names isolated and declared as English.
- Localize the search country label with the UI locale and include that locale in the browser-side response cache key.
- Add a scoped lint rule preventing new physical inline-direction spacing utilities in `WatchLanguageIndexBrowser.tsx`, plus focused regressions for RTL markup and localized country suggestions.

## Constraints

- Do not change public Watch routes, generated language corpora, language inventory data, or editorial labels.
- Do not assert a language tag that fails the app's `isDeclarableHtmlLangTag` check.
- Preserve existing search behavior when the UI locale is unavailable by falling back to English.

## Verification

- Run focused Watch language index and search-language action tests.
- Run web typecheck, targeted ESLint, and Prettier checks.
- Run Claude Code review with the configured Team login, resolve findings, and repeat relevant checks.

## Completion Evidence

- 17 focused tests passed, including Watch language index rendering, localized search suggestions, locale-separated caches, and the `FloatingSearchController` locale integration (150 tests in its suite).
- Web typecheck, targeted ESLint, Prettier, and `git diff --check` passed.
- Claude Code review found no blockers after addressing its accessibility and markup findings.
- Draft PR: pending creation.
