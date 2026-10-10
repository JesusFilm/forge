---
title: "fix: Reset Watch search after modal close"
type: fix
status: completed
date: 2026-07-13
---

# fix: Reset Watch search after modal close

## Summary

Reset the Watch global search field and its transient result state whenever the modal closes, so every later open starts at the empty default search surface.

## Problem Frame

`FloatingSearchProvider` keeps `query` across the modal close animation, while `FloatingSearchController` deliberately exposes a `closeAndKeepQuery` action. A visitor who searches, closes the modal, and reopens it therefore sees the prior query and result state instead of a fresh search field.

## Requirements

- R1. Every modal-close path clears the visible query before the next open.
- R2. Closing clears transient results, loading, error, pagination, and analytics state without issuing an empty server search.
- R3. Reopening after close shows the normal empty-query category/default surface and keeps the existing instant-shell handoff intact.
- R4. Closing does not invalidate cached language metadata or cause another language-options request on reopen.

## Assumptions

- "Default state" means an empty search field and no stale search results; the visitor's current route-derived or manually selected language remains unchanged.
- The reset begins when close is requested, while the existing 200 ms visual close animation continues.

## Key Technical Decisions

- **Reset at the provider close boundary:** `FloatingSearchProvider` owns every shell and controller close request, so resetting there covers the header close button, Escape, and result navigation without duplicating behavior in each UI control.
- **Reuse the controller reset contract:** Increment the existing reset token when closing after clearing provider query state. The controller's empty search path already cancels stale requests and clears transient search state without calling `runSearch`.
- **Preserve reusable metadata:** Keep the controller mounted and retain its language-options cache so the behavioral reset does not undo the instant-shell and no-refetch performance guarantees.

## Implementation Units

### U1. Track the close-reset regression

- **Goal:** Add the required in-progress roadmap ticket before code changes.
- **Requirements:** R1 through R4.
- **Dependencies:** None.
- **Files:** `docs/roadmap/content-discovery/feat-250-watch-search-close-reset.md`.
- **Approach:** Record the provider/controller ownership boundary, the stale-query reproduction, the constraints inherited from the instant-shell work, and focused verification commands.
- **Patterns to follow:** `docs/roadmap/content-discovery/feat-244-search-modal-instant-shell.md`.
- **Test scenarios:** Test expectation: none -- roadmap-only tracking.
- **Verification:** The globally sequential ticket exists with `status: "in-progress"` and agent-oriented entry points.

### U2. Reset search state through the shared close path

- **Goal:** Make all modal closes clear the search field and controller search state while preserving the existing animation and metadata cache.
- **Requirements:** R1 through R4.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/FloatingSearchProvider.tsx`, `apps/web/src/components/FloatingSearchController.tsx`, `apps/web/src/components/FloatingSearchContext.tsx`, `apps/web/src/components/SearchOverlay.tsx`, `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Approach:** Extend the provider-owned close transition to clear `query` and advance the existing reset token. Remove the obsolete keep-query naming/wrapper from the controller context so overlay close controls use the shared `setOpen(false)` contract directly.
- **Patterns to follow:** The logo's existing query/reset-token behavior and the controller's `search("")` cancellation/reset branch.
- **Test scenarios:**
  - Enter a query, close from the persistent header button, wait for the close animation, reopen, and observe an empty focused input with the default empty-query surface.
  - Close with Escape after searching, reopen, and observe the same reset behavior.
  - Close through a search-result navigation click and verify the shared close boundary clears the query before navigation.
  - Resolve an earlier in-flight search after closing and verify it cannot restore stale loading or results.
  - Close and reopen after language metadata loads and verify `getSearchLanguageOptions` is not called again.
- **Verification:** Focused provider tests cover all close routes and demonstrate that no empty `runSearch` request or metadata refetch occurs.

### U3. Validate the Watch interaction and loading posture

- **Goal:** Prove the reset works in the rendered Watch modal without regressing its shell-first loading behavior.
- **Requirements:** R1 through R4.
- **Dependencies:** U2.
- **Files:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Approach:** Run the focused component suite and web typecheck, then exercise search, close, and reopen in a mobile-sized browser while checking the field value and capturing visual proof.
- **Patterns to follow:** `docs/plans/2026-07-09-002-fix-search-modal-instant-shell-plan.md` and `docs/solutions/ui-bugs/watch-search-overlay-stacked-control-breakpoints-20260708.md`.
- **Test scenarios:** Browser smoke covers first open, query entry, close, and second open in one session; the second open must show an empty field immediately.
- **Verification:** Focused Vitest and typecheck pass, the browser assertion reads an empty reopened field, and a screenshot records the default reopened state.

## Scope Boundaries

- Do not change search ranking, pagination size, query-language detection, or language-filter product behavior.
- Do not eagerly mount the full search controller or invalidate cached language metadata.
- Do not add a `/watch/search` route or synchronize modal queries into the URL.

## Risks and Dependencies

- **Close animation race:** A late response could repopulate results during the 200 ms close transition. The controller reset token must invalidate the active request immediately.
- **Partial close coverage:** The full overlay and instant shell use different close controls. The provider boundary is the single contract that must cover both.

## Sources and Research

- Current ownership: `apps/web/src/components/FloatingSearchProvider.tsx`, `apps/web/src/components/FloatingSearchController.tsx`, `apps/web/src/components/SearchOverlay.tsx`.
- Focused regressions: `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- Prior performance contract: `docs/roadmap/content-discovery/feat-244-search-modal-instant-shell.md` and `docs/plans/2026-07-09-002-fix-search-modal-instant-shell-plan.md`.
