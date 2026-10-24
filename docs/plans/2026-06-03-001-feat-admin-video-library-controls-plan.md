---
title: "feat: Add admin video library controls"
type: feat
status: completed
date: 2026-06-03
roadmap: docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md
---

# feat: Add admin video library controls

## Summary

Make `/dashboard/videos` controls operational without expanding the read-heavy
video workflow boundary: submitted searches show visible pending feedback,
category filtering moves from visual tabs to a working dropdown, sorting becomes
URL-backed, and a dubbed-language filter narrows the catalog server-side.

## Problem Frame

The current video library now has real search and pagination, but the screenshot
toolbar still contains silent or placeholder controls. Operators can submit a
search without any pending signal, cannot use the visible category selector, and
cannot sort or filter by language even though those are natural catalog-browsing
actions on a large video library.

## Assumptions

_This plan was authored without synchronous user confirmation. The items below
are agent inferences that fill gaps in the input -- un-validated bets that
should be reviewed before implementation proceeds._

- "Language filter" means available dubbed/audio language, not primary video
  language.
- Search, category, language, sort, and pagination should be URL-backed so
  refresh, sharing, and browser navigation preserve the selected catalog view.
- The current visible category set is sufficient for this slice: All,
  Collections, Features, Short films, and Series.
- Pending feedback should cover search/filter/sort submissions because they all
  trigger the same server-rendered catalog transition.

## Requirements

- R1. `/dashboard/videos` shows a visible loading/thinking indicator after a
  search or filter/sort form submission starts and before the next route state
  resolves.
- R2. The video category control is a dropdown, not the current tab/radio-like
  surface.
- R3. Category filtering works for All, Collections, Features, Short films, and
  Series while preserving the existing read-only video boundary.
- R4. Sorting works and is URL-backed, with a clear default sort matching the
  current recently-updated ordering.
- R5. Add a language filter that narrows rows by dubbed/audio language.
- R6. Search, filters, sort, and pagination preserve one another in generated
  links and form submissions; changing a control without an explicit page starts
  from page 1.
- R7. Empty states distinguish a truly empty catalog from a filtered catalog
  with no matches.
- R8. Do not introduce video creation, editing, row actions, schema changes, or
  generated GraphQL output changes in this slice.

## Scope Boundaries

- Keep Core-sourced video records read-only.
- Do not implement manual video creation, video row action menus, or a video
  editor route.
- Do not change Admin Pothos schema, `apps/admin/schema.graphql`, or
  `packages/admin-graphql` outputs unless implementation discovers an
  unavoidable contract need.
- Do not replace the existing screenshot-style row layout.
- Do not add advanced query syntax, multi-select filters, saved views, or bulk
  actions.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/videos/page.tsx` is the server-rendered page
  that parses URL search params and renders the screenshot-style toolbar and
  rows.
- `apps/admin/src/app/dashboard/live-data.ts` owns dashboard row loading and
  already enriches videos with locales, dubs/languages, images, and visitor
  URLs.
- `apps/admin/src/app/dashboard/video-library-utils.ts` owns search and
  pagination URL helpers and should grow typed parser/href support for the new
  controls.
- `apps/admin/src/services/video.service.ts` owns read-only list/count behavior
  and already builds a broad Prisma search filter over video, locale, dub,
  language, and image metadata.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`,
  `apps/admin/src/app/dashboard/video-library-utils.test.ts`, and
  `apps/admin/src/services/video.service.test.ts` already cover the current
  page, URL helpers, and service search behavior.
- `docs/plans/2026-06-02-001-feat-admin-video-library-search-plan.md` added the
  current server-side search path and explicitly deferred advanced filters and
  sort controls.
- `docs/plans/2026-06-02-003-feat-admin-video-library-screenshot-match-plan.md`
  made the current category tabs and sort control visual placeholders; this plan
  turns those specific placeholders into working controls.

### Institutional Learnings

- `apps/admin/docs/v1-operational-surfaces.md` and
  `apps/admin/docs/cms-operational-vs-deferred.md` classify `/dashboard/videos`
  as operational but read-heavy, so this work should improve browsing without
  crossing into editing.
- `docs/roadmap/platform/feat-153-admin-interaction-affordance-polish.md`
  completed disabled-state polish and explicitly deferred video filters; this
  work is the follow-up that makes the filter/sort controls real.

### External References

- External research skipped. The repo already has current local patterns for
  Next.js App Router URL-backed GET forms, server-rendered dashboard data, and
  Prisma service filters.

## Key Technical Decisions

