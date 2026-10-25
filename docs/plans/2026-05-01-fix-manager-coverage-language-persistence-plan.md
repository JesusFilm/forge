---
title: "fix: Manager coverage language persistence"
type: fix
status: complete
date: 2026-05-01
branch: feat/114-manager-coverage-language-persistence
origin: docs/brainstorms/2026-05-01-manager-coverage-language-persistence-requirements.md
roadmap:
  - docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md
related_docs:
  - docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md
  - docs/solutions/integration-issues/manager-mock-coverage-language-parity-20260422.md
  - docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md
  - docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md
  - docs/solutions/ui-bugs/manager-tailwind-reference-branch-visual-parity-20260429.md
---

# fix: Manager coverage language persistence

## Overview

Attach a narrow coverage-state follow-up to `feat-114` so Manager users no longer have to repeatedly select the same languages in `/dashboard/coverage`.

The first bare visit to `/dashboard/coverage` should resolve English from the Manager language catalog and canonicalize the URL to `?languageId=<englishId>`. When a user chooses a custom language or multi-language set, that exact user-selected set should be remembered for the current browser session and restored when they return to the bare Report route from Jobs, Agents, or other dashboard pages.

The URL remains the source of truth whenever it is explicit. `languageId` stays canonical browser state, legacy `languageIds` links stay accepted, and `/api/videos` can keep its existing internal `languageIds` API contract.

## Found Brainstorm

Found brainstorm from 2026-05-01: `manager-coverage-language-persistence`.
Using it as context for planning.

Key decisions:

- URL-backed coverage selection remains authoritative.
- English is the default only when no explicit query and no remembered custom selection exist.
- Remembered selection is session-scoped, not a durable account preference.
- Clearing all selected languages resets custom memory so later bare visits fall back to English.
- Implementation should reuse `apps/manager/src/features/coverage/language-selection.ts` as the central state contract.

## Problem Statement

Today, `/dashboard/coverage` reads only `searchParams` and passes `initialSelectedLanguageIds` to `CoverageReportClient`. A bare route produces `[]`, so the page skips `/api/videos` and renders the language-first empty state. The Studio shell Report nav also points at bare `/dashboard/coverage`, so users who select a custom language, visit Jobs or Agents, and return to Report lose their selection.

That is frustrating for operators because the coverage dashboard is language-first operational tooling. English should be useful immediately on first entry, and custom language selections should survive ordinary dashboard navigation.

## Research Summary

Local repo research found strong existing patterns, so external research was skipped.

Relevant code:

- `apps/manager/src/app/dashboard/coverage/page.tsx` reads `searchParams` and passes selected IDs into `CoverageReportClient`.
- `apps/manager/src/features/coverage/language-selection.ts` already parses comma-separated IDs, prefers canonical `languageId`, accepts legacy `languageIds`, and normalizes writes to `languageId`.
- `apps/manager/src/features/coverage/coverage-report-client.tsx` fetches `/api/languages`, derives presets, and calls `/api/videos?languageIds=...` when languages are selected.
- `apps/manager/src/features/coverage/LanguageGeoSelector.tsx` owns picker confirmation and pill removal URL writes.
- `apps/manager/src/features/shell/manager-shell.tsx` stores coverage mode/report type in `sessionStorage` and renders the bare Report nav link.
- `apps/manager/src/app/api/languages/cache.ts` serves the Manager language catalog from mock or live CMS.
- `apps/manager/src/cms/mock-seed.ts` contains seeded English `529`, Spanish `21028`, and French `6414`, which makes local smoke practical.

Institutional learnings:

- Keep query parsing/writes centralized; stale plural `languageIds` previously caused selection regressions.
- Mock coverage must preserve live semantics: the video set stays stable while selected-language coverage counts change.
- Do not change coverage aggregation semantics or reintroduce GraphQL/N+1 coverage reads.
- Do not collapse empty data, loading, and failure states; English defaulting should not turn an empty result into an outage.
- This is part of the Tailwind/Studio follow-up surface, so preserve functional deltas and verify in a real browser.

