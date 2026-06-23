---
title: "Watch search URL sync can strand the overlay in loading"
date: "2026-06-15"
last_updated: "2026-06-23"
category: "ui-bugs"
module: "apps/web watch search"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Opening `/watch?q=jesus` can show the search overlay and skeleton cards indefinitely."
  - "Editing a successful search into a second query can leave the URL behind the input and keep skeleton cards visible."
  - "Production `/watch` server-action POSTs can return 200 while the UI never renders result cards."
  - "The browser can post language metadata for the partial query without ever posting the final `runSearch` payload."
  - "Edited searches can update the visible `?q=` parameter while the real `runSearch` action never fires."
root_cause: "async_timing"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/web/src/components/FloatingSearchController.tsx"
  - "apps/web/src/components/FloatingSearchProvider.tsx"
  - "apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx"
  - "apps/web/src/lib/search-url.ts"
tags:
  - "web"
  - "watch"
  - "search"
  - "url-sync"
  - "app-router"
  - "router-replace"
  - "history-replace-state"
  - "loading-state"
---

# Watch search URL sync can strand the overlay in loading

## Problem

The Watch search page could open directly at a query URL, such as `/watch?q=jesus`, display the modal with skeleton result cards, and never show results. A second production path showed the same class of failure after a successful search: search `jesus`, edit the active input to `the bible proj`, pause past debounce, then type `ect`. The input showed `the bible project`, the URL stayed at `?q=the+bible+proj`, skeleton cards remained, and no final results rendered.

The backend was not simply timing out. Browser-level production tracing showed page-level client flow could post language metadata and return HTTP 200 while failing to reach the real `runSearch` action for the user-visible final query.

## Symptoms

- The page showed the search overlay, focused input, and pulsing skeleton cards for many minutes.
- Server-action POSTs returned HTTP 200, but the initial direct URL path only called `getSearchLanguageOptions`.
- Typing a new query in the overlay later issued `runSearch` and rendered result cards.
- After a successful first search, an intermediate edited query could update the URL and start skeletons while the final input value never reached `runSearch`.
- Clearing or superseding a pending search could leave `loading` and `showSkeleton` latched if the stale request was invalidated before its cleanup ran.

## What Didn't Work

- **Endpoint-only probing.** Calling isolated server actions showed they could return successfully, but it missed the App Router and client state transition that stranded the web page.
- **Waiting longer.** The observed failure could sit for 10 minutes because the UI was stuck in client state, not waiting for a normal request timeout.
- **Blaming search ranking or Algolia fallback.** Later typed searches returned results, so ranking and backend result rendering were not the primary blocker.
- **Checking only HTTP status.** The relevant question was not whether a server-action POST returned 200, but whether the page-level hydration flow reached `runSearch` and cleared the active skeleton state.
- **Testing only direct `?q=` hydration.** That proved the first URL-open path, but missed the post-success edit path where a changed-query navigation could remount the overlay and clear a newer debounce timer.

## Solution

Keep URL synchronization in the search controller, but do not use Next App Router navigation for modal-owned `?q=` edits. The search modal uses `?q=` as client UI state, so update the visible URL with `window.history.replaceState()` while passing through `window.history.state`. That preserves Next's existing App Router history metadata instead of replacing it with `null`.

```ts
function buildCurrentSearchUrl(
  pathname: string,
  currentParams: URLSearchParams,
): string {
  const serializedParams = currentParams.toString()
  return serializedParams.length > 0
    ? `${pathname}?${serializedParams}`
    : pathname
}

const browserPathname =
  typeof window !== "undefined" ? window.location.pathname : pathname
const nextUrl = buildSearchUrl(browserPathname, currentParams, trimmed)
if (nextUrl !== buildCurrentSearchUrl(browserPathname, currentParams)) {
  try {
    window.history.replaceState(window.history.state, "", nextUrl)
  } catch (error) {
    console.warn("[FloatingSearch] failed to sync search URL", error)
  }
}
```

Use `window.location.pathname` for the browser-visible path so non-root public routes such as `/watch` stay intact when the query string changes.

The history call is best-effort. If the browser rejects it, the search should still continue to `runSearch`; URL state is less important than returning results.