- Extend the existing server-rendered route and GET form model instead of adding
  a client-side catalog store; the database-backed count and page links remain
  truthful.
- Add a small client toolbar component only for pending UI state and control
  submission ergonomics; it should not own catalog data.
- Keep list and count filters in one service-level where-builder path so totals
  and rows cannot drift.
- Treat category and sort as constrained enum-like URL params with safe parser
  defaults, rather than trusting arbitrary query-string values.
- Populate language dropdown options from the current filtered/sorted data
  access layer in a bounded way that avoids loading every row's full dub list
  into the page payload.

## Open Questions

### Resolved During Planning

- Should category control remain as tabs? No. The user explicitly requested a
  dropdown rather than the current radio/tab-like surface.
- Should this PR add video editing or row actions? No. Existing docs classify
  videos as read-heavy and this request only targets browsing controls.

### Deferred to Implementation

- Exact sort option labels: choose copy that fits the existing message
  dictionary and page visual density.
- Exact language option cap and ordering: implement the smallest useful bounded
  selector from available dub languages, then adjust if tests or local data show
  an obvious ordering problem.
- Exact pending indicator placement: implement where it is visible during
  toolbar submissions without disturbing the screenshot-style layout.

## Implementation Units

### U1. URL Param and Href Helpers

**Goal:** Add typed, normalized URL state for category, language, and sort while
preserving existing search/page behavior.

**Requirements:** R2, R3, R4, R5, R6

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/app/dashboard/video-library-utils.ts`
- Test: `apps/admin/src/app/dashboard/video-library-utils.test.ts`

**Approach:**

- Introduce constrained value sets for category and sort params, with parser
  helpers that default to "all" category and recently-updated sort.
- Normalize language as a single string param that trims whitespace and omits
  blank values from generated URLs.
- Extend the video-library href helper to preserve query, category, language,
  and sort while omitting default values.

**Patterns to follow:**

- Existing `parseVideoLibraryQuery`, `parseVideoLibraryPage`, and
  `videoLibraryHref` behavior in `apps/admin/src/app/dashboard/video-library-utils.ts`.

**Test scenarios:**

- Happy path: non-default query/category/language/sort produce a stable
  `/dashboard/videos?...` URL.
- Happy path: default category and default sort are omitted from URLs.
- Edge case: invalid category and sort params normalize to safe defaults.
- Edge case: blank or array language params normalize without producing
  misleading links.
- Regression: page parsing and query length clamping keep their current
  behavior.

**Verification:**

- Utility tests prove every supported URL state is parsed and serialized
  predictably.

### U2. Service Filtering and Sorting

**Goal:** Make the read-only video service apply category, dubbed-language, and
sort options consistently to list and count queries.

**Requirements:** R3, R4, R5, R7, R8

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/services/video.service.ts`
- Test: `apps/admin/src/services/video.service.test.ts`

**Approach:**

- Extend `VideoService.list` and `VideoService.countActive` input to accept
  normalized category and language filters plus a constrained sort value.
- Keep `deletedAt: null` as the base invariant and combine search/category/
  language filters with AND semantics.
- Map the visible category dropdown to the existing `VideoLabel` values.
- Apply language filtering through the dub language relation so the selector
  matches playable/dubbed-language availability.
- Preserve current recently-updated ordering as the default sort and add
  predictable alternatives that Prisma can express without raw SQL.

**Patterns to follow:**

- Existing `videoSearchWhere` and enum token normalization in
  `apps/admin/src/services/video.service.ts`.

**Test scenarios:**

- Happy path: category `features` filters to feature-film labels and count uses
  the same constraint.
- Happy path: category `all` does not add a label constraint.
- Happy path: language filter searches dubs through language slug, BCP-47, ISO3,
  or id where appropriate.
- Happy path: selected sort maps to the expected Prisma `orderBy`.
- Integration: search + category + language combine in one `where` object rather
  than replacing each other.
- Regression: list without new options preserves non-deleted, updated-desc
  behavior and the existing 200-row limit clamp.

**Verification:**

- Service tests show row and count calls receive equivalent filters and safe
  order clauses.

### U3. Dashboard Loader Options and Language Choices

**Goal:** Thread normalized control state through the dashboard loader and expose
bounded language options for the page dropdown.

**Requirements:** R3, R4, R5, R6, R7

**Dependencies:** U1, U2

**Files:**