## SpecFlow Notes

User flows:

1. Fresh bare visit: `/dashboard/coverage` has no language query and no remembered selection. The app resolves English, canonicalizes to `?languageId=<englishId>`, and loads English coverage.
2. Custom selection return: user selects French, Spanish, or multiple languages, navigates to Jobs or Agents, then clicks Report. The bare Report route restores the remembered custom selection.
3. Explicit query override: user opens `?languageId=529` or legacy `?languageIds=529` while session memory contains another language. The URL wins.
4. Clear selection: user removes the final selected language or confirms an empty picker. Custom memory clears; subsequent bare coverage visits fall back to English.
5. Jobs/detail carry-forward: existing Jobs links that read either query key and write singular `languageId` remain compatible.

Default assumptions for implementation:

- Use `router.replace`, not `router.push`, when canonicalizing automatic default, remembered selection, or legacy query state.
- Do not store the automatic English default as the custom remembered selection.
- If the user explicitly chooses English, remember that explicit choice like any other user selection.
- Use `window.sessionStorage`, matching existing shell mode/report type behavior.
- If English cannot be resolved from the catalog, keep the existing language-first state and do not hardcode an ID.

## Scope Boundaries

In scope:

- Manager coverage route and language-selection behavior.
- Session-scoped coverage language memory.
- Canonical URL normalization for default, remembered, and legacy query states.
- Focused red/green tests around pure helper contracts.
- Mock-mode browser smoke through the real Manager UI.
- Updating the attached `feat-114` roadmap doc and this implementation plan.

Out of scope:

- Redesigning the language picker or coverage layout.
- Changing `/api/video-coverage` aggregation semantics.
- Making metadata coverage language-specific.
- Creating account-level or cross-device language preferences.
- Removing legacy `languageIds` support.
- Adding a TSX/jsdom test stack to Manager just for this slice.

## Implementation Plan

### Unit 1: Add Red tests for coverage language state resolution

Red:

- Extend `apps/manager/src/features/coverage/language-selection.test.ts`.
- Add failing tests for a new pure resolver that can decide the next canonical coverage selection from:
  - current query string
  - remembered session IDs
  - available `LanguageOption[]`
  - whether the selection came from user intent or automatic defaulting
- Cover:
  - explicit `languageId` wins over memory
  - legacy `languageIds` wins over memory and normalizes to `languageId`
  - remembered IDs are used when the route has no language query
  - English is resolved from catalog when no query and no memory exist
  - no English match returns no automatic default
  - clearing all IDs resets remembered custom selection

Expected red evidence:

```bash
pnpm --filter @forge/manager test -- --run src/features/coverage/language-selection.test.ts
```

The new tests should fail before helper implementation.

Green:

- Add small helpers in `apps/manager/src/features/coverage/language-selection.ts`, for example:
  - `hasExplicitCoverageLanguageQuery(searchParamsOrQuery)`
  - `resolveEnglishLanguageId(languages)`
  - `resolveCoverageLanguageSelection(input)`
  - `readRememberedCoverageLanguageIds(storage)`
  - `writeRememberedCoverageLanguageIds(storage, ids)`
  - `clearRememberedCoverageLanguageIds(storage)`
- Keep helper behavior pure or storage-injected where possible so it remains testable under the current Node-only Vitest config.
- Reuse existing `parseRequestedLanguageIds()` and `normalizeCoverageLanguageSearchParams()`.

Refactor:

- Keep `languageId` as the only canonical browser query key.
- Keep unrelated query params that `normalizeCoverageLanguageSearchParams()` already preserves.
- Keep `refresh`, `languageId`, and `languageIds` cleanup centralized.

### Unit 2: Canonicalize bare, remembered, and legacy routes in the coverage client

Red:

- The Unit 1 helper tests should describe the route decisions before React wiring changes.
- Add at least one focused helper assertion that the intended navigation mode is `replace` for automatic default, remembered restore, and legacy normalization.

