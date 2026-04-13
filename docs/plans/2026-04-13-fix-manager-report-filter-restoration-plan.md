---
title: "fix: Manager Report filter restoration"
type: fix
status: active
date: 2026-04-13
branch: fix/manager-report-filter-restore
origin:
  - docs/brainstorms/2026-04-13-manager-report-filter-restoration-brainstorm.md
related_roadmap:
  - docs/roadmap/media-generation/feat-030-video-content-discovery-dashboard.md
  - docs/roadmap/media-generation/feat-084-manager-agents-automations.md
related_docs:
  - docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md
  - docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md
  - docs/solutions/ui-bugs/manager-enrich-now-feedback-handoff-20260413.md
---

# fix: Manager Report filter restoration

## Overview

Restore URL-backed Manager Report context when operators move between the
dashboard tabs. Starting at `/dashboard/coverage?languageId=529`, clicking Jobs
or Agents and then returning to Report should reopen the same language-filtered
Report selection instead of the default `/dashboard/coverage` language-first
state.

This is a narrow Manager navigation-state fix. The coverage data model, CMS
queries, report rendering, and local-only Report controls should stay unchanged.

## Found Brainstorm

Found brainstorm from 2026-04-13: `manager-report-filter-restoration`. It
resolves the product direction:

- Preserve URL-backed Report selections across Report -> Jobs -> Report and
  Report -> Agents -> Report loops.
- Treat `languageId` as the canonical query key while continuing to accept
  legacy `languageIds` input.
- Keep the behavior scoped to Manager dashboard navigation and Report-originated
  handoffs.
- Direct `/dashboard/coverage` should still open the default language-first
  state.
- Clearing the Report language selection should clear the carried context.

## Requirements Trace

- R1. Starting from `/dashboard/coverage?languageId=529`, navigating to Jobs and
  then returning to Report restores `/dashboard/coverage?languageId=529`.
- R2. Starting from `/dashboard/coverage?languageId=529`, navigating to Agents
  and then returning to Report restores `/dashboard/coverage?languageId=529`.
- R3. Preserve URL-backed Report filters; for V1 this means the existing
  language filter.
- R4. Accept legacy `languageIds` links, but rewrite carried return paths to the
  canonical `languageId` shape.
- R5. Direct navigation to `/dashboard/coverage` without a language query keeps
  the current default language-first Report state.
- R6. Clearing the Report language selection clears the carried context rather
  than reviving a stale language.
- R7. Use Red/Green TDD before implementation and record failing-first evidence.
- R8. Complete a user-like browser smoke test before PR handoff.

## Research Summary

Local research found strong existing patterns, so external research was skipped.
This fix does not introduce a new dependency, payment/security flow, privacy
concern, or unfamiliar framework surface.

Relevant repo conventions:

- Branch naming follows `fix/description`; current branch is
  `fix/manager-report-filter-restore`.
- PR titles use `type(scope): description`, target `main`, and are squash-merged.
- Never use `--no-verify`.
- Manager tests use Vitest in a Node environment with colocated `.test.ts`
  files; browser/user smoke tests are captured separately.
- Manager UI changes should reuse existing styles and colors.

Relevant entry points:

- `apps/manager/src/features/nav/dashboard-nav.tsx` currently hardcodes bare
  tab links to `/dashboard/coverage`, `/dashboard/jobs`, and
  `/dashboard/agents`.
- `apps/manager/src/app/dashboard/coverage/page.tsx` seeds selected language IDs
  from incoming `searchParams`.
- `apps/manager/src/features/coverage/language-selection.ts` is the canonical
  parser/normalizer for `languageId` and legacy `languageIds`.
- `apps/manager/src/features/coverage/LanguageGeoSelector.tsx` already uses
  `useSearchParams()` plus `normalizeCoverageLanguageSearchParams()` when
  writing coverage selection URLs.
- `apps/manager/src/features/jobs/live-jobs-table.tsx` already has a small
  precedent for preserving `languageId` when linking from the Jobs list to job
  detail pages.

