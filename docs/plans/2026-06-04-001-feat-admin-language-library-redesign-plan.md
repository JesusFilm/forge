---
title: "feat: Admin language library visual redesign"
type: feat
status: completed
date: 2026-06-04
roadmap: docs/roadmap/platform/feat-158-admin-language-library-redesign.md
---

# feat: Admin language library visual redesign

## Summary

Rework `/dashboard/languages` from a nested diagnostics panel into a
Videos-style language browser: search first, compact filters, a single primary
list, stronger row hierarchy, country/flag preview chips, and the same read-only
detail modal behavior that shipped with the diagnostics browser.

## Problem Frame

The user provided the current Languages page and the redesigned Videos page as
the visual comparison. Languages already exposes the diagnostic corpus from
`feat-155`, but it still leads with summary cards, a left diagnostics panel, a
right operator rail, and filter chips that feel heavier and less catalog-like
than `/dashboard/videos`. This plan is a visual and interaction refinement over
the existing diagnostic dataset, not another data-model feature.

## Visual Thesis

Dense operator catalog, dark surface hierarchy, monospace reference accents,
and the same row-based rhythm as Videos; Languages should feel like a sibling
library surface, not a separate diagnostics tool.

## Content Plan

The page should flow as header, full-width search, compact filter controls,
small active-state summary, one primary language list, and the existing
read-only detail modal. Secondary locale-signal cards and operator notes should
move out of the first scanning path or be removed if they duplicate row context.

## Interaction Plan

Search remains instant client-side with a clear action. Filters become compact
select controls that update the existing client state. Rows keep hover/focus
affordances because they open the detail modal, while country preview chips and
status chips remain informational only.

## Assumptions

_This plan was authored in LFG/headless mode. The items below are agent
inferences that fill gaps in the input and should be reviewed during
implementation and PR review._

- The redesign should preserve client-side search/filtering from `feat-155`
  instead of introducing URL-backed or server-side language search.
- "Flags" means country preview flag/country signals derived from existing
  `countryPreviews`; if no flag asset exists in the current data shape, a
  compact country-code/text chip is acceptable for this slice.
- The existing detail modal should stay in place and receive visual polish only
  where needed to match the flatter list surface.
- Locale Signals and Operator Notes are less important than the language index
  in the first viewport; preserving all content is secondary to matching the
  Videos page hierarchy.

## Requirements

- R1. `/dashboard/languages` must visually align with `/dashboard/videos`:
  page-first header, full-width search, compact filters, and one dominant list.
- R2. Existing search behavior must continue to match code, slug, name,
  country, state, provenance, and coverage tokens.
- R3. Existing operational, geo/content, and sync filters must keep their
  predicates and AND semantics while moving into a compact control layout.
- R4. Language rows must become more scannable: title and code identity on the
  left, state/provenance chips near identity, coverage counts and country
  previews in the middle/right, and updated time/actions at the edge.
- R5. Rows must remain real keyboard-activatable controls only because they
  open the read-only detail modal.
- R6. Country preview chips must expose meaningful flag/country hierarchy using
  the existing bounded country preview data and overflow behavior.
- R7. The page and modal must remain responsive with no horizontal overflow on
  mobile-width layouts.
- R8. The change must not add writes, schema changes, generated GraphQL changes,
  or public app behavior changes.

## Scope Boundaries

- No language editing, creation, deletion, import/export, saved filters, or
  bulk actions.
- No changes to `loadLanguagesData` query shape unless a row display needs a
  derived field that can be computed from the already loaded row data.
- No server-side language search, pagination, or URL-backed filters in this
  slice.
- No broad `admin-ui` component redesign unless a tiny helper removes real
  duplication without changing other pages.
- No changes to Videos beyond using its existing layout as the reference.

### Deferred to Follow-Up Work

- Real flag images for language country previews if the current admin data
  model does not expose a stable country flag asset.