Green:

- In `apps/manager/src/features/coverage/coverage-report-client.tsx`, after `/api/languages` resolves:
  - detect whether the current URL has explicit `languageId` or `languageIds`
  - if legacy `languageIds` is present, `router.replace()` the canonical singular `languageId`
  - if no explicit query and remembered custom selection exists, `router.replace()` to canonical `languageId=<remembered>`
  - if no explicit query and no remembered selection exists, resolve English from `languageCatalog` and `router.replace()` to canonical English
  - if English is unavailable, leave the current empty-state behavior alone
- Use `router.replace` to avoid polluting browser history with automatic state repair.
- Keep `selectedLanguageIds` URL-derived; do not create a second hidden React state source for coverage data.

Refactor:

- Avoid changing coverage filtering, report type, enrichment selection, or `/api/videos` fetch semantics.
- Avoid adding `any` beyond the existing typed-route escape hatches already used for dynamic query strings.

### Unit 3: Persist user-initiated language changes and reset on clear

Red:

- Extend helper tests for memory write/reset behavior:
  - non-empty user selection writes the exact deduped IDs
  - explicit empty selection clears memory
  - automatic English default does not write custom memory
  - explicit user-selected English does write memory

Green:

- Update `CoverageReportClient.applySelectedLanguages()` to write remembered custom selection before navigating:
  - non-empty arrays: store exact normalized IDs in `sessionStorage`
  - empty arrays: clear stored custom selection
- Pass an equivalent callback or intent flag into `LanguageGeoSelector` if needed so pill removal and picker confirmation both run through the same memory/update helper.
- Keep `LanguageGeoSelector` URL writes canonical by continuing to use `normalizeCoverageLanguageSearchParams()`.

Refactor:

- Do not let shell Report nav carry hidden state by manually appending query params. Bare Report links should remain safe because the coverage page repairs bare state using memory/default rules.
- Keep session memory scoped to a clearly named key, such as `forge-coverage-language-ids`.

### Unit 4: Preserve API and mock coverage parity

Red:

- Existing API tests should continue to pass:

```bash
pnpm --filter @forge/manager test -- --run src/app/api/videos/route.test.ts src/app/api/videos/route.mock.test.ts
```

- If implementation touches API code, add a failing route/cache test first. Otherwise, do not broaden API scope.

Green:

- Keep `/api/videos` receiving `languageIds`, not browser-facing `languageId`.
- Keep mock gateway behavior unchanged: selected IDs alter subtitle/audio coverage counts while preserving the video set.
- Keep metadata coverage derived from existing `aiMetadata` behavior.

Refactor:

- Do not touch CMS schema, GraphQL codegen, or Strapi video coverage SQL.

### Unit 5: User smoke test and PR validation

Run this only after green focused tests.

Mock-mode browser smoke:

1. Start Manager in mock mode on this branch.
2. Log in with:
   - email: `manager@forge.test`
   - password: `mock-manager-password`
3. Open `/dashboard/coverage` in a fresh browser session.
4. Confirm English is selected and the URL is canonicalized to `?languageId=529`.
5. Confirm the coverage request uses `/api/videos?languageIds=529`.
6. Select French `6414` or Spanish `21028`.
7. Navigate to Jobs or Agents.
8. Click Report.
9. Confirm the same custom selected language chips return without reselecting.
10. Confirm the URL is canonical `languageId=...` and coverage data changes meaningfully, not just the selected chip.
11. Open `/dashboard/coverage?languageId=529` while session memory has another language and confirm English wins.
12. Open `/dashboard/coverage?languageIds=6414` and confirm it normalizes to `languageId=6414`.
13. Remove the last selected language, then return to bare `/dashboard/coverage` and confirm English is selected again.

PR-focused validation:

```bash
pnpm --filter @forge/manager test -- --run src/features/coverage/language-selection.test.ts src/app/api/videos/route.test.ts src/app/api/videos/route.mock.test.ts
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
git diff --check
```

