---
date: 2026-06-10
topic: forge-algolia-search-modal
---

# Forge Algolia Search Modal

> Superseded on 2026-06-24 for Watch search URL state: the modal remains canonical, but search no longer reads from or writes to `?q=`. Use `docs/brainstorms/2026-06-24-watch-search-local-state-requirements.md` for the current Watch search query-state contract.

## Summary

Forge's global search modal remains the canonical search surface. A LaunchDarkly flag switches modal result data from Forge semantic search to the same Algolia Watch video source Core uses, while flag-off behavior keeps the current semantic search including experience results. The modal also gains Core-style language discovery: likely language suggestions, region-grouped language filters, and a shared preferred search language that applies to semantic search as well as Algolia.

---

## Problem Frame

Forge already has the Watch-style floating search modal, categories, query URL sync, loading states, result grid, and semantic search action. It does not yet use Watch's Algolia index, and its semantic search path currently searches with an English locale regardless of the viewer's likely or selected language.

Core's Watch app has two useful search capabilities Forge should absorb. First, Watch can query the Algolia video index with centralized visibility filtering for public Watch videos. Second, Core has a language search surface that suggests likely country languages and groups available language refinements by region. Bringing those behaviors into Forge should improve discovery without creating a second search destination or exposing Algolia secrets to the browser.

---

## Key Decisions

- **Keep Forge's modal canonical.** The existing global modal remains the only v1 search surface. This follows `apps/web/AGENTS.md`, avoids new `/watch/search` or `/videos` behavior, and keeps the user in the same workflow Forge already shipped.
- **Flag-on means video-only Algolia.** When the LaunchDarkly flag is enabled, results come from the Watch Algolia video index and do not blend in Forge experience results. Flag off keeps today's semantic search behavior, including experiences.
- **Use the same Algolia source as Core.** Forge should target the same Algolia app/index endpoint Core Watch uses, with app id, search key, and index supplied through Forge environment configuration.
- **Keep Algolia secrets server-side.** Copy the behavior and result shape from Core, but do not copy a browser-exposed InstantSearch key pattern if Forge can query through server-side actions.
- **Share the preferred search language.** The language signal is not Algolia-only. Semantic search should use the best available or selected search language instead of hardcoding English.
- **Regions group languages, not selections.** The Core regional surface lets users select languages from region groups. Selecting a region itself is not a filter.

---

## Actors

- A1. Watch viewer: Opens the Forge search modal to find videos or experiences, often without knowing the exact title.
- A2. Multilingual viewer: Wants results in a language they can understand or a language likely for their country.
- A3. Rollout owner: Uses LaunchDarkly to test Algolia search with a limited audience and return to semantic search if needed.
- A4. Implementing engineer or agent: Ports the Core behavior into Forge without breaking the current modal or leaking secrets.

---

## Key Flows

- F1. Flag-off search
  - **Trigger:** A viewer searches while the Algolia flag is off.
  - **Actors:** A1, A2
  - **Steps:** The modal opens, derives a preferred search language, calls Forge semantic search, and renders the existing mix of video and experience results.
  - **Outcome:** Search behaves like Forge today except the locale is no longer blindly English when a better language is known.
  - **Covered by:** R1, R2, R10, R11, R12

- F2. Flag-on Algolia search
  - **Trigger:** A viewer searches while the Algolia flag is on.
  - **Actors:** A1, A2, A3
  - **Steps:** The modal calls Forge's server-side Algolia search path, applies Watch visibility rules, transforms Algolia hits into Forge card-compatible video results, and paginates more results from the same source.
  - **Outcome:** The viewer sees Watch Algolia video results inside Forge's existing modal.
  - **Covered by:** R1, R3, R4, R5, R6, R7, R8, R9

- F3. Language discovery and filtering
  - **Trigger:** A viewer opens the language surface in the search modal.
  - **Actors:** A2
  - **Steps:** The modal shows likely language suggestions when a country or preference signal is available, shows available languages grouped by region, lets the viewer select one or more language refinements, and updates the current search.
  - **Outcome:** The selected languages filter search results without changing UI locale, route locale, or selecting a whole region.
  - **Covered by:** R10, R11, R12, R13, R14

- F4. Result click-through
  - **Trigger:** A viewer selects a search result.
  - **Actors:** A1, A2
  - **Steps:** The result card links to a valid Forge Watch URL using the best known public audio language slug for the result or selected language.
  - **Outcome:** The viewer lands on a playable Watch page with Forge's existing route and language rules intact.
  - **Covered by:** R15, R16

---

## Requirements

**Search Surface**

