---
title: "Forge Algolia Search Modal Pattern"
date: 2026-06-10
last_updated: 2026-07-17
category: architecture-patterns
module: apps/web search modal
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "Adding a server-backed search provider behind a rollout flag in Forge web"
  - "Porting Core Watch search behavior without importing Core runtime packages"
tags: [algolia, search, launchdarkly, language, server-actions]
---

# Forge Algolia Search Modal Pattern

## Problem

Forge needed to reuse Core Watch's Algolia video search without replacing the existing global search modal or exposing Algolia credentials in the browser. The flag-off path also needed to keep semantic search, including experience results, while using a better language default than hardcoded English.

## Pattern

- Put the rollout split at `apps/web/src/lib/search-actions.ts`, not in the modal UI. The client always calls `runSearch`; the server action evaluates `forge.watch.algoliaSearch` and returns a discriminated result.
- Keep Algolia config server-only in `apps/web/src/env.ts` as `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, and `ALGOLIA_INDEX`. Do not mirror these through `NEXT_PUBLIC_*`.
- Query Algolia with Core's Watch visibility filter: `NOT restrictViewPlatforms:watch AND published:true AND videoPublished:true`.
- Transform hits in `apps/web/src/lib/algolia-video-transform.ts` into the existing `SearchResult` card contract so `VideoCard` remains shared by semantic and Algolia results.
- Treat `languageEnglishName` as the selected Algolia facet. Regions from admin country/language metadata are only display groups.
- Resolve search language in one place: explicit search selection, search preference cookie, existing audio preference, route language, `Accept-Language`, then English fallback.
- Use public Watch audio slugs for result links. Algolia/semantic language choices should not mutate UI locale, route locale, or the existing audio preference cookie.

## Review Lessons

- Do not filter the language picker with same-attribute facets after a selected-language search. If the current search has active `languageEnglishName` filters, preserve the full selectable list and use facets only when no language is selected.
- Set result links from the result's own language metadata where possible. Algolia hits can carry `languageId` and `languageEnglishName`; map those to a public slug before falling back to the resolved/preferred language.
- Annotate semantic video results with the resolved public language slug too. Otherwise the flag-off path can search in Spanish while linking users back to English watch URLs.
- Pass the current route language into the server action from `usePathname()`/`parseWatchPath`. Route language should beat browser `Accept-Language` when a viewer is already on a localized watch page.
- Keep pagination source-stable. `loadMore` should reject or reset if page two returns a different `resultSource` from page one, because LaunchDarkly can change between requests.
- Preserve the existing search contract when adding a second backend. A caller that passes `type` expects semantic filtering, and `searchMode` remains the hybrid/keyword-only degradation signal; adapter identity belongs in `resultSource`.
- Use an explicit `nextOffset` from the server action instead of deriving pagination from rendered card count. Algolia pagination advances by raw requested rows, not by transformed rows.
- Normalize client-supplied language facet names at the server boundary: trim, dedupe, cap count, and cap label length before building Algolia filters.
- Apply the same selected-language cap in the UI. The modal should not display a ninth selected chip when the server will only apply the first eight filters.
- Return fixed public semantic-search errors from the server action and log sanitized details server-side only. Do not serialize raw admin/Apollo diagnostics to the browser.
- New overlay copy should go through the existing `SearchOverlay` message namespace and message parity tests. Catalogs claimed as translated must not silently retain English fallback text; any unavoidable fallback must remain explicitly provisional until verified target-language copy is available.

## Files

- `apps/web/src/lib/search-actions.ts`
- `apps/web/src/lib/algolia-search.ts`
- `apps/web/src/lib/algolia-video-transform.ts`
- `apps/web/src/lib/search-language.ts`
- `apps/web/src/lib/search-language-actions.ts`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/search/VideoCard.tsx`
- `packages/feature-flags/src/registry.ts`

## Validation

- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web exec vitest run src/lib/search-actions.test.ts src/lib/search-language-actions.test.ts src/lib/search-language.test.ts src/lib/algolia-search.test.ts src/lib/algolia-video-transform.test.ts`
- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx src/components/search/VideoCard.test.tsx`
- `pnpm --filter @forge/web exec vitest run src/i18n/__tests__/messages-parity.test.ts`

## Related

- `docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md`
- `docs/plans/2026-06-10-001-feat-forge-algolia-search-modal-plan.md`
- `docs/roadmap/content-discovery/feat-172-forge-algolia-search-modal.md`
- `docs/solutions/ui-bugs/machine-translated-ui-catalog-wrong-language-validation-gap.md`