Before PR:

- Keep branch name `feat/114-manager-coverage-language-persistence`.
- Keep PR target `main`.
- Do not skip pre-commit hooks.
- Include red/green evidence and browser smoke notes in the PR description.

## Acceptance Criteria

- [x] Bare `/dashboard/coverage` in a fresh Manager session resolves English from `/api/languages`.
- [x] Bare `/dashboard/coverage` canonicalizes to `?languageId=<englishId>` via replace-style navigation.
- [x] English coverage loads without the user manually selecting English.
- [x] Custom single-language selection is remembered across Jobs/Agents/Report dashboard navigation in the same tab.
- [x] Custom multi-language selection is remembered exactly and encoded as comma-separated canonical `languageId`.
- [x] Explicit `?languageId=...` always wins over remembered session selection.
- [x] Legacy `?languageIds=...` works, wins over memory, and normalizes to singular `languageId`.
- [x] Clearing the last selected language clears remembered custom state.
- [x] After clear/reset, a later bare `/dashboard/coverage` falls back to English.
- [x] If English cannot be resolved from the catalog, no hardcoded ID is used and the existing language-first state remains.
- [x] `/api/videos` continues to receive `languageIds` internally.
- [x] Metadata coverage remains library-wide and is not made language-specific.
- [x] Red/Green TDD evidence is captured before implementation is considered complete.
- [x] User smoke test evidence is captured before PR.

## Risks & Mitigations

- Risk: auto-defaulting makes clear selection feel impossible.
  Mitigation: define clear as a custom-memory reset and document that bare coverage falls back to English by product decision.
- Risk: hidden session memory overrides shared links.
  Mitigation: explicit `languageId` and legacy `languageIds` always win.
- Risk: automatic default weakens URL-backed truth.
  Mitigation: canonicalize with `router.replace` so the browser URL reflects the selected language.
- Risk: live and mock behavior diverge.
  Mitigation: keep API unchanged and include mock-mode smoke using seeded English/French/Spanish IDs.
- Risk: React component tests require new test infrastructure.
  Mitigation: keep red/green unit coverage in pure helpers under existing Node Vitest, and prove integrated behavior with browser smoke.

## Verification Checklist

- [x] Red test fails before implementation.
- [x] Targeted helper tests pass after implementation.
- [x] API regression tests pass.
- [x] Lint passes.
- [x] Typecheck passes.
- [x] `git diff --check` passes.
- [x] Mock-mode browser smoke passes with screenshots or written evidence.
- [x] `docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md` is returned to `status: "complete"` when implementation and smoke are done.

## Completion Evidence

- Red: `pnpm --filter @forge/manager test -- --run src/features/coverage/language-selection.test.ts` failed before helper implementation because the new resolver/storage helpers did not exist.
- Green: `pnpm --filter @forge/manager test -- --run src/features/coverage/language-selection.test.ts src/app/api/videos/route.test.ts src/app/api/videos/route.mock.test.ts` passed with 19 tests.
- Validation: `pnpm --filter @forge/manager lint`, `pnpm --filter @forge/manager typecheck`, and `git diff --check` passed.
- Smoke: mock-mode Manager browser proof captured screenshots and HAR under `output/smoke/fcdb-coverage-language/`, including default English, custom French restore after Jobs navigation, explicit query override, legacy query normalization, and clear/reset fallback to English.

## References

- Brainstorm: `docs/brainstorms/2026-05-01-manager-coverage-language-persistence-requirements.md`
- Roadmap: `docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md`
- Query helpers: `apps/manager/src/features/coverage/language-selection.ts`
- Coverage client: `apps/manager/src/features/coverage/coverage-report-client.tsx`
- Language picker: `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`
- Shell nav/session pattern: `apps/manager/src/features/shell/manager-shell.tsx`
- Manager language route: `apps/manager/src/app/api/languages/route.ts`
- Mock seed language IDs: `apps/manager/src/cms/mock-seed.ts`
