---
title: "feat: Admin language diagnostics browser"
type: feat
status: completed
date: 2026-06-02
origin: docs/roadmap/platform/feat-155-admin-language-diagnostics.md
---

# feat: Admin language diagnostics browser

## Summary

Build the admin languages page into a read-only diagnostic browser for the
complete active Core language corpus. The route will load richer server-owned
reference data, hand it to a focused client explorer for search and filters,
and expose a keyboard-accessible detail modal for language, geo, content, and
sync signals.

---

## Problem Frame

Operators can see that language rows exist, but the current page only renders a
small recent slice and gives no way to answer practical questions such as
"which language is this slug?", "why is this reference-only?", "where is this
language used?", or "what did Core sync last provide?". The feature turns the
page from a trust-check summary into an operator-facing diagnostic surface while
preserving the read-only ownership of Core-sourced data.

---

## Assumptions

_This plan was authored in LFG/headless mode. The items below are agent
inferences that fill gaps in the input -- unvalidated bets that downstream
review should scrutinize before implementation proceeds._

- The diagnostic browser should load the complete active language corpus for
  this admin-only page instead of adding a paginated server search first.
- Client-side filtering is acceptable for the current corpus size because the
  admin page already reports roughly 2,300 active language rows.
- "All available details" means complete scalar/reference language fields plus
  bounded relation counts/previews already available in the admin data model,
  not unbounded relation arrays, a schema expansion, or a Core refetch.
- Empty or missing values should be visible as unknown/none states rather than
  hidden, because this page is for diagnostics.

---

## Requirements

- R1. The languages page must search across the complete active language
  corpus, including Core identity, BCP-47, ISO3, slug, localized names, and
  diagnostic labels.
- R2. The page must support full diagnostic filtering across operational state,
  geo/content usage, and sync/provenance state.
- R3. Language rows must be intentionally clickable and keyboard reachable only
  because they open a real detail modal.
- R4. The language detail modal must be read-only and must show complete
  scalar/reference language details plus bounded previews/counts for
  high-cardinality relations currently available from admin data.
- R5. The feature must preserve Core ownership: no language edits, no Core
  writes, and no schema or generated GraphQL changes.
- R6. Empty, unknown, or missing values must be represented clearly so
  operators can distinguish missing data from hidden UI.
- R7. The page must keep the Forge Editorial dashboard visual language and
  remain usable across desktop and mobile-width layouts.

---

## Scope Boundaries

- No editing, bulk actions, import/export, saved filter presets, or Core write
  workflows.
- No Prisma schema, Pothos schema, SDL, or generated client changes.
- No public consumer app changes.
- No replacement of the shared `DataTable` behavior beyond this page's need for
  a real interactive row surface.

### Deferred to Follow-Up Work

- Server-side search or pagination for much larger language corpora: defer
  unless the U1 measurement gate shows this route cannot comfortably hydrate
  the active corpus.
- Deep content drill-through to individual videos, subtitles, dubs, countries,
  or sync run detail pages: defer to separate navigable workflows when those
  destinations exist. This PR answers "where used" through counts and bounded
  read-only previews only.
- Saved diagnostic views and exportable reports: defer until operators prove
  repeated diagnostic workflows.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/languages/page.tsx` currently renders summary
  cards, a small `DataTable`, locale signals, and operator notes.
- `apps/admin/src/app/dashboard/ops-data.ts` owns `loadLanguagesData`, which
  currently counts languages/countries/locales and fetches eight recent language
  rows.
- `apps/admin/prisma/schema.prisma` already exposes the relevant read model:
  `Language`, `LanguageLocale`, `CountryLanguage`, `VideoDub`,
  `VideoSubtitle`, and `VideoStudyQuestion`.
- `apps/admin/src/components/admin-ui.tsx` keeps shared `DataTable` static by
  default after the admin affordance polish work.
- `apps/admin/src/app/dashboard/videos/page.tsx` shows the route-level search
  control grammar and summary cards for an admin data browser.
- `apps/admin/src/app/dashboard/media/media-localization-modal.tsx` shows the
  dashboard modal structure, left-side filters, and read/detail panel treatment
  to mirror at a smaller read-only scale.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` is the existing route
  render coverage surface for dashboard pages.
