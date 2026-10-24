---
title: "Manager Coverage Language Persistence"
category: integration-issues
date: 2026-05-01
severity: medium
tags:
  - manager
  - coverage
  - language-filter
  - url-state
  - session-storage
  - dashboard-navigation
  - query-params
affected_components:
  - apps/manager/src/app/dashboard/coverage/page.tsx
  - apps/manager/src/features/coverage/language-selection.ts
  - apps/manager/src/features/coverage/language-selection.test.ts
  - apps/manager/src/features/coverage/coverage-report-client.tsx
  - apps/manager/src/features/coverage/LanguageGeoSelector.tsx
related_docs:
  - docs/brainstorms/2026-05-01-manager-coverage-language-persistence-requirements.md
  - docs/plans/2026-05-01-fix-manager-coverage-language-persistence-plan.md
  - docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md
  - docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md
  - docs/solutions/integration-issues/manager-mock-coverage-language-parity-20260422.md
  - docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md
  - docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md
related_prs:
  - https://github.com/JesusFilm/forge/pull/869
---

# Manager Coverage Language Persistence

## Problem

The Manager Coverage report treated language selection as URL state only. That kept shared links honest, but it made normal dashboard navigation frustrating:

- a bare `/dashboard/coverage` route produced no selected language and showed the language-first empty state
- fresh Coverage visits did not default to English, so the report was not useful immediately
- users who selected French, Spanish, or a multi-language set lost that selection after visiting Jobs or Agents and returning through the Report nav
- legacy `?languageIds=...` links still had to work while the browser URL stayed canonical as `languageId`

The important product distinction was: explicit URL state should always win, but the bare Report route should be repaired into a useful language selection.

## Root Cause

`apps/manager/src/app/dashboard/coverage/page.tsx` parsed only incoming `searchParams` and passed them as `initialSelectedLanguageIds`. When the Studio shell linked back to bare `/dashboard/coverage`, the route resolved to `[]`.

That empty selection made `CoverageReportClient` skip `/api/videos` and render the language-first state. The app already had a good URL contract (`languageId` canonical, `languageIds` legacy), but it did not have:

1. catalog-backed English defaulting for true bare routes
2. session-scoped return memory for user-applied custom selections
3. route repair from remembered/default/legacy state back into canonical `languageId`
4. one shared path for picker confirmation and selected-pill removal to update memory

## Solution

### Keep the URL authoritative

The fix kept the browser URL as the source of truth whenever it explicitly names a selection:

- `languageId` remains the canonical browser query key
- legacy `languageIds` is still accepted
- legacy URLs are normalized back to `languageId` with `router.replace`
- session memory never beats an explicit query
- `/api/videos` continues to receive internal `languageIds`

That preserves shareable links while still allowing the page to repair bare route state.

### Centralize language-state decisions

`apps/manager/src/features/coverage/language-selection.ts` owns the small state contract:

```ts
resolveCoverageLanguageSelection({
  currentQuery,
  rememberedLanguageIds,
  languages,
})
```

The resolver precedence is:

1. explicit canonical `languageId`
2. legacy `languageIds`, normalized to canonical URL state
3. remembered session language IDs
4. English resolved from the fetched language catalog
5. no automatic selection if English is unavailable

Supporting helpers keep parsing and storage behavior focused:

- `parseRequestedLanguageIds()` trims, dedupes, and removes empty values
- `resolveRequestedLanguageIds()` prefers canonical `languageId` while accepting legacy `languageIds`
- `normalizeCoverageLanguageSearchParams()` removes `refresh`, `languageId`, and `languageIds`, then writes canonical `languageId`
- `resolveEnglishLanguageId()` resolves English from available `LanguageOption[]`
- `readRememberedCoverageLanguageIds()`, `writeRememberedCoverageLanguageIds()`, and `clearRememberedCoverageLanguageIds()` wrap `sessionStorage` safely

### Repair bare and legacy routes in the client

`apps/manager/src/features/coverage/coverage-report-client.tsx` fetches `/api/languages`, then asks the resolver what to do with the current query, remembered IDs, and language catalog.

Automatic route repair uses `router.replace()` so defaulting and legacy normalization do not pollute browser history:

- bare route + remembered IDs -> `?languageId=<remembered>`
- bare route + no memory + English found -> `?languageId=<englishId>`
- legacy `?languageIds=...` -> canonical `?languageId=...`

The automatic English default is not stored as custom memory. A small ref guard prevents the follow-up `?languageId=<englishId>` render from being treated as a user preference write.

### Route picker writes through one callback

`LanguageGeoSelector` now accepts `onApplyLanguages`. Picker confirmation and selected-pill removal both call back to `CoverageReportClient.applySelectedLanguages()`, which:

- writes non-empty user-applied selections to `sessionStorage`
- clears remembered selection when the user removes the final language
- pushes the canonical `languageId` URL

This avoided a split where presets remembered language choices but the geo picker only changed the URL.

### Keep the resolver surface small

A review follow-up removed diagnostic-only resolver API:

