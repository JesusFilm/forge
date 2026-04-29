---
title: "Manager Report Filter Dashboard Tab Handoff"
category: ui-bugs
date: 2026-04-13
severity: medium
tags:
  - manager
  - coverage
  - dashboard
  - query-params
  - navigation
affected_components:
  - apps/manager/src/features/nav/dashboard-nav.tsx
  - apps/manager/src/features/nav/dashboard-nav-model.ts
  - apps/manager/src/features/coverage/coverage-report-client.tsx
  - apps/manager/src/features/coverage/enrich-action-controls.tsx
related_docs:
  - docs/plans/2026-04-13-fix-manager-report-filter-restoration-plan.md
  - docs/brainstorms/2026-04-13-manager-report-filter-restoration-brainstorm.md
  - docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md
  - docs/solutions/ui-bugs/manager-enrich-now-feedback-handoff-20260413.md
---

# Manager Report Filter Dashboard Tab Handoff

## Problem

Manager Report selections are URL-backed with `languageId`, but the shared
dashboard tab nav linked to bare `/dashboard/coverage`, `/dashboard/jobs`, and
`/dashboard/agents`. Operators who opened
`/dashboard/coverage?languageId=529`, visited Jobs or Agents, and then returned
to Report landed on the default language-first state instead of the selected
language report.

## Root Cause

Coverage already parsed `languageId` and legacy `languageIds`, but the dashboard
nav had no query handoff contract. Copying every query key would have risked
leaking Jobs or Agents state back into Report, while carrying nothing dropped
the only existing Report filter with durable URL state.

## Solution

Create a small dashboard nav model that:

- reads only the supported Report language query state from the current URL
- accepts legacy `languageIds` but writes canonical `languageId`
- drops unrelated keys such as `status` or `refresh`
- returns bare dashboard tab paths when no language is selected
- uses Next typed-route-compatible return types so `next build` catches route
  issues

Use that helper from `DashboardNav` for Report, Jobs, and Agents tab links.
Route Coverage-originated Jobs feedback links through the same helper so an
operator can open a created job from Report and still return with the selected
language intact.

## Prevention

1. Treat URL-backed dashboard state as an allowlisted contract, not a raw query
   string copy.
2. Keep old query keys read-compatible, but canonicalize any link the app writes
   back to the current key.
3. Put cross-tab URL behavior in a node-testable model before wiring React nav
   components.
4. For Manager UI fixes, include a browser smoke that exercises the real
   authenticated dashboard layout, using a local mock only for upstream CMS/auth
   dependencies when needed.

## Verification

- `pnpm --filter @forge/manager test -- src/features/nav/dashboard-nav-model.test.ts src/features/coverage/enrich-action-controls.test.ts`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `CI=1 pnpm --filter @forge/manager build`
- `pnpm format:check`
- `git diff --check`
- Browser smoke screenshots under `output/playwright/report-filter-smoke/`

## Related References

- `apps/manager/src/features/nav/dashboard-nav.tsx`
- `apps/manager/src/features/nav/dashboard-nav-model.ts`
- `apps/manager/src/features/coverage/language-selection.ts`
- `apps/manager/src/features/coverage/enrich-action-controls.tsx`