- `apps/admin/src/services/manager-read-model.service.ts` is prior art for
  deriving language geo facts and language-scoped coverage from admin rows; this
  plan should reuse its mental model without coupling manager contracts to the
  admin diagnostics page.

### Institutional Learnings

- `docs/plans/2026-06-01-001-fix-admin-interaction-affordances-plan.md`
  established that static operational rows must not imply clickability unless a
  real action exists. This feature is the intentional exception for language
  rows because they open a detail modal.
- `docs/plans/admin-core-sync-coverage-inventory.md` documents the language and
  country-language model as Core-owned reference data with localized names and
  relation metadata already represented in admin.
- `docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md`
  is useful browser-test context for modal state verification, even though this
  route can use the admin app's existing hand-rolled modal pattern.

### External References

- None. Local Next, React, Prisma, and admin dashboard patterns are sufficient.

---

## Key Technical Decisions

- Keep reads server-owned and interactions client-owned: the server route loads
  a complete diagnostic dataset, while a client explorer handles instant local
  filtering and modal state.
- Add a page-specific language explorer instead of broadening the shared
  `DataTable`: this keeps the recent static-table rule intact and avoids
  teaching every admin table about modal-driven row interactions.
- Use derived diagnostic buckets over raw field-only filters: operators should
  filter by meaningful states such as linked/reference-only/missing metadata
  while the modal still exposes raw detail.
- Keep the modal read-only and bounded-complete: scalar identity/provenance
  fields and localized names should be complete for active rows, while
  high-cardinality relations use counts plus bounded previews and overflow
  indicators.
- Treat soft-deleted languages as out of this active-corpus route. Sync
  diagnostics should use active-row provenance fields and the language sync
  watermark for context, not promise a historical deleted-row browser.

### Diagnostic State Definitions

| Group           | Filter                 | Predicate                                                                                                         | Combination                 |
| --------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Operational     | All active             | Active language rows where `deletedAt` is null.                                                                   | Default for the group.      |
| Operational     | Linked                 | One or more content relation counts is greater than zero.                                                         | Single-select within group. |
| Operational     | Reference only         | All content relation counts are zero.                                                                             | Single-select within group. |
| Operational     | Missing metadata       | Any primary identity/display field needed for diagnosis is absent: BCP-47, ISO3, slug, or localized display name. | Single-select within group. |
| Geo/content     | All usage              | No additional geo/content narrowing.                                                                              | Default for the group.      |
| Geo/content     | Country linked         | Country-language count is greater than zero.                                                                      | Single-select within group. |
| Geo/content     | No country links       | Country-language count is zero.                                                                                   | Single-select within group. |
| Geo/content     | Has dubs               | Dub count is greater than zero.                                                                                   | Single-select within group. |
| Geo/content     | Has subtitles          | Subtitle count is greater than zero.                                                                              | Single-select within group. |
| Geo/content     | Has study questions    | Study-question count is greater than zero.                                                                        | Single-select within group. |
| Geo/content     | Primary video language | Primary-video count is greater than zero.                                                                         | Single-select within group. |
| Geo/content     | Audio preview          | Any audio preview metadata exists.                                                                                | Single-select within group. |
| Sync/provenance | All provenance         | No additional sync/provenance narrowing.                                                                          | Default for the group.      |
| Sync/provenance | Core synced            | Source is Core and `syncedAt` exists.                                                                             | Single-select within group. |
| Sync/provenance | Sync missing           | `syncedAt` is absent on an active row.                                                                            | Single-select within group. |
| Sync/provenance | Updated after sync     | `updatedAt` is later than `syncedAt`, signalling possible post-sync drift to inspect.                             | Single-select within group. |
| Sync/provenance | Non-Core source        | Source is not Core. This should usually be empty but helps catch ownership drift.                                 | Single-select within group. |