- R1. The existing Forge global search modal must remain the canonical search UI for this feature.
- R2. With the Algolia flag off, the modal must keep the current semantic search result mix, including experiences.
- R3. With the Algolia flag on, the modal must show Algolia-backed Watch video results only.
- R4. The feature must not introduce or promote a new full `/videos`, `/search`, or `/watch/search` search page for v1.
- R5. Category clicks, typed queries, query URL hydration, load-more pagination, loading states, no-results states, and modal close behavior must continue to work in the modal.

**Algolia Results**

- R6. Flag-on searches must query the same Algolia app/index source as Core Watch, using Forge environment secrets supplied outside the repository.
- R7. Algolia result filtering must preserve Core's public Watch visibility intent: exclude `restrictViewPlatforms:watch`, require `published:true`, and require `videoPublished:true`.
- R8. Algolia hits must be transformed into Forge's existing search-card expectations, including title, slug, image, duration, label, child count where available, and stable id.
- R9. Algolia errors or missing configuration must not expose secrets or raw upstream details to the browser. The modal should show a safe search error and allow the rollout owner to restore semantic search by disabling the flag.

**Preferred Search Language**

- R10. The modal must derive a preferred search language from the strongest available signal, using explicit user selection first, then existing Forge language preference, route/audio language, browser language, and safe fallback to English.
- R11. Semantic search must use the derived preferred search language where Forge semantic search supports it, instead of hardcoding English for every search.
- R12. If the derived language has no supported semantic locale or no matching searchable language, the modal must fall back to the closest supported language, then English.
- R13. A user-selected search language must update the shared preferred search language. Semantic search uses the preferred language as its locale/default; Algolia can apply one or more selected languages as facets.

**Language Surface**

- R14. The modal must copy Core's region language behavior: users select languages, regions only group the options.
- R15. In flag-on Algolia mode, the language surface must support selecting multiple language refinements, showing selected language pills, removing individual selections, and clearing all selections.
- R16. The language surface must show likely country languages when a country signal is available and those languages exist in the available search facets.
- R17. Language refinements must use the Algolia `languageEnglishName` facet in flag-on mode.
- R18. Language selection must filter search results only. It must not change Forge UI locale, route locale, persisted audio preference, or the browser URL language segment by itself.

**Links and Routing**

- R19. Search result links must use Forge's public Watch route builders and public audio language slugs, not internal UI locale keys.
- R20. When a selected or result language can be mapped to a public audio slug, result links should prefer that slug. When no safe mapping exists, links must fall back to the current Forge default rather than generating invalid URLs.

**Rollout and Security**

- R21. The Algolia path must be hidden behind a server-evaluated Forge LaunchDarkly flag with a safe default-off environment fallback.
- R22. Algolia app id, search key, and index configuration must not be committed to the repo or exposed as browser-readable secrets.
- R23. The flag must be able to roll the modal back to semantic search without a deploy.
- R24. The implementation must not hand-edit generated GraphQL environment or type files.

---

## Acceptance Examples

- AE1. **Flag off with preferred Spanish**
  - **Given:** The Algolia flag is off and the viewer's best search language is Spanish.
  - **When:** The viewer searches from the modal.
  - **Then:** Forge semantic search runs with Spanish or the closest supported semantic locale and may return both videos and experiences.
  - **Covers:** R2, R10, R11, R12

- AE2. **Flag on with no language selected**
  - **Given:** The Algolia flag is on and Algolia configuration is present.
  - **When:** The viewer searches with no explicit language refinement.
  - **Then:** The modal returns Algolia Watch video results only, using Core's public Watch visibility filter.
  - **Covers:** R3, R6, R7

- AE3. **Selecting region-grouped languages**
  - **Given:** The Algolia flag is on and the language surface shows languages grouped under regions.
  - **When:** The viewer selects Spanish and French.
  - **Then:** Spanish and French are applied as language filters, selected pills appear, and no region is treated as selected.
  - **Covers:** R14, R15, R17, R18

- AE4. **Country language suggestion**
  - **Given:** A country signal resolves to a country with available top spoken languages.
  - **When:** The viewer opens the language surface.
  - **Then:** The modal offers those languages as selectable suggestions and applies a language filter only when the viewer chooses one.
  - **Covers:** R10, R16, R18

- AE5. **Algolia unavailable**
  - **Given:** The Algolia flag is on but the Algolia search request cannot complete.
  - **When:** The viewer searches.
  - **Then:** The modal shows a safe search error, does not expose secrets, and semantic search can be restored by disabling the flag.
  - **Covers:** R9, R21, R22, R23

---

## Success Criteria