Compound docs to incorporate:

- `manager-coverage-language-first-empty-state-20260410.md`: `languageId` is
  canonical, `languageIds` is read compatibility, and stale language params must
  be deleted before writing a new selection.
- `manager-coverage-dashboard-review-regression-cleanup.md`: keep coverage UI
  states distinct; do not let navigation changes blur loading, empty, and
  failure states.
- `manager-enrich-now-feedback-handoff-20260413.md`: Coverage-to-Jobs handoffs
  should preserve operator context and avoid hidden state overwriting newer
  user choices.

No dedicated roadmap ticket exists for this exact bug. Use `feat-030` and the
completed Agents/Enrich Now work as context only; do not pretend either roadmap
ticket is the active tracking item unless a follow-up ticket is explicitly
created.

## SpecFlow Notes

User flows:

1. Report -> Jobs -> Report with selected language: preserve and restore
   `languageId`.
2. Report -> Agents -> Report with selected language: preserve and restore
   `languageId`.
3. Legacy URL -> return path: accept `languageIds` on entry and canonicalize the
   carried return query to `languageId`.
4. Clear selection -> leave Report -> return: keep the default Report empty
   state; do not resurrect the cleared language.
5. Direct entry: `/dashboard/coverage` remains explicit and should not consult
   hidden prior browser/session state.

Important gaps addressed by this plan:

- Dashboard tab navigation is the missing handoff; coverage parsing already
  exists.
- Avoid hidden browser-memory fallback unless implementation proves URL-based
  handoff cannot work.
- "Any filters selected" is scoped to URL-backed Report filters. Local Report
  controls such as search text, collection type, coverage segment, and
  `reportType` are not promoted to URL state in this slice.
- Add nav-oriented regression coverage; current tests only cover parsing and
  empty-state behavior.

## Proposed Solution

Keep the selected Report language in the dashboard tab URLs while an operator is
moving between dashboard tabs:

1. Add a small node-testable nav/query helper that extracts only supported
   coverage Report query state from the current URL query.
2. Canonicalize `languageIds` to `languageId`.
3. Use the helper from `DashboardNav` with `useSearchParams()` to build Report,
   Jobs, and Agents tab hrefs.
4. Carry only the coverage Report query allowlist. Do not copy arbitrary
   Jobs/Agents query params back into Report.
5. If no selected language exists, emit plain tab links with no query string.

Recommended helper shape:

```ts
// apps/manager/src/features/nav/dashboard-nav-model.ts
export function buildDashboardNavHref(
  pathname: "/dashboard/coverage" | "/dashboard/jobs" | "/dashboard/agents",
  currentQuery: string,
): string
```

The helper can import the existing coverage language parsing/normalization
utilities, or an adjacent helper can be added in `language-selection.ts` if that
keeps the ownership clearer. Keep this decision small: one shared owner for the
navigation query contract, with tests.

## Scope Boundaries

In scope:

- Manager dashboard navigation links for Report, Jobs, and Agents.
- Canonical language filter carry-forward across tab navigation.
- Legacy `languageIds` read compatibility.
- Focused Red/Green unit tests for the URL helper/navigation contract.
- User-like browser smoke test against the rendered Manager dashboard flow.

Out of scope:

- CMS coverage SQL, GraphQL, or API changes.
- Coverage data fetching behavior.
- Report visual redesign.
- Jobs or Agents feature work unrelated to preserving the Report return query.
- A global dashboard state store.
- Persisting non-URL-backed Report controls.
- Adding React Testing Library, jsdom, or a new browser test stack to the
  Manager package for this small fix.

## Implementation Plan

### Unit 1: Red test for dashboard nav URL carry-forward

Red:

- Add `apps/manager/src/features/nav/dashboard-nav-model.test.ts`.
- Write failing tests for the node-testable helper:
  - `buildDashboardNavHref("/dashboard/jobs", "languageId=529")` returns
    `/dashboard/jobs?languageId=529`.
  - `buildDashboardNavHref("/dashboard/coverage", "languageId=529")` returns
    `/dashboard/coverage?languageId=529`.
  - `buildDashboardNavHref("/dashboard/agents", "languageIds=529,21028")`
    returns `/dashboard/agents?languageId=529%2C21028` or the
    project-standard encoded equivalent.
  - no language query returns the bare target pathname.
  - unknown non-coverage query keys are not carried across tabs.
  - `refresh=1` is not carried.

Green:

- Add the helper in `apps/manager/src/features/nav/dashboard-nav-model.ts`, or
  add the helper to `apps/manager/src/features/coverage/language-selection.ts`
  if the implementation keeps the nav model too thin.
- Use `resolveRequestedLanguageIds()` and/or
  `normalizeCoverageLanguageSearchParams()` so `languageId` remains canonical.
- Carry only the supported coverage Report query allowlist.

Refactor:

- Keep `language-selection.test.ts` focused on coverage query parsing and
  normalization. Avoid duplicating the same normalization tests in every tab
  test.

### Unit 2: Wire `DashboardNav` to the helper

Red:

- The Unit 1 helper tests should fail until the helper exists.
- If wiring confidence is low, add a minimal test around the exported href model
  rather than introducing a React nav component test stack.

Green:

- Update `apps/manager/src/features/nav/dashboard-nav.tsx` to import
  `useSearchParams()` from `next/navigation`.
- Convert `searchParams?.toString() ?? ""` into three hrefs via the helper:
  - Report
  - Jobs
  - Agents
- Replace the hardcoded `href="/dashboard/coverage"`,
  `href="/dashboard/jobs"`, and `href="/dashboard/agents"` values with the
  computed hrefs.
- Preserve existing active-tab detection, queue count polling, logout behavior,
  user menu behavior, icons, labels, and CSS classes.

Refactor:

- Keep this change inside the shared dashboard nav and the helper. Do not push
  coverage-specific state deeper into Jobs or Agents pages unless the user smoke
  exposes a real gap.

### Unit 3: Check Coverage-originated Jobs handoffs

Red:

- No new app code test is required if the existing accepted Jobs action already
  starts at `/dashboard/jobs` and the shared nav can carry the query once the
  user is on a query-bearing dashboard tab.
- If manual review shows a redirect/link from Coverage to Jobs that bypasses
  the query-bearing nav and must preserve Report context, add a focused helper
  test before changing it.

Green:

- Inspect `apps/manager/src/features/enrich-selection.ts` and
  `apps/manager/src/features/coverage/coverage-report-client.tsx`.
- If Coverage success actions still send users to plain `/dashboard/jobs`, keep
  that behavior only if the operator can still return to Report with the
  current language through the shared nav.
- If the handoff loses context in smoke testing, route those Coverage-originated
  Jobs links through the same helper with the current query string.

Refactor:

- Do not reintroduce auto-redirect-only behavior that hides local feedback. The
  Enrich Now feedback fix deliberately kept acceptance feedback and Jobs links
  visible.

### Unit 4: User smoke test and PR hygiene

Run the user-like browser smoke before PR handoff:

1. Start or reuse local Manager at `http://localhost:3002` with Manager auth.
2. Open `/dashboard/coverage?languageId=529`.
3. Confirm Report opens with language `529` selected.
4. Click Jobs.
5. Confirm the URL is `/dashboard/jobs?languageId=529` or equivalent canonical
   query form.
6. Click Report.
7. Confirm the URL is `/dashboard/coverage?languageId=529` and the language
   selection is still active.
8. Click Agents.
9. Confirm the URL is `/dashboard/agents?languageId=529`.
10. Click Report again and confirm the language selection remains active.
11. Open `/dashboard/coverage?languageIds=529,21028`, repeat a short tab
    round-trip, and confirm the carried URL uses canonical `languageId`.