Search text is ANDed with the selected operational, geo/content, and
sync/provenance filters. Each group is single-select to keep combinations
predictable; clearing a group returns it to its `All` state. Filter controls
should show counts where cheaply available, preserve keyboard semantics, and
share one clear zero-result state.

---

## Open Questions

### Resolved During Planning

- Should the first pass be a basic search/filter or a full diagnostic surface?
  The user selected full diagnostics.
- Should this change add schema fields or Core refetches? No; the request can
  be satisfied from fields and relations already modeled in admin.
- Should shared table primitives become interactive again? No; this page should
  use a page-specific interactive row surface so other tables remain static by
  default.

### Deferred to Implementation

- Exact microcopy can be adjusted during implementation, but filter predicates
  and grouping should stay aligned with the Diagnostic State Definitions table.
- Exact modal section ordering can be tuned during implementation, but the
  information architecture should stay bounded to identity, localized names,
  geo/content summary, audio/media, and provenance.

---

## Implementation Units

### U1. Enrich Language Diagnostics Data

**Goal:** Replace the small recent-row loader with a complete active language
diagnostic dataset, bounded relation previews, derived summary counts, and a
measurement gate for hydration cost.

**Requirements:** R1, R2, R4, R5, R6

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/app/dashboard/ops-data.ts`
- Test: `apps/admin/src/app/dashboard/ops-data.test.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Extend the language page data shape to include active language rows with a
  concrete data contract: scalar identity/provenance fields, all non-deleted
  `LanguageLocale` rows, bounded country-language samples, grouped relation
  counts for content usage, no unbounded nested video/dub/subtitle/question
  arrays, and server-formatted Date/BigInt values.
- Preserve current summary metrics while adding diagnostic counts needed for
  the filter chips and modal.
- Keep data loading bounded to active/non-deleted language rows. Surface
  soft-deleted language count only as an aggregate if useful; do not include
  soft-deleted rows in the explorer.
- Read the language sync watermark when available so sync/provenance filters can
  distinguish synced, missing sync metadata, and updated-after-sync states.
- Convert values that do not serialize cleanly across the server/client boundary
  into display-safe strings before passing to the page component.
- Add a development measurement gate before finalizing the client-side approach:
  record active row count, relation fanout, query duration, serialized payload
  size, and client filter latency against fixture/local data. If payload size is
  above roughly 2 MB, server load exceeds roughly 1 second, or client filtering
  exceeds roughly 150 ms on the local corpus, switch this PR to server-side
  search/pagination before continuing U2.

**Patterns to follow:**

- Existing fallback style around `loadLanguagesData`.
- Video library display formatting in `apps/admin/src/app/dashboard/live-data.ts`
  and `apps/admin/src/app/dashboard/video-library-utils.ts`.
- Core reference model decisions in `docs/plans/admin-core-sync-coverage-inventory.md`.
- Language geo and coverage derivation in
  `apps/admin/src/services/manager-read-model.service.ts`, treated as prior art
  rather than a contract to import into the dashboard.

**Test scenarios:**

- Happy path: loader/mapper returns complete scalar fields, all non-deleted
  localized names, content counts, bounded country samples, and serialized
  Date/BigInt values for seeded language rows.
- Happy path: mocked language data with localized names, country-language
  metadata, dubs, subtitles, and sync timestamps renders through the dashboard
  page without losing fields.
- Edge case: languages with missing BCP-47, ISO3, slug, localized names, audio
  preview, or linked content still produce explicit unknown/none display data.
- Edge case: active rows with missing `syncedAt` and rows updated after sync map
  to the expected sync/provenance diagnostics without including soft-deleted
  rows in the explorer.
- Integration: the loader preserves existing metrics and adds enough row data
  for the explorer without requiring GraphQL or schema changes.

**Verification:**

- The languages page has complete active-corpus row data available to the UI
  and still renders when relation arrays are empty.

### U2. Build The Language Explorer Client Surface

**Goal:** Add the searchable, filterable, clickable language table surface that
opens a read-only detail modal.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** U1

**Files:**

