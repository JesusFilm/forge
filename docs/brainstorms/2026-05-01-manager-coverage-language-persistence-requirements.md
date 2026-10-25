---
date: 2026-05-01
topic: manager-coverage-language-persistence
---

# Manager Coverage Language Persistence

Roadmap: `docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md`

## Problem Frame

The Manager coverage report currently treats language selection as URL state only. That keeps shared links honest, but it creates a frustrating operator loop: a user can select a custom language set, move to another dashboard page, return to `/dashboard/coverage`, and land back in the language-first state because the main dashboard navigation points at the bare route.

The default first-run experience also does not match the expected workflow. When a manager opens `/dashboard/coverage` without a language query, English should already be selected so the report is useful immediately. Users should not have to repeatedly reselect English or their own custom languages during normal dashboard navigation.

## Requirements

- R1. A first visit to `/dashboard/coverage` with no explicit language query and no remembered coverage selection selects English by default.
- R2. English is resolved from the Manager language catalog by the existing language identity, not by hardcoding a display-only label into coverage API calls.
- R3. When a user selects one or more custom languages, that exact selected set becomes the remembered coverage selection for the current dashboard session.
- R4. If the user navigates to other Manager dashboard pages and returns to `/dashboard/coverage`, the coverage report restores the remembered custom language selection.
- R5. An explicit coverage URL query, such as `?languageId=529` or legacy `?languageIds=529`, always wins over remembered state.
- R6. The browser URL remains canonical: coverage page state should continue to use `languageId` for selected languages, while internal API calls may keep using the existing `languageIds` API contract.
- R7. Clearing the selected language set intentionally resets the remembered custom selection; the next bare coverage visit falls back to English.

## Success Criteria

- Opening `/dashboard/coverage` from a fresh Manager session shows English selected and loads English-scoped coverage without manual selection.
- Selecting Spanish, French, or a multi-language custom set, visiting Jobs or Agents, and returning to Report preserves the same selected language chips and report data.
- Visiting a copied URL with `languageId` produces the URL's selection even if the session previously remembered a different custom set.
- Existing legacy links that use `languageIds` still work and are normalized to the canonical `languageId` route state.

## Scope Boundaries

- This is not a redesign of the coverage language picker.
- This does not change coverage aggregation semantics or the `/api/video-coverage` data contract.
- This does not make metadata coverage language-specific.
- This does not require persistent cross-device preferences; same-browser session memory is enough for the stated workflow.
- This does not remove support for legacy `languageIds` links.

## Approaches Considered

### Recommended: URL-Authoritative State With Session Return Memory

Keep the URL as the source of truth whenever it names a language selection, and add a remembered coverage selection only for bare `/dashboard/coverage` returns. First bare visit resolves to English; later bare returns restore the user's last custom selection.

This best fits the existing Manager pattern because coverage already centralizes query parsing and normalization around `languageId`, while shell mode and report type already use session storage for dashboard-scoped preferences.

### Alternative: URL Carry-Forward Only

Every dashboard link back to Report could carry the current `languageId` query. This is transparent and keeps state shareable, but it only works for links that are explicitly rewritten and does not help direct bare-route returns.

### Alternative: Hidden Preference Only

The app could ignore the URL unless users explicitly share one and always restore a stored language preference. That would reduce visible query churn, but it would weaken the existing URL-backed contract and make copied links less predictable.

## Key Decisions

- URL-backed selection remains authoritative: explicit `languageId` must always override remembered state.
- English is the default only when the user has not provided a language query and has no remembered coverage selection.
- Remembered selection is dashboard/session scoped, not a new durable account preference.
- Clearing all languages resets the remembered custom selection rather than preserving an invisible stale value.
- Planning should reuse `apps/manager/src/features/coverage/language-selection.ts` as the central state contract.

## Dependencies / Assumptions

- The Manager language catalog contains an English language option that can be resolved consistently.
- The existing language selector and coverage API paths continue to support comma-separated multi-language IDs.
- The current shell already stores coverage mode and report type in session storage, so session-scoped language memory is consistent with nearby Manager behavior.
- Related context lives in:
  - `docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md`
  - `docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md`
  - `docs/solutions/integration-issues/manager-mock-coverage-language-parity-20260422.md`
  - `docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md`
  - `docs/roadmap/media-generation/feat-041-alternative-report-sections.md`

## Outstanding Questions

None. The requested behavior is specific enough for planning.

## Next Steps

-> `/workflows:plan docs/brainstorms/2026-05-01-manager-coverage-language-persistence-requirements.md`
