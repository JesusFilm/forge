---
id: "feat-308"
title: "Preserve Spanish variant identity in Watch search"
owner: "unassigned"
priority: "P0"
status: "complete"
start_date: "2026-07-23"
completed_date: "2026-07-23"
duration: 1
depends_on:
  - "feat-196"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "localization"
---

## Problem

Watch query-language detection maps Spanish to the preferred Castilian search
option and compares only exact public slugs. When Latin American Spanish is
selected, confidently Spanish input therefore pauses behind a suggestion that
would replace the viewer's regional variant. If the viewer edits an existing
query while that suggestion is pending, result cards from the old query remain
visible beneath the new input.

## Entry Points - Read These First

1. `docs/plans/2026-07-23-004-fix-watch-spanish-variant-search-plan.md` -
   scoped implementation plan and acceptance examples.
2. `apps/web/src/lib/search-query-language.ts` - detector mapping and
   suggestion suppression.
3. `apps/web/src/components/FloatingSearchController.tsx` - query, request,
   and result freshness ownership.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   rendered search-modal regressions.
5. `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md`
   - exact public-slug identity boundary.

## Grep These

```bash
rg -n "detectQueryLanguageSuggestion|currentLanguageSlug|PUBLIC_SLUG_BY_DETECTOR_CODE" apps/web/src
rg -n "requestIdRef|displayResultsRef|setQuery" apps/web/src/components/FloatingSearchController.tsx
rg -n "spanish-(castilian|latin-american)|perdón|Navidad|ansiedad|hijo pródigo" apps/web/src
```

## What To Build

1. Treat supported Search Languages with the same normalized BCP-47 primary
   subtag as equivalent only when deciding whether to show a query-language
   suggestion.
2. Preserve the exact selected public language slug for requests, analytics,
   pagination, and result routes.
3. Invalidate old result presentation and in-flight request freshness as soon
   as the visible query changes.
4. Cover both Spanish variants, every FGE-1 query, and a late old-query
   response with deterministic and rendered tests.

## Constraints

- Do not change the preferred detector-code mapping for Spanish.
- Do not merge regional Language entities or use BCP-47 as their identity.
- Do not change TinyLD thresholds, Admin search behavior, or GraphQL contracts.
- Keep the existing explicit confirmation for a genuinely different primary
  language.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/lib/search-query-language.test.ts src/lib/search-query-language.tinyld.test.ts src/components/__tests__/FloatingSearchProvider.test.tsx
pnpm --filter @forge/web exec tsc --noEmit --pretty false
```

Browser smoke must exercise the real Watch search modal with Latin American
Spanish selected, prove that replacing `perdón` with each FGE-1 query removes
old cards without a Castilian confirmation, and confirm the selected regional
variant remains active.