Then make loading cleanup request-id-scoped and reusable so both normal completion and empty-query resets clear the active spinner without letting stale requests affect newer searches:

```ts
const clearLoadingForRequest = useCallback((requestId: number): void => {
  if (requestIdRef.current !== requestId) return
  if (skeletonTimerRef.current) {
    clearTimeout(skeletonTimerRef.current)
    skeletonTimerRef.current = null
  }
  setShowSkeleton(false)
  setLoading(false)
}, [])

if (!trimmed) {
  // clear results and reset search state...
  clearLoadingForRequest(thisRequest)
  return
}

try {
  // run search...
} finally {
  clearLoadingForRequest(thisRequest)
}
```

Lock the behavior with provider/controller tests:

- Direct `?q=jesus` hydration calls `runSearch` and does not call `router.replace` for the same URL.
- Changed queries sync `/watch?utm=campaign` to `/watch?q=jesus&utm=campaign`, preserve unrelated params, preserve a non-null `window.history.state`, use `history.replaceState`, do not call `history.pushState`, and do not call `router.replace`.
- Clearing search removes `q` without calling `runSearch`.
- Editing from a completed `jesus` search through an intermediate debounced query to `the bible project` still calls `runSearch` for the final query and clears the pulsing skeleton cards.
- A thrown `history.replaceState` logs a warning but does not prevent `runSearch`.
- Resetting an in-flight search clears `loading` and `showSkeleton`.
- A stale search resolving after a newer search starts does not clear the active loading state.

## Why This Works

In a Next.js App Router page, `router.replace()` is not a harmless assignment. It can start client navigation and RSC work around the same time the search overlay is hydrating, exiting previous result cards, or holding a pending debounce for the user's next keystrokes.

The direct query URL already contains the intended search state, so replacing it with itself gives the router a chance to interrupt the flow without adding any user value. For changed queries, the URL update is still useful, but it does not need a server navigation because the modal's input and results are controlled client-side. Native `replaceState()` keeps the address bar shareable without remounting the overlay or clearing pending debounce timers. Preserving `window.history.state` keeps framework/browser state attached to the current entry, using `replaceState` avoids creating a new back-button entry for every debounced query, and catching failures prevents a best-effort URL write from aborting the user-visible search.

The loading fix follows the controller's existing request-id model. Every search increments `requestIdRef`; only the currently winning request can clear `loading`, `showSkeleton`, and the skeleton timer. Empty-query reset is also a valid winning request, so it must run the same cleanup instead of invalidating the older request and returning with skeletons still visible.

## Prevention

- Reproduce search bugs through the web page, not just one-off server-action probes. For App Router UI bugs, network success can coexist with broken client state.
- Treat `router.replace()` as a navigation side effect. Before calling it from a hydrated overlay or modal, prove that a server navigation is actually needed.
- For modal-owned URL state, prefer `window.history.replaceState(window.history.state, "", nextUrl)` so Next history metadata is preserved without dispatching RSC navigation.
- Keep URL sync best-effort. If history mutation throws, log it and continue the user action.
- Keep delayed skeleton timers paired with request-id cleanup. A reset path that increments the request id must also clear the active timer and loading flags.
- Test both sides of URL sync: no-op URLs must not navigate, changed modal query URLs must update browser history without App Router navigation, and edited-query regressions must prove skeletons are gone after final results render.
- Isolate URL-sync tests from mount hydration by mounting without `q`, then changing `window.history` immediately before the user action being tested.
- Keep URL helper comments transport-neutral. A helper used by native history updates should describe browser search URL sync, not `router.replace()` calls.
- Post-deploy smoke should inspect the page-level flow, not only final DOM: typing a broad query should produce a real search action POST, render result cards, and let Load more append without `Failed to load more results.`

## Related Issues

- [Forge Algolia Search Modal Pattern](../architecture-patterns/forge-algolia-search-modal-20260610.md)
- [Watch search overlay page size mismatch](../logic-errors/watch-search-overlay-page-size-mismatch.md)
- [Watch Staged Client Loading](../performance-issues/watch-staged-client-loading-20260611.md)
- [Next.js search overlay UI patterns](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md)
- [Queueing a user action across a Suspense boundary re-key in Next.js App Router](../best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md)