- `CoverageLanguageSelectionReason`
- the `reason` return field
- unused `hasExplicitCoverageLanguageQuery()`

Tests now assert only the fields production uses: selected IDs, URL replacement intent, and memory-write intent.

## What Didn't Work

**Relying on URL state only**

- **Why it failed:** The shell Report nav points at bare `/dashboard/coverage`, so returning from Jobs or Agents dropped the language query.

**Carrying language state only in shell nav**

- **Why it was not enough:** It helps known dashboard links, but not direct bare routes, reloads, or programmatic route entry. The Coverage page itself needed to repair bare state.

**Hidden preference only**

- **Why it was rejected:** It would weaken the existing shareable URL contract. Explicit `languageId` links must remain predictable and authoritative.

**Hardcoding English as `529`**

- **Why it was rejected:** Mock data uses `529`, but live environments should resolve English from the Manager language catalog rather than baking a core ID into UI logic.

## Why This Works

The durable pattern is URL-authoritative state with visible session repair:

- explicit URLs stay truthful and shareable
- remembered state only repairs bare Coverage returns
- every automatic repair is reflected in the URL
- English defaulting is data-derived from `/api/languages`
- internal API calls keep the established `/api/videos?languageIds=...` contract

The UI never filters coverage from hidden client-only state. It repairs the URL first, then the route-derived selected language IDs continue to drive the report and `/api/videos` request.

## Verification

Red/green test evidence:

```bash
pnpm --filter @forge/manager test -- --run src/features/coverage/language-selection.test.ts
pnpm --filter @forge/manager test -- --run src/features/coverage/language-selection.test.ts src/app/api/videos/route.test.ts src/app/api/videos/route.mock.test.ts
```

PR validation:

```bash
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
git diff --check
```

Browser smoke ran Manager in mock mode at `http://localhost:3002` with `MANAGER_DATA_MODE=mock`. Evidence was captured under `output/smoke/fcdb-coverage-language/`:

- `02-default-english.png` — bare Coverage canonicalized to `?languageId=529`; English coverage loaded
- `03-selected-french.png` — French selection wrote `forge-coverage-language-ids: 6414`
- `05-remembered-french-return.png` — Jobs -> Report restored French at `?languageId=6414`
- `06-explicit-english-overrides-memory.png` — explicit `?languageId=529` beat remembered French
- `07-legacy-normalized.png` — `?languageIds=21028,6414` normalized to `languageId=21028%2C6414`
- `08-cleared-falls-back-english.png` — clearing the final custom language removed memory and fell back to English
- `network.har` — successful `/api/languages` and `/api/videos?languageIds=...` requests for English, French, and multi-language states

## Prevention

1. Keep coverage query parsing and normalization centralized in `language-selection.ts`.
2. Treat `languageId` as the canonical browser key and `languageIds` as legacy input only.
3. Let session memory repair only bare routes, and always make the repaired selection visible in the URL.
4. Resolve defaults from data paths such as `/api/languages`; do not hardcode mock IDs into UI behavior.
5. Store only deliberate user-applied selections in memory. Automatic defaults should not become custom remembered state.
6. Route picker confirmation, selected-pill removal, and preset shortcuts through the same memory/update callback.
7. Keep resolver APIs small and pure. Router and storage side effects belong at the component boundary.
8. Preserve mock/live parity: changing selected languages should change subtitle/audio counts while preserving the video set.

Future tests should keep covering:

- canonical `languageId` wins over memory
- legacy `languageIds` normalizes to singular `languageId`
- bare route restores remembered selection
- bare route defaults to catalog-resolved English when no memory exists
- missing English leaves the language-first state intact
- storage read/write/clear trims, dedupes, and tolerates storage failures
- browser smoke for default English, custom return memory, legacy normalization, and clear/reset behavior

## Follow-Up

Review found one product nuance that is tracked separately: opening an explicit copied `?languageId=...` URL also updates remembered session memory. That may or may not be desired. If copied links should win only for the current visit, update the resolver/client so memory changes only from user-initiated picker or preset paths.

Tracked locally as `todos/006-pending-p2-explicit-query-overwrites-coverage-language-memory.md`.

## Related

- [`docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md`](./manager-coverage-language-first-empty-state-20260410.md) — earlier language-first state and `languageId` / `languageIds` normalization work
- [`docs/solutions/integration-issues/manager-mock-coverage-language-parity-20260422.md`](./manager-mock-coverage-language-parity-20260422.md) — mock coverage must change with selected languages
- [`docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md`](./manager-coverage-dashboard-review-regression-cleanup.md) — coverage dashboard empty/failure state boundaries
- [`docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md`](../performance-issues/manager-video-coverage-sql-aggregation-20260402.md) — live coverage aggregation and internal `languageIds` filtering contract
- [`docs/plans/2026-05-01-fix-manager-coverage-language-persistence-plan.md`](../../plans/2026-05-01-fix-manager-coverage-language-persistence-plan.md) — implementation plan and completion evidence
- [PR #869](https://github.com/JesusFilm/forge/pull/869)
