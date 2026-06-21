---
title: "Watch semantic search must wait for language metadata before query-language confirmation"
date: "2026-06-19"
last_updated: "2026-06-19"
category: "ui-bugs"
module: "apps/web watch semantic search"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "A long non-English semantic query can search before the detected-language confirmation appears."
  - "The first search can use the route, browser, or English fallback even though the typed query is in another supported language."
  - "Tests with already-resolved language metadata pass while the delayed-metadata path remains unprotected."
  - "Load more can fetch the next page with a different semantic language after metadata refresh changes the selected/default option."
  - "A hung language-metadata request can strand semantic search if readiness has no bounded fallback."
root_cause: "async_timing"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/SearchOverlay.tsx"
  - "apps/web/src/components/FloatingSearchController.tsx"
  - "apps/web/src/components/FloatingSearchContext.tsx"
  - "apps/web/src/lib/search-query-language.ts"
tags: [watch, semantic-search, language, debounce, metadata, i18n, race]
---

# Watch semantic search must wait for language metadata before query-language confirmation

## Problem

The semantic Watch search overlay detects the language of a typed query and asks the viewer to confirm before searching in that detected language. Detection depends on the Admin language metadata list, so a query typed before that list loads can otherwise debounce into a search using the current default language.

That violates the multilingual search rule: the app should only switch to the typed query's language after confirmation.

The same state boundary also affects pagination. Once a semantic result set is created, "load more" must keep using the exact language slug that produced the first page, even if language metadata finishes loading or the default language ref changes afterward.

## Symptoms

- Typing a long Spanish query while language metadata is still pending can skip the "Spanish detected" confirmation.
- The debounced search can call `runSearch` with the selected/default language instead of `languageSlug: "spanish-castilian"`.
- The issue is invisible in tests that mock `getSearchLanguageOptions` as already resolved.
- The server action's own metadata refresh is not enough, because the active semantic language slug is selected before that await.
- The next-page request can drift from the initial request when pagination reads the latest selected language instead of the active result-set signature.
- If metadata never reaches a terminal state, the overlay can keep holding the pending query instead of falling back to a searchable default.

## What Didn't Work

- **Only testing the loaded-metadata path.** A test where language options are present at first input proves the detector branch, but it does not prove the race where the input event happens first.
- **Relying on `search()` to refresh language options.** `FloatingSearchController.search()` computes the active language slug before it awaits `refreshLanguageOptions()`, so the later metadata cannot retroactively make the original search Spanish.
- **Treating an empty language list as "not ready."** A production response may legitimately be loaded-but-empty or error into fallback behavior. The overlay needs an explicit loaded flag, not an inference from `options.length`.
- **Letting pagination re-read current language state.** The language chip/default can change after the first page, so load-more requests must use the original result-set language slug.
- **Waiting indefinitely for metadata.** Metadata improves suggestions and manual selection, but search should still work if that request hangs or fails.

## Solution

Expose language metadata readiness from the controller and let the overlay hold a pending semantic search until metadata has reached a terminal state or a short fallback timer fires. The important distinction is loaded vs not loaded, not whether the option array has items.

```tsx
const [languageOptionsLoaded, setLanguageOptionsLoaded] = useState(false)

// In refreshLanguageOptions()
finally {
  if (languageOptionsRequestIdRef.current === thisRequest) {
    setLanguageOptionsLoaded(true)
    setLanguageOptionsLoading(false)
  }
}
```

Then gate the overlay debounce on that readiness plus a bounded fallback:

```tsx
const pendingSearchAfterLanguageLoadRef = useRef<string | null>(null)
const semanticSearchEnabled = !algoliaSearchEnabled
const languageOptionsReadyForSearch =
  !semanticSearchEnabled ||
  languageOptionsLoaded ||
  languageMetadataFallbackReady

useEffect(() => {
  if (!open || !semanticSearchEnabled || languageOptionsLoaded) return
  const fallbackTimer = setTimeout(() => {
    setLanguageMetadataFallbackReady(true)
  }, SEARCH_LANGUAGE_METADATA_FALLBACK_MS)
  return () => {
    clearTimeout(fallbackTimer)
    setLanguageMetadataFallbackReady(false)
  }
}, [languageOptionsLoaded, open, semanticSearchEnabled])

useEffect(() => {
  if (!languageOptionsReadyForSearch) return
  const pendingQuery = pendingSearchAfterLanguageLoadRef.current
  if (pendingQuery == null || pendingQuery !== query) return

  pendingSearchAfterLanguageLoadRef.current = null
  if (pendingQuery.trim().length === 0) return
  if (
    semanticSearchEnabled &&
    maybeDetectQueryLanguageSuggestion(pendingQuery)
  ) {
    return
  }

  debounceRef.current = setTimeout(() => {
    void search(pendingQuery)
  }, 300)
}, [
  languageOptionsReadyForSearch,
  maybeDetectQueryLanguageSuggestion,
  query,
  search,
  semanticSearchEnabled,
])
```

