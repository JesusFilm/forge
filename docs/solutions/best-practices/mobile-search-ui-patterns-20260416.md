---
title: "Mobile search UI patterns: stale guards, delayed skeletons, and experience selection"
date: 2026-04-16
category: best-practices
module: apps/mobile
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - Adding search or async data-fetching UI to the mobile app
  - Using getApolloClient().query() for imperative GraphQL calls
  - Implementing debounced search with pagination
tags:
  - mobile
  - search
  - apollo-client
  - stale-response-guard
  - delayed-skeleton
  - animation
  - experience-selection
---

# Mobile search UI patterns: stale guards, delayed skeletons, and experience selection

## Context

Building the mobile semantic search UI (feat-012) required solving several async state management challenges in React Native that don't exist in the web overlay implementation. The mobile search lives inside a tab (Discover) rather than a modal overlay, uses `getApolloClient().query()` directly instead of React hooks like `useLazyQuery`, and navigates by updating the active experience in `ExperienceSelectionProvider` rather than pushing a route.

## Guidance

### Use `getApolloClient().query()` instead of `useLazyQuery` for search

Apollo's `useLazyQuery` with `fetchMore()` replaces cache entries instead of appending — pagination silently drops page 1 when page 2 arrives. Use `getApolloClient().query()` with `fetchPolicy: "no-cache"` and manage results in local `useState` instead.

```typescript
const result = await getApolloClient().query({
  query: SEMANTIC_SEARCH,
  variables: { query: trimmed, locale: "en", limit: 20, offset: 0 },
  fetchPolicy: "no-cache",
})
```

### Guard the `finally` block with requestIdRef for search, but NOT for loadMore

The `requestIdRef` pattern (increment on each search, compare in response handler) works well for primary search. But `loadMore`'s `finally` block must **unconditionally** clear `loadingMore` — otherwise, if a new search fires while pagination is in-flight, the guard prevents cleanup and `loadingMore` stays `true` forever, permanently breaking pagination.

```typescript
// search: guard the finally block
finally {
  if (requestIdRef.current === thisRequest) {
    setLoading(false)
  }
}

// loadMore: always clear loadingMore
finally {
  setLoadingMore(false)  // unconditional — never leave this stuck
}
```

### Add a stale check after `await animateOut()`

If the search function awaits an exit animation before fetching, a second search can fire during the animation's 150ms. Add a stale check immediately after the await to prevent the superseded search from setting loading state:

```typescript
const thisRequest = ++requestIdRef.current
if (results.length > 0) await animateOut()
if (requestIdRef.current !== thisRequest) return // another search fired during animation
setLoading(true)
```

### Delayed skeleton: timer cleanup matters

The 500ms skeleton delay timer must be cleaned up in three places:

1. In the `finally` block of search (when the request owns the current requestId)
2. In a `useEffect` cleanup on component unmount
3. Before starting a new skeleton timer (clear the old one first)

### Navigate via `selectExperience()` + tab switch, not a pushed route

When search results load experiences, don't push to `/experience/[slug]` — this creates a nested `ExperienceProvider` that breaks video navigation (sibling Stack screens can't see each other's providers). Instead, call `selectExperience(slug)` and navigate to the Home tab:

```typescript
const handleSelectResult = useCallback(
  (slug: string) => {
    selectExperience(slug)
    router.navigate("/(tabs)")
  },
  [selectExperience, router],
)
```

This reuses the existing `ExperienceShell` pipeline so all SDUI section types render correctly, including video playback.

## Why This Matters

These patterns prevent three categories of production bugs:

- **Stuck UI state**: `loadingMore` permanently true, "Load more" button frozen
- **Visual glitches**: skeleton flashing after results are already displayed, stale results appearing briefly
- **Broken navigation**: video playback failing from search-loaded experiences due to provider hierarchy

## When to Apply

- Adding any new async data-fetching screen to the mobile app
- Implementing pagination with `getApolloClient().query()`
- Adding exit/entry animations to data-driven lists
- Navigating between experiences from any context outside the Home tab

## Examples

The full implementation is in `apps/mobile/app/(tabs)/watch.tsx` (search screen) and `apps/mobile/src/components/search/SearchResultCard.tsx` (cinematic card with staggered pop-in animation).

The web equivalent is in `apps/web/src/components/SearchOverlay.tsx` — same `requestIdRef` pattern but using `client.query()` in a modal overlay context.

## Related

- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` — web search overlay patterns (requestIdRef, Tailwind animation purging)
- `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md` — Apollo Client patterns for mobile (cache-and-network, lazy init)
- `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md` — slug encoding for Expo Router
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` — gradient banding fix with hexToRgba
