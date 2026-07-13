---
id: "feat-244"
title: "Search modal instant input shell"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
completed_date: "2026-07-10"
duration: 1
depends_on:
  - "feat-172"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "performance"
---

## Problem

On a slow mobile connection, opening the Watch global search modal can feel
blank because the visible input waits for the lazily loaded search controller
before the overlay portal renders. After the full controller mounts, language
metadata is also requested on every modal open, even though the input and basic
controls can render before that optional metadata finishes.

Attribution from `git blame`:

- `b44a2a57d` (`perf(web): stage watch interaction loading`) introduced the
  `FloatingSearchController` lazy split to reduce initial Watch page JS.
- `fc275e6d0` (`feat(watch): add multilingual semantic search language
control`) made language metadata readiness part of semantic search behavior.

Both changes are valid, but their combination leaves the first mobile open
dependent on slow background work.

## Entry Points - Read These First

1. `docs/plans/2026-07-09-002-fix-search-modal-instant-shell-plan.md` -
   implementation plan and requirements.
2. `apps/web/src/components/FloatingSearchProvider.tsx` - loaded header shell
   and lazy controller enablement.
3. `apps/web/src/components/FloatingSearchController.tsx` - full modal state,
   overlay portal, language metadata refresh, and search dispatch.
4. `apps/web/src/components/SearchOverlay.tsx` - full search overlay UI.
5. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   existing modal, language metadata, and pagination regressions.

## Grep These

```bash
rg -n "LazyFloatingSearchController|searchControllerEnabled|refreshLanguageOptions|languageOptionsLoadedRef|SearchOverlay" apps/web/src/components
rg -n "getSearchLanguageOptions|openSearchOverlay|flushSearchControllerMount" apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx
```

## What To Build

1. Render a lightweight search modal shell/input from `FloatingSearchProvider`
   immediately after the user opens search.
2. Keep `FloatingSearchController` lazy so initial page JS does not regress.
3. Replace the shell with the full overlay after the controller reports portal
   readiness.
4. Cache language metadata by normalized facet context so the second modal open
   does not call `getSearchLanguageOptions` again.
5. Keep changed-facet refreshes backgrounded and deduped.

## Constraints

- Do not add or promote a `/watch/search` page.
- Do not eagerly mount the full controller on initial page render.
- Do not change search ranking, Algolia filters, semantic search result shape,
  or query-language confirmation product behavior.
- Do not hand-edit generated GraphQL artifacts.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx
pnpm --filter @forge/web exec tsc --noEmit --pretty false
```