- Modify: `apps/admin/src/app/dashboard/live-data.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Extend `loadVideoLibraryPage` to accept category, language, and sort values
  and pass them to both count and row queries.
- Add a loader for language filter options based on available non-deleted dub
  languages, returning a compact display label and stable value.
- Keep visitor URL and row enrichment behavior unchanged.

**Patterns to follow:**

- Existing loader composition in `apps/admin/src/app/dashboard/live-data.ts`
  and current SSR page tests that mock `loadVideoLibraryPage`.

**Test scenarios:**

- Happy path: page invocation passes normalized category/language/sort to
  `loadVideoLibraryPage`.
- Happy path: language options render in the filter dropdown while preserving
  the active selected value.
- Edge case: empty language options still render an "all languages" state.
- Regression: pagination summaries and empty search behavior still render.

**Verification:**

- Dashboard tests prove the page consumes and preserves the new loader state
  without changing row rendering.

### U4. Toolbar Dropdowns and Pending Indicator

**Goal:** Replace placeholder controls with a compact working toolbar and visible
submission feedback.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** U1, U3

**Files:**

- Create: `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx`
- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Move the toolbar form into a small client component that uses the existing
  GET route and `useFormStatus` or equivalent transition state to show pending
  feedback after submissions.
- Render category, language, and sort as dropdown controls with hidden/default
  URL state preserved alongside the search input.
- Preserve the clear-search action and query-aware pagination links.
- Keep toolbar controls visually aligned with the screenshot-style admin page
  and avoid nested cards or a landing-style composition.

**Patterns to follow:**

- Existing screenshot-style toolbar and button classes in
  `apps/admin/src/app/dashboard/videos/page.tsx`.
- Existing message dictionary structure in `apps/admin/src/i18n/messages.ts`.

**Test scenarios:**

- Happy path: toolbar renders search, category dropdown, language dropdown, and
  sort dropdown with selected values from URL state.
- Happy path: form includes the selected URL state needed for submissions.
- Happy path: submitted/pending state has accessible loading text or status
  markup.
- Regression: manual video and row action controls remain disabled/unavailable.
- Regression: clear search retains filter/sort state where appropriate or
  returns to the default video library view consistently.

**Verification:**

- SSR tests prove the working controls render and carry URL state; browser smoke
  confirms the pending indicator appears during a local submission when auth
  permits.

## System-Wide Impact

- **Interaction graph:** `/dashboard/videos` remains SSR-first. The toolbar
  submits URL state, the server route parses state, the dashboard loader calls
  the service, and pagination links preserve the same state.
- **Error propagation:** Invalid URL params normalize to safe defaults instead
  of surfacing user-facing errors.
- **State lifecycle risks:** Page changes must reset naturally to page 1 when a
  control submits without an explicit `page`; pagination links are the only
  place that should carry page numbers forward.
- **API surface parity:** No GraphQL SDL or public API surface changes are
  expected.
- **Integration coverage:** SSR page tests cover rendered URL/control state;
  service unit tests cover Prisma filter/sort shape.
- **Unchanged invariants:** Videos stay read-only and Core-sourced authority
  rules remain intact.

## Risks & Dependencies

| Risk                                                                               | Mitigation                                                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Language filtering could be ambiguous between primary language and dubbed language | Record the assumption in this plan and implement against dubbed/audio language, matching the row coverage UI.        |
| Language option loading could become too heavy for the full catalog                | Return bounded selector data from language/dub relations instead of attaching all dub rows to every page row.        |
| List and count filters could drift                                                 | Use the same service where-builder path for both list and count.                                                     |
| Pending indicator can be hard to observe on fast local responses                   | Render accessible pending status in the client toolbar and browser-smoke with a real local transition when possible. |

## Documentation / Operational Notes

- If the controls land cleanly, update operator-facing admin docs only if the
  current "read-heavy video library" description becomes materially outdated.
- Per user instruction, request help for local login/session blockers during
  browser testing rather than spending time working around auth setup.

## Sources & References

- Roadmap umbrella:
  `docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md`
- Prior search plan:
  `docs/plans/2026-06-02-001-feat-admin-video-library-search-plan.md`
- Prior screenshot-match plan:
  `docs/plans/2026-06-02-003-feat-admin-video-library-screenshot-match-plan.md`
- Operational docs: `apps/admin/docs/v1-operational-surfaces.md`
- Deferred boundary docs: `apps/admin/docs/cms-operational-vs-deferred.md`
- Related code: `apps/admin/src/app/dashboard/videos/page.tsx`
- Related code: `apps/admin/src/app/dashboard/live-data.ts`
- Related code: `apps/admin/src/app/dashboard/video-library-utils.ts`
- Related code: `apps/admin/src/services/video.service.ts`
