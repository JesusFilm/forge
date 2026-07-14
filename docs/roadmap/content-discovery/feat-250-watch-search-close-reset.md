---
id: "feat-250"
title: "Reset Watch search when the modal closes"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-13"
completed_date: "2026-07-13"
duration: 1
depends_on:
  - "feat-244"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
---

## Problem

The Watch global search modal preserves its provider-owned query and
controller-owned result state after close. A visitor who searches, closes the
modal, and opens it again sees the old query and results instead of the default
empty search surface.

## Entry Points - Read These First

1. `docs/plans/2026-07-13-003-fix-search-modal-close-reset-plan.md` - scoped
   implementation plan and required close-path coverage.
2. `apps/web/src/components/FloatingSearchProvider.tsx` - provider query,
   close animation, reset token, instant shell, and persistent header close.
3. `apps/web/src/components/FloatingSearchController.tsx` - transient search
   results, request cancellation, and empty-query reset behavior.
4. `apps/web/src/components/SearchOverlay.tsx` - Escape and result-navigation
   close paths.
5. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   focused modal, request-race, and reopen regressions.

## Grep These

```bash
rg -n "setOpen|closeAndKeepQuery|searchResetToken|resetToken" apps/web/src/components
rg -n "reopening|Escape|result.*click|stale search" apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx
```

## What To Build

1. Make the provider-owned close boundary clear the search query and advance
   the controller reset token as soon as close begins.
2. Route the full overlay's Escape and result-navigation close actions through
   that shared boundary instead of a keep-query-specific wrapper.
3. Keep the controller mounted so cached language metadata survives close and
   reopen.
4. Cover header close, Escape, result navigation, and a late in-flight response
   in focused provider tests.

## Constraints

- Do not change search ranking, page size, language detection, or language
  selection behavior.
- Do not eagerly mount the full search controller.
- Do not invalidate cached language metadata or add a metadata refetch on
  reopen.
- Do not issue a server search for the empty reset query.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx
pnpm --filter @forge/web exec tsc --noEmit --pretty false
```

Browser smoke at mobile width must search, close, and reopen in one session;
the reopened focused field must be empty and the default category surface must
be visible immediately.