- Flag-off search remains behaviorally compatible with the current Forge modal, apart from using a better search-language default.
- Flag-on search returns Core-compatible Algolia Watch video results inside the same modal.
- The language surface behaves like Core's regional search surface: multi-select languages, grouped by region, with likely country-language suggestions.
- No Algolia secret or server API key appears in browser bundles, page source, logs visible to users, or committed files.
- Result cards link to valid Forge Watch URLs using public audio language slugs.
- The rollout owner can turn the flag off and immediately return users to semantic search.

---

## Scope Boundaries

- Full `/videos` Algolia page parity is deferred.
- Blending Algolia video results with Forge semantic experience results while flag-on is out of v1 scope.
- Changing Core's Algolia index, ranking, synonyms, or indexing jobs is out of scope.
- Replacing Forge's modal UI with Core's full InstantSearch UI is out of scope.
- LaunchDarkly flag creation in the remote LaunchDarkly dashboard is outside the code artifact unless the rollout owner provides credentials and asks for it.
- Large search relevance evaluation work is deferred; v1 success is parity and safe rollout, not ranking optimization.

---

## Dependencies / Assumptions

- Forge will receive environment secrets for the same Algolia app/index endpoint Core Watch uses.
- The Algolia key used by Forge must be valid for server-side search from Forge's deployed environment.
- Forge can use admin language metadata or an equivalent read model to map languages to regions, countries, public audio slugs, and labels.
- Browser language, existing Forge language preference, current route/audio language, and optional country signal are enough to derive a useful preferred search language.
- The existing semantic search API can accept a non-English locale or can safely fall back when it cannot.
- The existing LaunchDarkly server-side flag foundation in Forge is the right rollout mechanism.

---

## Outstanding Questions

**Deferred to Planning**

- OQ1. Choose the exact Forge flag key and fallback environment variable name.
- OQ2. Decide whether the Algolia search path should use direct server-side REST, a small internal adapter, or another existing Forge server-action pattern.
- OQ3. Confirm the exact mapping from Algolia `languageEnglishName` values to Forge public audio language slugs when names are ambiguous or have variants.
- OQ4. Confirm whether Forge already has an acceptable country signal in production, or whether v1 should show language suggestions only from existing preference, route, and browser-language signals.

---

## Sources / Research

- Core Watch floating search entry: `.tmp/core/apps/watch/src/components/SearchComponent/SearchComponent.tsx`
- Core Watch modal language dropdown: `.tmp/core/apps/watch/src/components/SearchComponent/LanguageSelector/LanguageSelector.tsx`
- Core shared region language surface: `.tmp/core/libs/journeys/ui/src/components/SearchBar/SearchBar.tsx`
- Core region groups: `.tmp/core/libs/journeys/ui/src/components/SearchBar/SearchDropdown/RefinementGroups/RefinementGroups.tsx`
- Core language checkbox behavior: `.tmp/core/libs/journeys/ui/src/components/SearchBar/SearchDropdown/RefinementGroups/RefinementGroup/RefinementGroup.tsx`
- Core country language suggestions: `.tmp/core/libs/journeys/ui/src/components/SearchBar/SearchDropdown/CountryLanguageSelector/CountryLanguageSelector.tsx`
- Core selected language pills: `.tmp/core/libs/journeys/ui/src/components/SearchBar/LanguageButtons/LanguageButtons.tsx`
- Core Algolia search provider and `languageEnglishName` facet: `.tmp/core/libs/journeys/ui/src/libs/algolia/SearchBarProvider/SearchBarProvider.tsx`
- Core Algolia video hook and hit shape: `.tmp/core/libs/journeys/ui/src/libs/algolia/useAlgoliaVideos/useAlgoliaVideos.ts`
- Core Watch visibility filters: `.tmp/core/libs/journeys/ui/src/libs/algolia/useAlgoliaVideos/searchConfigure.ts`
- Core Algolia video transform: `.tmp/core/apps/watch/src/libs/algolia/transformAlgoliaVideos/transformAlgoliaVideos.ts`
- Forge global search modal provider: `apps/web/src/components/FloatingSearchProvider.tsx`
- Forge search overlay: `apps/web/src/components/SearchOverlay.tsx`
- Forge semantic search action: `apps/web/src/lib/search-actions.ts`
- Forge semantic search query: `apps/web/src/lib/search.ts`
- Forge feature flag foundation: `apps/web/src/lib/feature-flags.ts`, `packages/feature-flags/src/registry.ts`
- Forge public language and route helpers: `apps/web/src/lib/locale.ts`, `apps/web/src/lib/routes.ts`
- Prior Forge search modal requirements: `docs/brainstorms/2026-04-20-web-floating-search-redesign-requirements.md`
- Algolia server-key integration note: `docs/solutions/integration-issues/algolia-server-key-vs-public-key-cross-domain-20260430.md`
