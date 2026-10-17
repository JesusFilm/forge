---
title: "Mobile search UI patterns: stale guards, delayed skeletons, and result navigation"
date: 2026-04-16
last_updated: 2026-09-30
category: best-practices
module: apps/mobile
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - Adding search or async data-fetching UI to the mobile app
  - Using getApolloClient().query() for imperative GraphQL calls
  - Implementing debounced search with pagination
  - Adding a loading flag that a newer request can make stale
  - Opening an Experience from a search result or another surface outside the Home tab
tags:
  - mobile
  - search
  - apollo-client
  - stale-response-guard
  - delayed-skeleton
  - load-more
  - experience-navigation
  - expo-router
---

# Mobile search UI patterns: stale guards, delayed skeletons, and result navigation

## Context

The mobile search screen is `DiscoverScreen` in `apps/mobile/app/(tabs)/watch.tsx:72`. It is the Discover tab, and its tab route name is `watch`. The first version came from feat-012. The screen calls `getApolloClient().query()` directly instead of a React hook, pages its results with a "Load more" footer, and opens each result with a route push.

This doc was refreshed on 2026-09-30. Two rules in the first version no longer match the code. The first rule said that `loadMore`'s `finally` must clear `loadingMore` unconditionally. The second rule said that a search result must not push `/experience/[slug]`. The sections below state the current rules.

## Guidance

### 1. Use `getApolloClient().query()` with `no-cache` for search and load more

Both the first search and each "Load more" page send `WATCH_SEARCH` with `fetchPolicy: "no-cache"`, and keep the results in local `useState` (`apps/mobile/app/(tabs)/watch.tsx:395-407`, `:541-553`). The original rationale from the feat-012 build is this: Apollo's `useLazyQuery` with `fetchMore()` replaces cache entries instead of appending, so page 1 silently drops when page 2 arrives. That rationale was not tested again on 2026-09-30.

```typescript
const result = await getApolloClient().query({
  query: WATCH_SEARCH,
  variables: {
    input: buildWatchSearchInput({
      query: trimmed,
      clientRequestId: searchRequestId,
      limit: PAGE_SIZE,
      offset: 0,
    }),
  },
  fetchPolicy: "no-cache",
  context: { fetchOptions: { signal } },
})
```

- Take the next page's offset from the server. Admin owns the page cursor, because mapping can drop rows, so `results.length` is not a valid offset (`apps/mobile/app/(tabs)/watch.tsx:178-180`). `loadMore` sends `offset: nextOffset` (`:548`).
- Abort a superseded search. `search()` aborts the previous `AbortController` and makes a new one (`:351-353`). The signal goes through `context.fetchOptions` (`:406`, `:552`). The abort only stops the cost of the old request. The generation guard below is what discards its result (`:218-220`).

### 2. Guard every async step with a generation counter

`search()` increments `requestIdRef` as its first step, also for an empty query (`apps/mobile/app/(tabs)/watch.tsx:334-337`). Without this, a stale result can land over the browse grid after the viewer clears the input. Each step after an `await` then compares the counter with its own value:

- after the exit animation (`:369-375`),
- after the query returns (`:409`),
- in the `catch` block (`:461`),
- in the `finally` block (`:483-488`).

The exit animation runs for 150 ms (`:295-311`). A second search can start during that time, so do the check right after the `await`:

```typescript
if (results.length > 0) {
  await animateOut()
}
// Another search may have started during the exit animation.
if (requestIdRef.current !== thisRequest) return
setLoading(true)
```

### 3. Load more: page the visible generation, and release the pager from the code that makes it stale

The rule is this: the code that makes a request stale must release that request's loading flags. Do not rely only on the stale request's own `finally`. The current code applies the rule in four parts.

1. **`search()` frees the pager when it bumps the generation.** It calls `releaseLoadingMore()` right after the increment (`apps/mobile/app/(tabs)/watch.tsx:337-341`). `releaseLoadingMore` clears the reveal fallback timer, `awaitingRevealRef`, `loadingMoreRef`, and the `loadingMore` state (`:238-248`). `search()` also retires the pager before any `await`: it sets `submittedTermRef.current = ""` and `setHasMore(false)` (`:346-350`). This stops a tap on the fading footer from paging the old term.
2. **`loadMore` pages the SUBMITTED generation, not the live one.** `submittedRequestIdRef` holds the generation that produced the visible results, and only a successful search sets it (`:203-206`, `:422`). `loadMore` returns when a newer search is in flight (`:526`) and uses the submitted generation as its own value (`:530`). It also pages `submittedTermRef.current`, not the live input, which can change during the debounce window (`:200-202`, `:536`).
3. **A synchronous ref latches against a double press.** The `loadingMore` state is a render-time snapshot, so two presses in one frame both read `false`. `loadingMoreRef` closes that gap (`:207-209`, `:527-528`).
4. **`loadMore`'s `finally` releases only for the owning generation, and only when no page waits for its reveal** (`:620-627`). A page that appended rows releases when its first row lays out (`handleBatchRevealed`, `:633-635`), or when the `REVEAL_FALLBACK_MS` timer fires (`:574-579`).