- URL-backed language filters and pagination for shareable language views.
- Dedicated country or language drill-through pages.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/languages/page.tsx` currently renders the
  header, metric cards, `PageSection` wrapper, `LanguageDiagnostics`, Locale
  Signals, and `OperatorRail`.
- `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx` owns
  client-side search, filter predicates, selected-row modal state, row rendering,
  summary signals, and modal detail sections.
- `apps/admin/src/app/dashboard/languages/language-diagnostics.test.tsx`
  already covers pure search/filter behavior and country preview overflow.
- `apps/admin/src/app/dashboard/videos/page.tsx` is the target layout pattern:
  page header, full-width toolbar, single `app-card` list, row hover/focus
  affordances, compact chips, coverage bar, and right-aligned updated actions.
- `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx` provides the
  compact search/select-control grammar to adapt for client-owned language
  filters.
- `apps/admin/src/app/dashboard/ops-data.ts` already returns
  `LanguageDiagnosticRow` with `countryPreviews`, counts, status/sync tones,
  timestamps, flags, and search text.
- `docs/plans/2026-06-02-003-feat-admin-language-diagnostics-plan.md` is the
  completed data/diagnostics plan whose predicates and modal contract this work
  must preserve.

### Institutional Learnings

- `docs/roadmap/platform/feat-153-admin-interaction-affordance-polish.md`
  requires row affordances to map to real interactions. Language rows remain
  clickable because they open the modal; informational chips should not imply
  separate actions.
- `docs/plans/2026-06-02-003-feat-admin-video-library-screenshot-match-plan.md`
  is the prior Videos visual alignment pass and shows how to keep page-specific
  markup near the route when matching a reference screenshot.

### External References

- User-provided screenshots of `https://admin.jesusfilm.org/dashboard/languages`
  and `https://admin.jesusfilm.org/dashboard/videos` are the design source of
  truth for layout, search, filters, hierarchy, flags, styling, and density.

## Key Technical Decisions

- Keep the redesign in the existing Languages page/client component. The data
  contract is already sufficient for a visual pass, and moving search/filter
  state into URL helpers would broaden scope.
- Replace chip-group filters with select controls because the Videos reference
  uses compact dropdown filters and the Languages filter set is too large for
  first-viewport chip clusters.
- Use a list row pattern rather than a table header pattern. The Videos list
  succeeds because each row carries its own hierarchy; Languages should do the
  same with identity, state, coverage, countries, and timestamps.
- Preserve the modal as the detail destination. The row surface should answer
  scan-level questions; the modal should answer diagnostic detail questions.
- Remove or de-emphasize secondary panels from the first viewport so search,
  filters, and rows own the page, matching the Videos page structure.

## Open Questions

### Resolved During Planning

- Should this continue the completed diagnostics ticket or create a new one?
  Create `feat-158` because `feat-155` is complete and this is a distinct visual
  redesign slice.
- Should the work change the language data loader? No, not unless a tiny derived
  display value is unavoidable during implementation.
- Should filters become URL-backed like Videos? No for this slice; the current
  language explorer is client-owned and this request is primarily visual.

### Deferred to Implementation

- Exact country chip display when multiple country previews exist and no flag
  URL is available: choose the smallest readable pattern from the existing row
  data.
- Whether Locale Signals remains below the list or is removed from the route:
  keep it only if it does not undermine the Videos-like first viewport.

## Implementation Units

### U1. Page Frame and First-Viewport Hierarchy

**Goal:** Recompose the Languages page so the first viewport matches the Videos
index hierarchy and gives the language browser one dominant workspace.

**Requirements:** R1, R7, R8

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/app/dashboard/languages/page.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Replace the current nested `PageSection` plus right `OperatorRail` layout with
  a flatter page frame like Videos: header, browser controls, list surface, then
  any secondary signals below.
- Keep the existing metric data available, but avoid letting metrics dominate
  the first scan path.
- Ensure the page header copy and spacing align with the Videos route while
  preserving the current language page title and diagnostic description.

**Patterns to follow:**

- Header and section flow in `apps/admin/src/app/dashboard/videos/page.tsx`.
- Existing admin shell tokens and `app-card` styling from
  `apps/admin/src/components/admin-ui.tsx`.

**Test scenarios:**

- Happy path: route render includes the Languages title, search control, compact
  filters, and a language row without requiring the old diagnostics section
  wrapper.
- Regression: route still renders the existing summary count context.
- Edge case: empty diagnostic rows still render an empty list state under the
  browser controls.

**Verification:** The Languages route presents as a catalog/index page rather
than a dashboard-with-diagnostics panel.

### U2. Compact Search and Filter Controls

**Goal:** Redesign `LanguageDiagnostics` controls to match the Videos toolbar
grammar while preserving existing filter predicates.

**Requirements:** R1, R2, R3, R7

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
- Test: `apps/admin/src/app/dashboard/languages/language-diagnostics.test.tsx`

**Approach:**

- Keep the existing `query` and `filters` state and pure predicate helpers.
- Replace the large filter chip panel with three compact select controls for
  Operational, Geo/content, and Sync.
- Keep a full-width search field with search icon, clear button, and Videos-like
  border/focus styling.
- Show concise active result context near the controls so operators can see
  filtered count without separate summary cards.

**Patterns to follow:**

- `SelectControl` and search field grammar in
  `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx`.
- Current exported predicate tests in
  `apps/admin/src/app/dashboard/languages/language-diagnostics.test.tsx`.

**Test scenarios:**

- Happy path: all existing filter helper tests continue to pass unchanged.
- Happy path: filter options are still represented for operational,
  geo/content, and sync groups.
