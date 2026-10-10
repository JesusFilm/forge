---
id: "feat-336"
title: "Require explicit Watch search submission"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
completed_date: "2026-08-11"
duration: 1
depends_on:
  - "feat-244"
  - "feat-250"
blocks:
  - "feat-337"
tags:
  - "web"
  - "watch"
  - "search"
  - "mobile"
  - "accessibility"
---

## Problem

The Watch search modal currently starts a remote search 300 milliseconds after
each keyword edit. That sends incomplete queries while a viewer is still
typing, leaves the leading magnifier decorative, and behaves differently from
the intended type-then-submit interaction. The instant shell also discards an
Enter action while the full search controller is loading.

## Entry Points - Read These First

1. `docs/plans/2026-08-05-003-feat-watch-search-explicit-submit-plan.md` -
   implementation plan, interaction contract, and acceptance examples.
2. `apps/web/src/components/FloatingSearchField.tsx` - shared search pill and
   input affordances.
3. `apps/web/src/components/SearchOverlay.tsx` - full overlay draft and search
   actions.
4. `apps/web/src/components/FloatingSearchProvider.tsx` - instant shell and
   lazy-controller handoff.
5. `apps/web/src/components/FloatingSearchController.tsx` - guarded request
   lifecycle, reset, and pagination.
6. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - modal,
   language, stale-request, pagination, and lazy-shell regressions.

## Grep These

```bash
rg -n "debounceRef|handleInputChange|handleInputKeyDown|initialShellQuery" apps/web/src/components
rg -n "submitDebouncedSearch|instant shell|search input" apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx
```

## What To Build

1. Make keyword edits draft-only and remove the debounce request path.
2. Render the shared keyword control as a semantic search form with a native
   search input and `enterkeyhint="search"`.
3. Keep the leading magnifier passive and reveal a named, focus-visible trailing
   submit button with a minimum 44-by-44-pixel target for a non-empty draft.
4. Route Enter, the mobile Search key, and icon activation through the same
   submit event so one action starts at most one initial-page request.
5. Reveal a localized Enter-key search label only for a non-empty draft, using
   a quiet outlined action with a visible label on desktop and phones.
6. Preserve an exact submitted query snapshot across the instant-shell lazy
   handoff and consume the intent once; shell typing alone must not search.
7. Preserve category, language, retry, reset, stale-request, and pagination
   behavior after a submitted query.

## Constraints

- Keep the existing floating header and white-pill geometry on desktop and
  narrow mobile layouts.
- Do not add a search route or write search state to the URL.
- Do not eagerly mount the full search controller or refetch cached language
  metadata on reopen.
- Do not change ranking, providers, result cards, page size, or language route
  construction.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx
pnpm --filter @forge/web exec tsc --noEmit --pretty false
```

Browser smoke at desktop and narrow-mobile widths must prove that typing is
request-free, Enter/Search-key and icon activation each submit exactly once,
the action remains touchable and focused, and close/reopen preserves the
instant-shell and metadata-cache contracts.