On input, store the pending query instead of searching while metadata is not ready:

```tsx
if (!languageOptionsReadyForSearch) {
  pendingSearchAfterLanguageLoadRef.current = newValue
  return
}
```

When metadata arrives, the effect re-runs detection with the real language options. If the query language is detected, the confirmation CTA appears and no search fires. If no suggestion is available, the debounced search resumes with normal fallback behavior.

Lock the race with a test that leaves `getSearchLanguageOptions` unresolved, types a detectable query, advances the debounce, and asserts that no search happened until metadata resolves and the confirmation is clicked.

The controller still protects direct search calls by doing a bounded metadata refresh before `runSearch`:

```tsx
const currentLanguageOptions = languageOptionsLoadedRef.current
  ? languageOptionsRef.current
  : await withSearchLanguageOptionsFallback(
      refreshLanguageOptions(facets),
      () => languageOptionsRef.current,
    )
```

When the result set is created, record the resolved language identity in the active search signature:

```tsx
activeSearchSignatureRef.current = {
  query: data.query,
  resultSource: data.resultSource,
  languageEnglishNames: activeLanguageEnglishNames,
  languageSlug: signatureLanguageSlug,
  routeLanguageSlug,
  nextOffset,
}
```

Then load more must reuse `expectedSignature.languageSlug` and `expectedSignature.languageEnglishNames`, not whatever the language chip or default ref says later. Tests should cover a metadata refresh between the first page and "load more" and assert the second request keeps the original semantic language slug.

## Why This Works

Query-language detection is a client-side affordance that needs the same metadata as the manual language switcher. Without an explicit readiness flag, the overlay cannot tell "metadata has not loaded yet" apart from "metadata loaded with no options," and it may schedule search before it has enough information to decide whether confirmation is required.

The pending-search ref keeps the user's latest query across the metadata boundary without dispatching stale searches. Clearing the ref on explicit actions such as category selection, manual language selection, confirmation, and clear input prevents a delayed metadata response from replaying an outdated intent.

The fallback timer prevents metadata from becoming a hard availability dependency. If Admin language metadata is slow, semantic search can still run with route, browser, or English fallback; if metadata later arrives and the user continues typing, detection and manual selection can use the richer option set.

The active search signature makes pagination deterministic. "Load more" is part of the same search, so it should inherit the first page's language slug, route language, result source, and offset instead of recomputing language from mutable UI state.

## Prevention

- Add delayed-metadata tests for UI paths where metadata controls whether an action is allowed, not only what label is shown.
- Prefer explicit `loaded` state over inferring readiness from `loading` plus `options.length`; empty successful responses and fallback errors need to remain searchable.
- Bound metadata waits so optional autocomplete/suggestion metadata cannot block search availability forever.
- Include semantic language slug and route language in the active search signature for pagination and stale-response guards.
- Keep semantic language identity on public language slugs, not BCP-47 tags. BCP-47 is for locale fallback and Admin query locale, not for exact language identity.
- Verify Watch search races through the page-level overlay, not only by calling server actions directly. The failure can live in the debounce and client state even when the server action itself works.
- Shape local browser mocks to the actual Admin GraphQL operation so smoke tests prove the production contract, not just a convenient branch.

## Related Issues

- [Key language identity on the unique slug, not BCP-47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
- [Forge Algolia Search Modal Pattern](../architecture-patterns/forge-algolia-search-modal-20260610.md)
- [Watch search URL sync can strand the overlay in loading](watch-search-url-hydration-perpetual-loading.md)
- [Mocked-shape-vs-real-contract testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
- [Mastra offline search eval orchestration boundary pattern](../architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md)