- Edge case: clearing search returns the full filtered result set.
- Accessibility: search input, clear action, and selects have accessible labels.

**Verification:** Search and filters look like the Videos controls while
producing the same filtered rows as before.

### U3. Videos-Style Language Rows With Country Signals

**Goal:** Replace table-like language rows with a scannable media-list row
hierarchy inspired by Videos, including country/flag preview chips.

**Requirements:** R4, R5, R6, R7, R8

**Dependencies:** U2

**Files:**

- Modify: `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
- Test: `apps/admin/src/app/dashboard/languages/language-diagnostics.test.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Render each language as an `article` or button-backed row with identity,
  code metadata, status/sync pills, content coverage counts, bounded country
  preview chips, overflow count, and updated time.
- Use the same stable row mechanics as Videos: `app-card` container, hairline
  dividers, hover surface raise, focus-visible inset outline, and responsive
  column collapse.
- Keep row activation and focus return behavior connected to the existing
  modal.
- Treat country preview chips as informational, with compact country labels and
  short IDs rather than independent buttons.

**Patterns to follow:**

- `VideoRow` in `apps/admin/src/app/dashboard/videos/page.tsx`.
- Current modal focus handling in
  `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`.

**Test scenarios:**

- Happy path: rows expose the language title, code label, status/sync labels,
  coverage counts, country preview, and updated timestamp.
- Edge case: no country previews renders a muted no-country state instead of an
  empty chip cluster.
- Edge case: country preview overflow remains bounded and communicates hidden
  count.
- Accessibility: each row remains keyboard activatable and advertises dialog
  activation.

**Verification:** Operators can scan rows like the Videos page and still open
the existing read-only detail modal.

### U4. Validation and Browser Proof

**Goal:** Verify the redesign with targeted admin tests and a browser smoke
pass.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8

**Dependencies:** U1, U2, U3

**Files:**

- Modify: `apps/admin/src/app/dashboard/languages/language-diagnostics.test.tsx`
- Modify: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Keep test coverage focused on predicate preservation, static render markers,
  accessible labels, country overflow behavior, and route-level smoke.
- Run targeted Vitest files plus admin typecheck.
- Use the browser surface required by repo instructions: Helium if callable,
  falling back to `agent-browser` if Helium is unavailable.

**Test scenarios:**

- Automated: language search/filter predicates remain unchanged after the
  visual refactor.
- Automated: route SSR includes the redesigned search/filter/list markers.
- Browser: `/dashboard/languages` shows the redesigned controls and rows.
- Browser: search narrows visible rows, a filter changes the count, a row opens
  the modal, and close/Escape returns to the list.
- Browser: mobile-width smoke confirms no horizontal overflow in controls, row
  content, or modal.

**Verification:** Targeted tests pass, typecheck passes, and browser proof
shows the redesigned page behaves like a usable language browser.

## System-Wide Impact

- **Interaction graph:** `/dashboard/languages` server page ->
  `loadLanguagesData` -> `LanguageDiagnostics` client search/filter/list ->
  read-only detail modal. No public app or GraphQL contract changes.
- **State lifecycle:** Search, filters, and modal selection remain client-local
  and reset on page load.
- **Accessibility:** Row clickability remains justified by modal activation;
  controls must keep labels and focus-visible states.
- **Unchanged invariants:** Core-sourced Language data stays read-only; shared
  static tables do not gain generic row actions.

## Risks & Dependencies

| Risk                                             | Mitigation                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Compact selects hide too many diagnostic states. | Preserve all existing option labels and keep result-count feedback visible.                            |
| Country/flag request exceeds current data shape. | Use existing bounded country preview data now; defer real flag assets if unavailable.                  |
| Flatter page removes useful operator context.    | Keep only secondary context that helps scanning after the main list; preserve core metrics if compact. |
| Visual-only refactor regresses modal behavior.   | Reuse existing modal state/focus code and cover row activation in browser smoke.                       |

## Documentation / Operational Notes

- `docs/roadmap/platform/feat-158-admin-language-library-redesign.md` tracks
  this follow-up visual refinement.
- Mark the roadmap ticket complete after implementation and validation.

## Sources & References

- Related roadmap: `docs/roadmap/platform/feat-158-admin-language-library-redesign.md`
- Related completed roadmap: `docs/roadmap/platform/feat-155-admin-language-diagnostics.md`
- Related code: `apps/admin/src/app/dashboard/languages/page.tsx`
- Related code: `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
- Related code: `apps/admin/src/app/dashboard/videos/page.tsx`
- Related code: `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx`
- Related data: `apps/admin/src/app/dashboard/ops-data.ts`
- Related plan: `docs/plans/2026-06-02-003-feat-admin-language-diagnostics-plan.md`
- Related plan: `docs/plans/2026-06-02-003-feat-admin-video-library-screenshot-match-plan.md`
