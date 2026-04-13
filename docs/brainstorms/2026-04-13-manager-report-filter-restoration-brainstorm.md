---
date: 2026-04-13
topic: manager-report-filter-restoration
related:
  - docs/roadmap/media-generation/feat-030-video-content-discovery-dashboard.md
  - docs/roadmap/media-generation/feat-084-manager-agents-automations.md
  - docs/roadmap/media-generation/feat-084-enrich-now-feedback.md
  - docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md
  - docs/solutions/ui-bugs/manager-enrich-now-feedback-handoff-20260413.md
  - docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md
---

# Manager Report Filter Restoration

## What We're Building

When an operator opens the Manager Report coverage page with URL-backed filters
selected, such as `/dashboard/coverage?languageId=529`, then moves to Jobs or
Agents and returns to Report, the Report page should reopen with the same
selection instead of dropping back to `/dashboard/coverage`.

The important behavior is continuity: Report is the operator's working context,
and Jobs or Agents are supporting screens. A quick check of job progress or
automation settings should not make the operator rebuild the language selection
they already made.

## Requirements

- R1. Starting from `/dashboard/coverage?languageId=529`, navigating to Jobs and
  then returning to Report restores `/dashboard/coverage?languageId=529`.
- R2. Starting from `/dashboard/coverage?languageId=529`, navigating to Agents
  and then returning to Report restores `/dashboard/coverage?languageId=529`.
- R3. The behavior applies to URL-backed Report filters, with `languageId` as
  the canonical current example.
- R4. Legacy `languageIds` links should still be accepted, but return paths
  should prefer the canonical `languageId` shape where the route is rewritten.
- R5. Direct navigation to `/dashboard/coverage` without a prior URL-backed
  Report context still opens the default language-first Report state.
- R6. Clearing the Report language selection should clear the carried Report
  filter context rather than keeping a stale language active.

## Why This Approach

The recommended approach is to preserve URL-backed Report state through the
Manager dashboard navigation and Report-originated handoffs. This keeps the
selection visible in the URL, matches the existing coverage filter contract, and
avoids inventing a hidden cross-page state store for a URL-shaped problem.

We considered three options:

- Carry the Report query through dashboard navigation. This is transparent,
  matches the user's URL example, and keeps Jobs and Agents as temporary stops
  without losing the Report context.
- Remember the last Report URL in browser session storage. This would avoid
  query strings on Jobs and Agents, but it would make the return behavior hidden
  and easier to confuse with direct links.
- Promote every local Report control to URL state. This could eventually cover
  search text, collection type, coverage segment, and report type, but it is
  broader than the reported bug. V1 should only preserve filters that are
  already URL-backed or intentionally promoted during planning.

## Key Decisions

- Preserve URL-backed Report selections across Report -> Jobs -> Report and
  Report -> Agents -> Report loops.
- Treat `languageId` as the canonical query key while continuing to accept
  legacy `languageIds` input.
- Keep the behavior scoped to Manager dashboard navigation and Report-originated
  handoffs; do not change CMS coverage queries or coverage aggregation.
- Do not persist unrelated local UI controls unless planning explicitly decides
  to make them URL-backed filters.
- Let explicit URLs win. If the user opens `/dashboard/coverage` directly, that
  should remain the default state unless they arrived through a carried Report
  context.

## Success Criteria

- From `/dashboard/coverage?languageId=529`, click Jobs, then click Report: the
  language selection for `529` is restored and the URL includes `languageId=529`.
- From `/dashboard/coverage?languageId=529`, click Agents, then click Report: the
  language selection for `529` is restored and the URL includes `languageId=529`.
- From `/dashboard/coverage?languageIds=529,21028`, the Report selection still
  loads, and any rewritten return URL uses `languageId=529%2C21028` or the
  project-standard equivalent.
- From `/dashboard/coverage`, Report still opens the language-first empty state.
- Removing the selected language and leaving Report does not revive a stale
  language when returning.

## Scope Boundaries

- This is a Manager UI navigation-state fix, not a CMS data or coverage-query
  change.
- Do not redesign the Report, Jobs, or Agents screens.
- Do not add global app state for every dashboard filter.
- Do not change the coverage API request shape beyond whatever is needed to
  preserve the existing URL-backed filter contract.

## Resolved Questions

- The first filter to preserve is the existing language selection represented by
  `languageId`.
- The route should remain shareable and understandable by keeping the selection
  visible in URL query parameters.
- Existing query normalization in `language-selection.ts` is the contract to
  respect during planning.
- Jobs and Agents can ignore the carried Report query if they do not need it;
  the user-facing requirement is that returning to Report restores the selection.

## Open Questions

No product-level blockers remain for planning.

## Next Steps

Proceed to `/workflows:plan` for a narrow Manager navigation-state fix. The
likely entry points are `apps/manager/src/features/nav/dashboard-nav.tsx`,
`apps/manager/src/features/coverage/language-selection.ts`, and the existing
Coverage-to-Jobs handoff paths in `apps/manager/src/features/coverage/`.
