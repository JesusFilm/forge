---
id: "feat-254"
title: "Watch language navigation feedback"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "content-discovery"
  - "ux"
  - "performance"
---

## Problem

Selecting a language on `/watch/languages` can leave the existing page visually
unchanged for several seconds while the prefetched language inventory payload
renders. The destination request itself is healthy, but viewers receive no
acknowledgement that their click started a navigation and can mistake the page
for being unresponsive.

## Entry Points - Read These First

1. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx` - client-side
   language links and the existing region/country browser state.
2. `apps/web/src/components/watch/WatchLanguageIndexBrowser.test.tsx` - focused
   interaction coverage for the language index.
3. `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx` - async
   language inventory destination route.
4. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - existing Watch pattern for immediate, link-scoped pending feedback.

## Grep These

- `LanguageLink|ArrowRight|onClick` in
  `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx`.
- `aria-busy|data-pending|loading icon` in
  `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`.
- `loading.tsx|role="status"|SpinnerIcon` in `apps/web/src`.

## What To Build

1. A normal left click on a language link immediately marks that exact link
   pending, exposes `aria-busy`, and replaces the arrow with a visible spinner.
2. Modified clicks keep native browser behavior and do not enter the in-page
   pending state.
3. Add a route-level loading fallback for the async language inventory segment
   so uncached transitions and direct client navigations also show progress.
4. Add focused tests for the pending link state, modified-click behavior, and
   accessible loading fallback.
5. Browser-smoke the local `/watch/languages` click transition and capture the
   pending state before the destination finishes rendering.

## Constraints

- Do not change language inventory queries, grouping, sorting, or public URLs.
- Keep `next/link` semantics, including command/control-click and other
  modified-click behavior.
- Keep feedback scoped to the selected language instead of blocking the full
  language index immediately.
- Do not add global navigation state or a new data-fetching layer.
- Preserve page-loading performance; avoid adding per-link effects or timers.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/WatchLanguageIndexBrowser.test.tsx src/app/[locale]/[htmlLang]/videos/[languageSlug]/loading.test.tsx`
- `pnpm --filter @forge/web exec tsc --noEmit --pretty false`
- `pnpm --filter @forge/web lint`
- `git diff --check`
- Local browser click from `/watch/languages` immediately shows the selected
  link as busy with a spinner, then commits to the language inventory page.

## Completion Note - 2026-07-14

Language links now acknowledge normal clicks immediately with a selected-link
spinner and busy state while preserving modified-click browser behavior. The
async language inventory segment also renders an accessible full-page loading
fallback until the destination content resolves.

Focused component and route tests, Web typecheck, lint, formatting, and local
browser smoke passed. Browser proof used the populated 2,263-language index:
the selected link exposed its pending state within 120 ms, the route-level
fallback followed, and the Arabic inventory resolved with 173 items and no
console errors.
