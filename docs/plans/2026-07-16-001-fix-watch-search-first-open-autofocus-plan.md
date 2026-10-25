---
title: "fix: Focus Watch search on the first open"
type: "fix"
status: "completed"
date: "2026-07-16"
---

# fix: Focus Watch search on the first open

## Summary

Make the instant search shell claim input focus on the first-ever modal open,
then preserve the full overlay's existing focus behavior after lazy loading and
on repeat opens.

## Problem Frame

The first click opens `SearchOverlayInstantShell` while the lazy search
controller loads. That shell waits for a 50 ms effect before focusing, whereas
the full `SearchOverlay` uses an immediate layout-timed focus attempt plus
bounded retries. After the controller is loaded, later clicks reach the full
overlay path and focus correctly, which explains the first-open-only failure.

## Requirements

- R1. The first-ever click on the floating search field focuses the visible
  instant-shell input without waiting for the full controller.
- R2. Focus remains on the search input when the instant shell hands off to the
  full overlay.
- R3. Closing and reopening search continues to focus the full overlay input.
- R4. Focus attempts do not scroll the page or change search, metadata,
  geometry, and close/reset behavior.

## Assumptions

- The regression is confined to the first-open instant shell; the full
  overlay's existing focus lifecycle remains the canonical pattern.
- Browser autofocus should be backed by bounded layout and timer retries
  because the shell can mount across portal, animation, and lazy-load timing.
- Focus return to the floating trigger on close is outside this bug's scope.

## Key Technical Decisions

- **Use the full overlay's focus lifecycle in the instant shell:** Immediate
  focus plus animation-frame and timer retries removes the first-open timing
  gap without eagerly loading the controller.
- **Keep native autofocus on the input:** The mount-time semantic gives the
  browser the earliest focus opportunity, while imperative retries cover
  layout races.
- **Test the shell before controller handoff:** Existing focus tests flush the
  lazy controller and therefore exercise the repeat/full-overlay path rather
  than the first-ever click reported by the user.

## Scope Boundaries

- Keep `FloatingSearchController` lazy and preserve the instant-shell handoff.
- Do not change result loading, language metadata caching, search ranking,
  field geometry, close/reset semantics, or direct-query routing.

## Implementation Units

### U1. Cover the cold first-open focus lifecycle

- **Goal:** Add a regression test that observes focus while the instant shell
  is still the rendered search surface, then verifies focus through controller
  handoff and reopen.
- **Requirements:** R1, R2, R3
- **Dependencies:** None
- **Files:**
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:** Extend the existing instant-shell test and assert focus in the
  same render turn as the opening click, before flushing the lazy controller.
  Then flush the controller, close, reopen, and assert the full overlay input
  also owns focus.
- **Execution note:** Add the first-open assertion before changing the shell so
  the regression is demonstrated against current behavior.
- **Patterns to follow:** Existing `openSearchOverlay` and
  `document.activeElement` assertions in the same test file.
- **Test scenarios:**
  1. Before flushing the lazy controller, click the floating search field and
     expect the instant-shell input to be `document.activeElement` immediately.
  2. Resolve controller loading and expect the full overlay input to retain
     focus after handoff.
  3. Close and reopen the modal and expect the full overlay input to receive
     focus again.
- **Verification:** The focused test fails on the current first-open behavior
  and passes after U2 without advancing the shell's fallback timer for the
  initial assertion.

### U2. Align instant-shell focus with the full overlay

- **Goal:** Make the first-open shell focus behavior as reliable as the full
  overlay without changing lazy-loading boundaries.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/SearchOverlayInstantShell.tsx`
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:** Apply mount-time autofocus and the full overlay's
  layout-timed, `preventScroll` focus retries to the instant shell. Clean up
  scheduled work when the shell unmounts during controller handoff.
- **Patterns to follow:** `SearchOverlay` focus management and
  `FloatingSearchFieldInput` ref forwarding.
- **Test scenarios:**
  1. The first-open shell focuses on mount even when controller metadata stays
     unresolved.
  2. Animation-frame and timer retries do not steal focus after the shell is
     replaced or closed.
  3. Existing shell rendering, metadata reuse, Escape reset, focus persistence,
     and overlay chrome tests remain green.
- **Verification:** Focused Vitest, web typecheck, and lint pass; browser smoke
  on a cold desktop and mobile load confirms the first click and reopen both
  leave the search input active without page movement.

## Sources & Research

- `apps/web/src/components/SearchOverlayInstantShell.tsx` contains the delayed
  first-open focus path.
- `apps/web/src/components/SearchOverlay.tsx` contains the proven full-overlay
  immediate focus and bounded retry pattern.
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` already
  distinguishes the instant shell, controller handoff, metadata reuse, and
  full-overlay focus behavior.
- `docs/roadmap/content-discovery/feat-244-search-modal-instant-shell.md` records
  why the lightweight shell must remain immediate and controller loading must
  stay deferred.