12. Clear the Report language selection, click Jobs, then Report, and confirm
    the default language-first state remains.
13. Capture smoke evidence in work notes or PR notes.

If local Manager auth/CMS data blocks the real dashboard smoke, use a temporary
uncommitted smoke route under `/login/report-filter-smoke` that renders the real
`DashboardNav` with a test user and verifies the same click flow. Remove the
temporary route before commit and document the limitation clearly.

PR hygiene:

- Keep the PR title in the required format:
  `fix(manager): restore report filters`.
- Target `main`.
- Do not use `--no-verify`.
- Before PR creation, run `gh pr list --state all --limit 20` to check current
  PR title/body conventions if needed.
- Complete `ce:review` before PR handoff and `ce:compound` after the fix lands
  if a reusable navigation-state learning emerges.

## Acceptance Criteria

- [ ] From `/dashboard/coverage?languageId=529`, Jobs then Report restores
      `/dashboard/coverage?languageId=529`.
- [ ] From `/dashboard/coverage?languageId=529`, Agents then Report restores
      `/dashboard/coverage?languageId=529`.
- [ ] Report -> Jobs -> Agents -> Report preserves the same selected language.
- [ ] Legacy `/dashboard/coverage?languageIds=529,21028` still loads and any
      carried dashboard-tab query is canonicalized to `languageId`.
- [ ] Direct `/dashboard/coverage` still opens the language-first default state.
- [ ] Clearing the Report language selection and navigating away does not revive
      a stale language on return.
- [ ] Unknown Jobs/Agents query params are not copied into Report as hidden
      Report state.
- [ ] Red/Green TDD evidence is captured in work notes or PR notes.
- [ ] User smoke test evidence is captured before PR handoff.
- [ ] Manager lint, typecheck, focused tests, and build pass before PR.
- [ ] Root format-sensitive validation passes before PR.

## Verification

Red first:

```bash
pnpm --filter @forge/manager test -- src/features/nav/dashboard-nav-model.test.ts
```

Green after implementation:

```bash
pnpm --filter @forge/manager test -- src/features/nav/dashboard-nav-model.test.ts
pnpm --filter @forge/manager test -- src/features/coverage/language-selection.test.ts
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager build
pnpm run format:check
git diff --check
```

If the implementation touches broader Coverage or Jobs behavior, also run:

```bash
pnpm --filter @forge/manager test
```

User smoke:

- Run the browser flow in Unit 4.
- Save screenshot or URL/assertion notes in work notes or PR notes.
- If a temporary smoke route is used, remove it before committing and document
  why the real authenticated dashboard path was unavailable.

## Risks

- `useSearchParams()` in the shared nav could affect build behavior if the route
  stops being dynamic. Mitigation: run the Manager build, not only lint and
  typecheck.
- Accidentally copying arbitrary Jobs/Agents query params into Report could
  create confusing future state. Mitigation: use an allowlisted helper and test
  unknown-key behavior.
- A hidden session-storage solution could make direct `/dashboard/coverage`
  behave differently based on browsing history. Mitigation: keep the first
  implementation URL-based.
- The phrase "any filters selected" could invite a much larger URL-state
  migration. Mitigation: scope V1 to existing URL-backed language filters and
  let future Report filters opt in explicitly.

## References

- `docs/brainstorms/2026-04-13-manager-report-filter-restoration-brainstorm.md`
- `apps/manager/src/features/nav/dashboard-nav.tsx`
- `apps/manager/src/features/coverage/language-selection.ts`
- `apps/manager/src/features/coverage/language-selection.test.ts`
- `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`
- `apps/manager/src/features/coverage/coverage-report-client.tsx`
- `apps/manager/src/app/dashboard/coverage/page.tsx`
- `apps/manager/src/features/jobs/live-jobs-table.tsx`
- `docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md`
- `docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md`
- `docs/solutions/ui-bugs/manager-enrich-now-feedback-handoff-20260413.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/workflows/ci.yml`
