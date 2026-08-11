---
id: "feat-349"
title: "Add one language dropdown to Admin search comparison"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-08-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "multilingual"
---

## Problem

The private Watch search comparison asks evaluators to type a language slug and
BCP-47 locale into separate fields. Most evaluators do not know which two values
belong together, so an invalid pairing can make a valid search comparison
misleading.

## Entry Points — Read These First

1. `apps/admin/src/app/dashboard/search/compare/page.tsx`
2. `apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx`
3. `apps/admin/src/app/dashboard/search/compare/comparison-actions.ts`
4. `apps/admin/src/services/watch-search-language-options.service.ts`

## Grep These

- `languageSelection` — the combined dropdown field and server-action input.
- `loadWatchSearchLanguageOptions` — the cached language option loader.
- `resolveWatchSearchLanguageSelection` — canonical server-side slug resolution.

## Constraints

- Keep the page Admin-only and behind the existing candidate-comparison flag.
- Submit only the canonical slug; resolve its BCP-47 value on the server.
- Keep the language catalog bounded and cached so repeated comparisons do not
  add database reads.
- Do not change the public Watch search request path or its latency.

## What To Build

- Load active languages from Admin's canonical language records.
- Replace the slug and locale text fields with one friendly language dropdown.
- Resolve the selected slug to its canonical BCP-47 locale on the server.
- Keep automatic query-language detection available when no language is chosen.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/search/compare/page.test.tsx src/app/dashboard/search/compare/comparison-actions.test.ts src/services/watch-search-language-options.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm exec eslint apps/admin/src/app/dashboard/search/compare/page.tsx apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx apps/admin/src/app/dashboard/search/compare/comparison-actions.ts apps/admin/src/services/watch-search-language-options.service.ts`
- Representative 2,300-language SSR markup measured 148,313 bytes and is guarded
  by a 300 KB test budget. This Admin-only page is not used by public Watch
  search, and the change does not alter Typesense request count or latency.