```typescript
// search()
const thisRequest = ++requestIdRef.current
// The bump orphans an in-flight page, so its guarded finally cannot free the pager.
releaseLoadingMore()
```

```typescript
// loadMore()
if (submittedRequestIdRef.current !== requestIdRef.current) return
if (loadingMoreRef.current || !hasMore) return
loadingMoreRef.current = true
const thisRequest = submittedRequestIdRef.current
// ...
} finally {
  if (requestIdRef.current === thisRequest && !awaitingRevealRef.current) {
    loadingMoreRef.current = false
    setLoadingMore(false)
  }
}
```

The first version of this doc cleared `loadingMore` unconditionally in the `finally`. That rule prevented a stuck footer, but it also let the footer report "done" while the appended rows were still invisible. `docs/solutions/ui-bugs/search-load-more-footer-disappears-before-appended-rows-render.md` records that defect and the reveal latch that replaced the rule.

### 4. Delayed skeleton: clear the timer on every exit

The skeleton shows only when a search takes longer than `SKELETON_DELAY_MS = 500` (`apps/mobile/app/(tabs)/watch.tsx:69`). Clear the timer in four places:

1. Before you start a new timer (`:382-386`).
2. In the `finally` block, for the owning generation only, together with `setShowSkeleton(false)` (`:483-488`).
3. On the empty-query path (`:362-363`).
4. In the unmount cleanup (`:229-236`).

### 5. Open results with a route push, and point the root provider at an Experience

For an `EXPERIENCE` result, `handleSelectResult` calls `selectExperience(result.slug)` and then pushes the encoded slug (`apps/mobile/app/(tabs)/watch.tsx:147-150`):

```typescript
if (result.type === "EXPERIENCE") {
  selectExperience(result.slug)
  router.push(`/experience/${encodeURIComponent(result.slug)}`)
  return
}
```

The pushed screen does not mount its own provider. It points the ROOT `ExperienceProvider` at its slug (`apps/mobile/app/experience/[slug].tsx:18-20`, `:28-34`):

```typescript
useEffect(() => {
  if (decodedSlug !== "" && currentSlug !== decodedSlug) {
    selectExperience(decodedSlug)
  }
}, [decodedSlug, currentSlug, selectExperience])
```

- **Keep one provider at the root.** `ExperienceShell` wraps the root `Stack` (`apps/mobile/app/_layout.tsx:372-375`) and mounts the `ExperienceProvider` (`apps/mobile/src/contexts/ExperienceShell.tsx:39-76`). `/video/[sectionKey]` and `/collection/[sectionKey]` read that provider through `useSectionByKey` (`apps/mobile/app/video/[sectionKey].tsx:44`, `apps/mobile/app/collection/[sectionKey].tsx:77`, `apps/mobile/src/contexts/ExperienceProvider.tsx:132-135`). Those routes are siblings of the experience screen in the root `Stack`, not its children. A provider inside the experience screen cannot reach them.
- **Render only the slug's own experience.** The screen renders `CuratedHomeLayout` only when the provider's experience has this slug. Until then it shows a spinner, an error, or an empty state (`apps/mobile/app/experience/[slug].tsx:36-80`).
- **Encode every slug in a route push.** Both pushes in `handleSelectResult` use `encodeURIComponent` (`apps/mobile/app/(tabs)/watch.tsx:149`, `:169`), and the experience screen decodes the param (`apps/mobile/app/experience/[slug].tsx:23`).
- **Carry seed data for a video or series result.** `encodeWatchSeed` packs the slug, title, image, and playback id (`apps/mobile/app/(tabs)/watch.tsx:153-158`). `isSeriesSearchResult` picks the `series` or `watch` route (`:159-161`). A `watch` result marks its playback discovery source as `search` (`:165`). A `series` result adds `&${DISCOVERY_ROUTE_PARAM}=search` to the route (`:166-170`).
- **Keep telemetry out of the navigation path.** The click telemetry runs inside a `try` block, so a throw there cannot stop the push (`:115-146`).

