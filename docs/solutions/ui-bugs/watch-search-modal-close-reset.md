---
title: "Watch search close paths must reset modal-owned state"
date: "2026-07-13"
category: "ui-bugs"
module: "apps/web watch search"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Closing and reopening Watch search restores the previous query instead of the default empty field."
  - "Search results or loading state can survive a close and reappear on the next open."
  - "Different close paths can produce different reset behavior."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/FloatingSearchProvider.tsx"
  - "apps/web/src/components/FloatingSearchController.tsx"
  - "apps/web/src/components/SearchOverlay.tsx"
  - "apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx"
tags:
  - "watch"
  - "search"
  - "modal"
  - "reset"
  - "close-path"
  - "stale-response"
---

# Watch search close paths must reset modal-owned state

## Problem

Watch search kept its provider-owned query and controller-owned transient state
when the modal closed. Reopening the modal therefore restored the previous
search rather than showing a focused empty field and the default categories.

The modal has several close paths: the header close button, Escape, result
navigation, and other callers of the shared open-state setter. Resetting only
one UI control leaves the others with different behavior.

## Symptoms

- Type a query, close the modal, and reopen it: the old query is still present.
- Results, skeletons, or an error can remain associated with a modal that is no
  longer open.
- A late response from a request started before close can repopulate stale
  results after the close transition.

## What Didn't Work

- **Preserving the query in a separate close helper.** `closeAndKeepQuery`
  encoded the behavior that caused the regression and let Escape and result
  navigation bypass the desired reset contract.
- **Resetting only the visible input.** The controller also owns results,
  pagination, loading, errors, timers, and request identity; clearing the
  provider query alone does not invalidate that transient state.
- **Resetting individual close buttons.** The overlay has multiple close
  paths, so control-specific cleanup is easy to miss as the UI evolves.

## Solution

Make the provider's shared `setOpen(false)` transition the reset boundary. It
clears the provider-owned query and increments the existing reset token before
the 200 ms closing animation begins:

```tsx
const resetSearch = useCallback(() => {
  setQuery("")
  setSearchResetToken((token) => token + 1)
}, [])

const setOpen = useCallback(
  (next: boolean) => {
    if (next) {
      setClosing(false)
      setOpenState(true)
    } else {
      resetSearch()
      setClosing(true)
      closingTimerRef.current = setTimeout(() => {
        setOpenState(false)
        setClosing(false)
      }, 200)
    }
  },
  [resetSearch],
)
```

Route Escape and result navigation through that same boundary:

```tsx
if (event.key === "Escape") setOpen(false)

<div onClick={() => setOpen(false)}>
  <VideoCard result={result} />
</div>
```

Remove `closeAndKeepQuery` from the context so future consumers cannot opt into
the superseded behavior. Keep language metadata caching outside the reset token
so reopening remains instant and does not refetch metadata that already loaded
successfully.

## Why This Works

The provider is the durable owner of both modal visibility and the query. The
controller consumes the provider's reset token to clear its transient search
state and invalidate request identity. Incrementing that token synchronizes the
two ownership layers: the field resets immediately, while controller results,
loading state, pagination, errors, timers, and late responses are discarded.

Centralizing the transition in `setOpen(false)` also makes the close contract
independent of which UI gesture initiated it. The existing close animation can
finish without retaining a query that will leak into the next open.

## Prevention

- Treat `setOpen(false)` as the single close-and-reset boundary for Watch
  search; new close gestures should call it rather than implement local cleanup.
- Test close-button, Escape, and result-navigation paths through the rendered
  overlay, then reopen and assert the input is empty and default categories are
  visible.
- Include an unresolved search promise in reset coverage and assert its late
  response cannot render after close.
- Keep durable metadata caches separate from transient query/result reset state
  so correctness does not regress the instant-shell behavior.

## Related Issues

- [Watch search URL sync can strand the overlay in loading](watch-search-url-hydration-perpetual-loading.md)
- [Watch semantic search must wait for language metadata before query-language confirmation](watch-semantic-search-language-metadata-confirmation-race.md)
- [Forge Algolia Search Modal Pattern](../architecture-patterns/forge-algolia-search-modal-20260610.md)
- [Search modal instant input shell roadmap ticket](../../roadmap/content-discovery/feat-244-search-modal-instant-shell.md)
- [Reset Watch search when the modal closes roadmap ticket](../../roadmap/content-discovery/feat-250-watch-search-close-reset.md)