- Create: `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
- Modify: `apps/admin/src/app/dashboard/languages/page.tsx`
- Test: `apps/admin/src/app/dashboard/languages/language-diagnostics.test.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Introduce a page-local client component for search input, diagnostic filter
  controls, filtered result count, row activation, and modal state.
- Search across identity fields, localized names, and diagnostic labels using a
  normalized client-side index derived from the server data.
- Provide three single-select filter groups: operational, geo/content, and
  sync/provenance. Search text ANDs with the selected value in each group.
- Export pure search/filter helpers so Node Vitest can verify predicate
  behavior without adding DOM test infrastructure.
- Render rows as real buttons or equivalent keyboard-activatable controls with
  explicit hover/focus affordances and no fake action icons.
- Use the media localization modal as visual layout inspiration only. Follow
  `ConfirmModal` and admin-shell dialog mechanics for `role="dialog"`,
  `aria-modal`, labelled title, Escape close, backdrop close, initial focus,
  focus containment, and focus return to the activated row.
- Structure modal content into identity, localized names, geo/content summary,
  audio/media, and provenance sections. High-cardinality relations should show
  count, bounded preview, overflow indicator, and explicit None/Unknown states,
  with no drill-through links in this PR.
- Keep responsive layout stable: compact row summaries on smaller screens and
  denser columns on wide screens.
- At mobile widths, filters wrap or stack above the list, rows become summary
  cards/list items, modal content uses viewport-constrained height with internal
  scrolling, and long language names wrap or truncate without horizontal page
  overflow.

**Patterns to follow:**

- Search control grammar in `apps/admin/src/app/dashboard/videos/page.tsx`.
- Visual modal layout in
  `apps/admin/src/app/dashboard/media/media-localization-modal.tsx`.
- Dialog mechanics in `apps/admin/src/components/confirm-modal.tsx` and
  `apps/admin/src/components/admin-shell.tsx`.
- Enabled focus/hover affordance rules from
  `docs/plans/2026-06-01-001-fix-admin-interaction-affordances-plan.md`.

**Test scenarios:**

- Happy path: initial render includes search, diagnostic filter controls,
  language rows, and result count.
- Happy path: pure filter helper tests cover each Operational, Geo/content, and
  Sync/provenance predicate and verify selected groups combine with AND
  semantics.
- Happy path: each rendered language row exposes a real button/control rather
  than a static table row.
- Edge case: zero matching results renders a clear empty state.
- Accessibility: modal markup includes dialog semantics, a labelled title, a
  close control, focus handling hooks, and read-only content sections.
- Edge case: relation counts above the preview limit render an overflow
  indicator rather than unbounded lists.
- Regression: static shared `DataTable` tests continue to prove default tables
  do not regain row action affordances.

**Verification:**

- Operators can search/filter locally, activate a language row, inspect details,
  and close the modal without any write affordance.

### U3. Add Diagnostic Copy And Page Integration

**Goal:** Integrate the explorer into the route with clear operator language and
updated notes that match the new diagnostic scope.

**Requirements:** R2, R4, R6, R7

**Dependencies:** U1, U2

**Files:**

