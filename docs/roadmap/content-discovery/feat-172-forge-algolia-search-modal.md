---
id: "feat-172"
title: "Forge Algolia search modal"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
completed_date: "2026-06-10"
duration: 5
depends_on:
  - "feat-011"
  - "feat-144"
blocks:
  - "feat-242"
tags:
  - "content-discovery"
  - "web"
  - "search"
  - "algolia"
  - "feature-flag"
---

## Problem

Forge's global search modal should be able to use Core Watch's Algolia video
index behind a LaunchDarkly flag while preserving today's semantic search
fallback. The modal also needs Core-style language discovery so viewers can
filter Algolia results by language and semantic search can stop defaulting
blindly to English.

## Entry Points - Read These First

1. `docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md`
   - product decisions, feature flag behavior, language semantics, and v1
     scope boundaries.
2. `docs/plans/2026-06-10-001-feat-forge-algolia-search-modal-plan.md`
   - implementation units, technical decisions, and verification scope.
3. `apps/web/src/components/FloatingSearchProvider.tsx`
   - current modal state, URL sync, semantic search calls, and pagination.
4. `apps/web/src/lib/search-actions.ts`
   - server-action boundary for client search.
5. `apps/web/src/lib/feature-flags.ts`
   - web LaunchDarkly server-side flag foundation.
6. `.tmp/core/libs/journeys/ui/src/libs/algolia/useAlgoliaVideos/searchConfigure.ts`
   - Core Watch visibility filter.

## Grep These

```bash
rg -n "runSearch|searchVideos|locale: \"en\"|SearchOverlay|FloatingSearchProvider" apps/web/src
rg -n "featureFlags|FORGE_WATCH_.*DEFAULT|LaunchDarkly" apps/web/src packages/feature-flags/src
rg -n "languageEnglishName|SearchBarProvider|transformAlgoliaVideos|WATCH_VISIBILITY_FILTER" .tmp/core
```

## What To Build

1. Register `forge.watch.algoliaSearch` with default-off local fallback
   `FORGE_WATCH_ALGOLIA_SEARCH_DEFAULT`.
2. Add server-only Algolia env support for app id, search API key, and index.
3. Add a server-side Algolia search adapter that applies Core's Watch
   visibility filter and returns safe error states.
4. Transform Algolia video hits into Forge search card results.
5. Resolve a search language from explicit search selection, search
   preference, audio preference, route language, browser language, and English
   fallback.
6. Pass the resolved locale to semantic search when the flag is off.
7. Add modal language controls for region-grouped language filters, selected
   pills, clear/remove actions, and country language suggestions in Algolia
   mode.
8. Ensure result links use public Watch route builders and public audio slugs.

## Constraints

- Do not add a new `/videos`, `/search`, or `/watch/search` page for v1.
- Do not expose Algolia keys through `NEXT_PUBLIC_*` or client env schema.
- Do not import Core runtime packages into `apps/web`.
- Do not mutate UI locale, route locale, or persisted audio preference when
  selecting search languages.
- Do not hand-edit generated GraphQL environment or type files.
- Keep flag-off semantic search compatible with today's modal behavior,
  including experience results.

## Verification

- Feature flag tests cover default-off, local fallback, and LaunchDarkly pass
  through.
- Web env tests prove Algolia values are server-only and optional.
- Algolia adapter tests cover request headers/body, Watch filter, facets,
  pagination, escaping, missing config, and upstream failures.
- Search language tests cover precedence, fallback, country suggestions, and
  public slug mapping.
- Modal component tests cover language selection, clear/remove behavior,
  keyboard focus, screen-reader labels, and category/search regressions.
- Card tests cover language-aware Watch links and malformed slug fallback.