The first version of this doc used `router.navigate("/(tabs)")` after `selectExperience`. That call is correct from a tab screen such as Discover. From a ROOT-STACK screen, the same call pushes a second tab navigator. Use `router.dismissTo("/(tabs)")` there.

## Why This Matters

These patterns prevent these classes of defect:

- **Stuck UI state.** If nothing releases the pager after a superseding search, "Load more" stays on "Loading..." for the rest of the session (`apps/mobile/app/(tabs)/watch.tsx:338-340`).
- **Wrong or doubled results.** A page that borrows the live generation can pass the stale guard and append to the wrong results (`:203-205`). Two presses in one frame can append the same page twice (`:207-209`). A stale response can land over the browse grid after a clear (`:334-336`).
- **Visual glitches.** A skeleton timer that is not cleared shows a skeleton over results that are already on screen. A footer released on fetch completion reports "done" over a blank gap.
- **Empty section routes and the wrong experience.** The experience screen and the `/video/[sectionKey]` and `/collection/[sectionKey]` routes all read the one root provider. When the pushed screen points that provider at its slug, the section routes pushed from it keep working (`apps/mobile/app/experience/[slug].tsx:18-20`). The slug check stops the screen from showing the previous experience while the new one loads (`:36-41`).
- **A broken back stack.** `router.navigate("/(tabs)")` from a root-stack screen leaves a second tab navigator on the stack, and a back gesture returns to the screen the viewer left.

## When to Apply

- Adding any new async data-fetching screen to the mobile app.
- Implementing pagination with `getApolloClient().query()`.
- Adding a loading flag whose request a newer request can supersede.
- Adding exit or entrance animations to data-driven lists.
- Opening an Experience from a search result or another surface outside the Home tab: push `/experience/<encoded slug>` and let that screen point the root provider at the slug.
- Returning to the tabs from a root-stack screen: use `router.dismissTo("/(tabs)")`, not `router.navigate("/(tabs)")`.

## Examples

- **Search screen:** `apps/mobile/app/(tabs)/watch.tsx`. The line references in each section above point to it.
- **Result card:** `apps/mobile/src/components/search/SearchResultCard.tsx`. Each card mounts at opacity 0 and scale 0.92 (`:58-59`), pins its entrance delay at mount (`:62`), and calls `onAppear` one time from `onLayout` (`:63-69`, `:95`).
- **Entrance timing:** `apps/mobile/src/components/search/searchEntrance.ts`. `entranceDelayMs` staggers from the first index of each batch, with a cap of 8 steps (`:15-24`). `REVEAL_FALLBACK_MS` sits above a full batch's entrance (`:31-32`).
- **Experience screen:** `apps/mobile/app/experience/[slug].tsx`.
- **Web overlay:** `apps/web/src/components/SearchOverlay.tsx` no longer has a `requestIdRef`. Its suggestion fetches use a generation counter, `suggestionGenerationRef` (`:281`). A layout effect increments it for each new request key (`:436-438`), and `invalidateSuggestionRequest` increments it and clears the loading flag (`:292-297`). Each effect run makes its own `AbortController` and aborts it in the cleanup (`:443`, `:474-478`). The debounce callback and the `then`, `catch`, and `finally` handlers each check the generation before they write state (`:447-470`).

## Related

- `docs/solutions/ui-bugs/search-load-more-footer-disappears-before-appended-rows-render.md` — why `loadMore`'s `finally` became conditional: the reveal latch, the fallback timer, and the batch-relative entrance stagger.
- `docs/solutions/logic-errors/expo-router-navigate-to-tabs-from-root-stack-pushes-duplicate-navigator.md` — a return to the tabs from a ROOT-STACK screen must use `router.dismissTo("/(tabs)")`, because `router.navigate("/(tabs)")` there pushes a second tab navigator. The Discover tab is a tab screen, so its own navigation does not have this problem.
- `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md` — slug encoding for Expo Router dynamic routes.
- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` — web search overlay patterns from the first web build (requestIdRef, Tailwind animation purging).
- `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md` — Apollo Client patterns for mobile (cache-and-network, lazy init).
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` — gradient banding fix with `hexToRgba`.
