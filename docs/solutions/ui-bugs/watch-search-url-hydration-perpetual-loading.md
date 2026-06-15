---
title: "Watch search URL hydration can strand the overlay in loading"
date: "2026-06-15"
category: "ui-bugs"
module: "apps/web watch search"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Opening `/watch?q=jesus` can show the search overlay and skeleton cards indefinitely."
  - "Production `/watch` server-action POSTs can return 200 while the UI never renders result cards."
  - "Typed searches from the already-open overlay can recover, proving the backend search path is not the only failure point."
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
  - "url-hydration"
  - "router-replace"
  - "loading-state"
  - "skeleton"
  - "app-router"
---

# Watch search URL hydration can strand the overlay in loading

## Problem

The Watch search page could open directly at a query URL, such as `/watch?q=jesus`, display the modal with skeleton result cards, and never show results. The backend was not simply timing out: browser-level production tracing showed the page-level client flow could call language metadata, dispatch an App Router navigation for an already-synced URL, and fail to reach the real `runSearch` action for the hydrated query.

## Symptoms

- The page showed the search overlay, focused input, and pulsing skeleton cards for many minutes.
- Server-action POSTs returned HTTP 200, but the initial direct URL path only called `getSearchLanguageOptions`.
- Typing a new query in the overlay later issued `runSearch` and rendered result cards.
- Clearing or superseding a pending search could leave `loading` and `showSkeleton` latched if the stale request was invalidated before its cleanup ran.

## What Didn't Work

- **Endpoint-only probing.** Calling isolated server actions showed they could return successfully, but it missed the App Router and client state transition that stranded the web page.
- **Waiting longer.** The observed failure could sit for 10 minutes because the UI was stuck in client state, not waiting for a normal request timeout.
- **Blaming search ranking or Algolia fallback.** Later typed searches returned results, so ranking and backend result rendering were not the primary blocker.
- **Checking only HTTP status.** The relevant question was not whether a server-action POST returned 200, but whether the page-level hydration flow reached `runSearch` and cleared the active skeleton state.

## Solution

Keep URL synchronization in the search controller, but skip `router.replace()` when the target URL is identical to the current browser URL. Compare the canonical search URL built by the shared helper with the current app-relative URL:

```ts
function buildCurrentSearchUrl(
  pathname: string,
  currentParams: URLSearchParams,
): string {
  const serializedParams = currentParams.toString()
  return serializedParams.length > 0 ? `${pathname}?${serializedParams}` : pathname
}

const nextUrl = buildSearchUrl(pathname, currentParams, trimmed)
if (nextUrl !== buildCurrentSearchUrl(pathname, currentParams)) {
  router.replace(nextUrl as Route)
}
```

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
- Changed queries still call `router.replace` and preserve unrelated params.
- Clearing search removes `q` without calling `runSearch`.
- Resetting an in-flight search clears `loading` and `showSkeleton`.
- A stale search resolving after a newer search starts does not clear the active loading state.

## Why This Works

In a Next.js App Router page, `router.replace()` is not a harmless assignment. Even a same-URL replacement can start client navigation and RSC work around the same time the lazily mounted search controller is hydrating from `?q=`.

The direct query URL already contains the intended search state, so replacing it with itself gives the router a chance to interrupt the flow without adding any user value. Guarding the no-op replacement lets the hydration search continue to `runSearch`.

The loading fix follows the controller's existing request-id model. Every search increments `requestIdRef`; only the currently winning request can clear `loading`, `showSkeleton`, and the skeleton timer. Empty-query reset is also a valid winning request, so it must run the same cleanup instead of invalidating the older request and returning with skeletons still visible.

## Prevention

- Reproduce search bugs through the web page, not just one-off server-action probes. For App Router UI bugs, network success can coexist with broken client state.
- Treat `router.replace()` as a navigation side effect. Before calling it from a hydrated overlay or modal, prove the target URL differs from the current URL.
- Keep delayed skeleton timers paired with request-id cleanup. A reset path that increments the request id must also clear the active timer and loading flags.
- Test both sides of URL sync guards: no-op URLs must not navigate, changed URLs still must navigate.
- Isolate URL-sync tests from mount hydration by mounting without `q`, then changing `window.history` immediately before the user action being tested.

## Related Issues

- [Forge Algolia Search Modal Pattern](../architecture-patterns/forge-algolia-search-modal-20260610.md)
- [Watch search overlay page size mismatch](../logic-errors/watch-search-overlay-page-size-mismatch.md)
- [Watch Staged Client Loading](../performance-issues/watch-staged-client-loading-20260611.md)
- [Next.js search overlay UI patterns](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md)
- [Queueing a user action across a Suspense boundary re-key in Next.js App Router](../best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md)