- Modify: `apps/admin/src/app/dashboard/languages/page.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Replace the current "Reference Languages" table section with the diagnostic
  explorer while preserving summary cards and locale signals.
- Keep operator notes concise and focused on read-only reference diagnostics,
  not editing or workflow claims.
- Add labels and empty-state copy through the existing admin message structure
  when text is shared or likely to be localized.
- Keep one PR-sized page change: do not rework unrelated admin sections.

**Patterns to follow:**

- Existing language page message keys in `apps/admin/src/i18n/messages.ts`.
- Operator rail voice on neighboring dashboard pages.

**Test scenarios:**

- Happy path: the languages route renders the new diagnostic section title,
  search placeholder, filter controls, and existing summary cards.
- Edge case: route render with empty language rows still shows summary context
  and an empty explorer state.
- Regression: existing page-title smoke coverage for all dashboard pages still
  passes.

**Verification:**

- The route reads as a diagnostic browser rather than a static reference table.

### U4. Validate Diagnostics Behavior And Browser Proof

**Goal:** Add targeted automated coverage and complete the user-facing smoke
proof required for the admin UI change.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** U1, U2, U3

**Files:**

- Modify: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- Create: `apps/admin/src/app/dashboard/languages/language-diagnostics.test.tsx`
- Modify: `apps/admin/src/app/dashboard/ops-data.test.ts`

**Approach:**

- Split automated verification by what the current test environment can
  honestly prove: loader/mapper tests for server data shape, pure helper tests
  for search/filter predicates, and `dashboard-ui.test.tsx` for route/static
  markup smoke.
- Verify the important static guarantees in tests: controls render, row controls
  are real, bounded modal content can be represented, and missing data has
  explicit labels.
- Use Helium for interaction proof because modal opening, filter changes, and
  keyboard behavior are user-facing browser behaviors.

**Patterns to follow:**

- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- `apps/admin/src/components/admin-shell.test.tsx`

**Test scenarios:**

- Happy path: search/filter controls and rows render for seeded language data.
- Happy path: detail content includes identity, localized name, geo/content,
  audio preview, and sync/provenance sections.
- Edge case: no result state appears when filters/search exclude all rows.
- Browser: search narrows the result list, a diagnostic filter changes the
  result count, row click opens the modal, Escape or close dismisses it, and no
  edit controls appear.
- Browser: keyboard-only interaction opens the modal, tabs within modal
  controls, closes via Escape, and returns focus to the activated row.
- Browser: mobile-width smoke verifies search/filter controls, row activation,
  modal close controls, and no horizontal overflow.

**Verification:**

- Targeted admin tests pass, typecheck passes, and Helium smoke confirms the
  interactive browser story.

---

## System-Wide Impact

- **Interaction graph:** `/dashboard/languages` server page -> `loadLanguagesData`
  -> page-local client explorer -> read-only modal. No public app or GraphQL
  consumer surface changes.
- **Error propagation:** Existing table fallback behavior should continue to
  keep the dashboard renderable if optional diagnostic relations are absent.
- **State lifecycle risks:** Modal and filters are client state only; they must
  not imply persistence, mutation, or saved views.
- **API surface parity:** No Pothos, SDL, or `packages/admin-graphql` changes.
- **Integration coverage:** Browser proof must cover actual search/filter/modal
  interaction because static render tests cannot prove client state changes.
- **Unchanged invariants:** Core-sourced entities remain read-only at the
  GraphQL/service layer; shared static table defaults stay non-interactive.

---

## Risks & Dependencies

| Risk                                                                     | Mitigation                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full-corpus hydration becomes too heavy if diagnostic relations fan out. | Run the U1 measurement gate; select only scalar fields, counts, and bounded previews; switch to server search/pagination if the thresholds fail. |
| Clickable rows regress the recent affordance cleanup.                    | Keep interactivity page-local and tied directly to the real modal. Preserve shared `DataTable` static defaults.                                  |
| Modal becomes a data dump that is hard to scan.                          | Group details into identity, localized names, geo/content, media/audio, and provenance sections with explicit empty states.                      |
| Tests overclaim interaction coverage.                                    | Use static tests for render guarantees and Helium for actual search/filter/modal behavior.                                                       |

---

## Documentation / Operational Notes

- `docs/roadmap/platform/feat-155-admin-language-diagnostics.md` tracks the
  feature while implementation is in progress.
- Mark the roadmap ticket complete after implementation and validation.
- No operator runbook is required unless browser proof surfaces a recurring
  diagnostic workflow worth documenting.

---

## Sources & References

- Related roadmap: `docs/roadmap/platform/feat-155-admin-language-diagnostics.md`
- Related code: `apps/admin/src/app/dashboard/languages/page.tsx`
- Related code: `apps/admin/src/app/dashboard/ops-data.ts`
- Related code: `apps/admin/src/components/admin-ui.tsx`
- Related code: `apps/admin/prisma/schema.prisma`
- Related plan: `docs/plans/2026-06-01-001-fix-admin-interaction-affordances-plan.md`
- Related inventory: `docs/plans/admin-core-sync-coverage-inventory.md`
