---
id: "feat-244"
title: "Watch language options browser cache"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "performance"
---

## Problem

The Watch language modal lazy-loads its language list only when the viewer opens
the modal. The current client-side cache is memory-only, so a fresh client
lifecycle for the same Watch video still waits for the server action before
the modal can show options.

## Entry Points - Read These First

1. `docs/plans/2026-07-09-002-feat-watch-language-options-browser-cache-plan.md`
   - implementation plan for this feature.
2. `apps/web/src/lib/watch-interaction-loader.ts` - lazy modal chunk loading,
   language-options server action loading, and per-video in-memory cache.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - opens the language
   modal and reads cached options before showing loading state.
4. `apps/web/src/lib/watch-interaction-loader.test.ts` - focused loader tests.
5. `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`
   - existing modal callback and loader mocks for Watch page client behavior.

## Grep These

- `getCachedWatchLanguageOptions`
- `loadWatchLanguageOptionsForVideo`
- `languageOptionsState`
- `openLanguage`

## What To Build

1. Persist successfully loaded Watch language options in browser storage under
   a versioned per-video payload.
2. Hydrate the language-options cache from browser storage so opening the modal
   can render options immediately on a later client lifecycle.
3. Treat stored options as provisional: show them instantly, then refresh in the
   background and replace memory/storage on success.
4. Ignore invalid, schema-incompatible, unavailable, or throwing browser
   storage paths and fall back to the existing server-action loader.
5. Keep language options out of the initial Watch page payload.

## Constraints

- Do not change language switching, subtitle selection, public Watch URLs, or
  Admin GraphQL operations.
- Do not hand-edit generated GraphQL or locale artifacts.
- Do not add durable `localStorage` persistence or a manual invalidation UI in
  this slice.

## Verification

- `pnpm --filter @forge/web test -- src/lib/watch-interaction-loader.test.ts src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- Browser smoke on `/watch/jesus.html/russian.html`: open the language modal,
  close it, reload or revisit in the same session, and confirm the language
  list appears immediately while the background refresh does not block the UI.

## Plan

Implementation plan:
`docs/plans/2026-07-09-002-feat-watch-language-options-browser-cache-plan.md`
