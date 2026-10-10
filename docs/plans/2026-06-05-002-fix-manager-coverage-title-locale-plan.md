---
title: "fix: Manager coverage title locale preference"
type: fix
status: completed
date: 2026-06-05
branch: fix/manager-coverage-title-locale
roadmap:
  - docs/roadmap/platform/feat-168-manager-coverage-title-locale-preference.md
related_docs:
  - docs/roadmap/platform/feat-167-manager-coverage-video-aggregation.md
  - docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md
---

# fix: Manager coverage title locale preference

## Summary

The plan fixes the coverage report title language mismatch at the Admin read
model boundary. Coverage counts stay selected-language scoped, while display
titles prefer stable operator-readable metadata instead of whichever localized
row was most recently updated.

## Problem

When the Manager coverage report is filtered to English plus Belarusian, the UI
can show Japanese titles. Helium verification showed Manager's `/api/videos`
response already contains those Japanese title strings. The Admin read model
currently loads a single `VideoLocale` ordered by latest update and returns that
locale title, while selected language IDs are only applied to subtitle and dub
count aggregation.

## Requirements

- Prefer English `VideoLocale.title` for coverage display titles when present.
- If English is absent, prefer a title from one of the selected language IDs.
- If neither exists, return no localized title so Manager uses its existing
  slug/core-id fallback rather than latest-updated locale nondeterminism.
- Preserve the current `managerVideoCoverage` payload shape and Manager proxy
  behavior.
- Preserve language-filtered subtitle and audio coverage count semantics.

## Assumptions

- English is the preferred operator-readable title for Manager coverage lists,
  even when the selected language set also contains non-English languages.
- Admin `VideoLocale.languageId` uses the same Admin language IDs passed by the
  Manager coverage filter.
- The existing Manager slug/core-id fallback is preferable to retaining a
  latest-updated localized title fallback.

## Scope

In scope:

- `apps/admin/src/services/manager-read-model.service.ts`
- `apps/admin/src/services/manager-read-model.service.test.ts`
- Roadmap and plan docs for the fix.

Out of scope:

- GraphQL schema or payload shape changes.
- Manager UI redesign or client-side title localization.
- Changes to the video universe returned by coverage filters.
- Backfilling or editing production localized metadata rows.

## Approach

Admin should load only the candidate locale rows needed to make a stable title
choice, not only the latest-updated row and not every localized title. A small
helper will choose the display title in priority order: English, then
selected-language locale, then no localized title so Manager's existing
slug/core-id fallback is used.

This keeps the Manager route simple: it continues rendering the title provided
by Admin and calculating `none` counts from the selected language count.

## Implementation Units

### U1: Admin coverage title selector

Files:

- Modify `apps/admin/src/services/manager-read-model.service.ts`

Test scenarios:

- A video with both English and a newer Japanese locale returns the English
  title.
- A video without English but with a selected-language locale returns the
  selected-language title.
- A video without English or selected-language locale returns no localized title
  so Manager falls back to slug/core-id.
- Subtitle and dub aggregation still receives the selected `languageIds` filter.

Verification:

- `pnpm --filter @forge/admin test -- --run src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin exec eslint src/services/manager-read-model.service.ts src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/manager test -- --run src/app/api/videos/route.mock.test.ts`
- `pnpm --filter @forge/manager exec eslint src/app/api/videos/route.mock.test.ts`
- `pnpm --filter @forge/manager typecheck`

### U2: Browser production-shape smoke

Files:

- No expected code changes outside Admin service/test files.

Test scenarios:

- Load the Manager coverage page with English plus Belarusian selected.
- Confirm `/api/videos?languageIds=...` returns English display titles where an
  English locale exists.
- Confirm coverage cells still reflect two selected languages.

Verification:

- Helium/CDP fetch against the authenticated Manager tab.

## Completion Evidence

- Admin title selection now queries only English and selected-language localized
  title candidates, preserving the coverage aggregation query shape.
- Focused Admin service tests cover English precedence, selected-language
  fallback, slug fallback, and unchanged language-scoped subtitle/dub counts.
- Manager API route tests cover the existing slug fallback when Admin returns
  `title: null`.
- Helium/CDP authenticated production fetch on 2026-06-05 reproduced the old
  deployed baseline for the English plus Belarusian URL, confirming the symptom
  this branch addresses. Post-fix production proof requires deploying this
  Admin service change.
