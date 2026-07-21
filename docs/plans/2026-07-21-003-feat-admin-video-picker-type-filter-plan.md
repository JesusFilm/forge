---
title: "feat: Add video type filter to the Admin Experience picker"
type: "feat"
status: "active"
date: "2026-07-21"
---

# feat: Add video type filter to the Admin Experience picker

## Summary

Add the canonical Admin video-type filter to the Experience editor's video
picker so editors can narrow modal results to collections, features, short
films, or series while continuing to combine the filter with text search.

## Problem Frame

The Experience editor picker supports server-ranked text search, but its modal
has no way to narrow a broad result set by video type. This is especially
costly when building a media collection, where an editor may intentionally want
a parent collection rather than an individual playable video. The main Admin
Video Library already defines the relevant categories and their database
semantics, so the picker should reuse that contract rather than introduce a
second type taxonomy.

## Requirements

- R1. The video picker exposes an accessible type control with All types,
  Collections, Features, Short films, and Series options.
- R2. Type selection combines with the existing text query, picker-mode
  eligibility rules, and already-added-item exclusion.
- R3. A type-only selection loads matching rows from the server instead of
  filtering only the initial 30-row picker preload.
- R4. Opening a new picker session resets the type to All types, and pending,
  error, and empty states describe the active combined filters accurately.
- R5. Existing Watch search behavior, Admin GraphQL contracts, picker search
  trace clients, collection expansion, dub selection, and video application
  remain unchanged.

## Assumptions

- "Video type/collection filter" means the established Video Library category
  control, where Collections is one type option, not a second parent-collection
  selector.
- The existing category definitions are authoritative: Collections maps to
  `COLLECTION`, Features to `FEATURE_FILM`, Short films to `SHORT_FILM`, and
  Series to `SERIES`.
- The existing first-page limit remains appropriate for one filtered picker
  response; pagination and infinite scrolling are outside this change.

## Key Technical Decisions

- **Reuse the Video Library category contract:** Import the shared category
  type and matching semantics so the modal cannot drift from
  `/dashboard/videos`.
- **Make filter-only retrieval server-backed:** Extend the existing picker
  server action context with the selected category. A non-empty query continues
  through ranked Watch search and then applies the category to hydrated rows;
  an empty query with a selected category extends the existing picker row
  loader with the same category constraint.
- **Keep picker eligibility as the final gate:** Video Hero collection
  exclusion and duplicate-item exclusion remain local mode-specific rules after
  query/type results are resolved.
- **Reset state per modal session:** Clear both query and type when the picker
  opens so filters do not leak between blocks or picker modes.

## Scope Boundaries

### In Scope

- Type control and combined-filter state in all Experience editor video-picker
  modes.
- Server action support for category-only and query-plus-category retrieval.
- Focused interaction and regression tests.
- A roadmap ticket for this implementation, moved from in-progress to complete
  with the shipped change.

### Out of Scope

- A searchable parent-collection selector.
- Pagination or infinite scrolling inside the picker.
- New video labels, GraphQL fields, public Watch search filters, or changes to
  the main Video Library screen.
- General extraction of the large Experience editor modal into new component
  architecture.

## Implementation Units

### U1. Add the picker type-filter interaction

**Goal:** Let editors select a canonical video type and see that type combined
with the current query and picker-mode constraints.

**Requirements:** R1, R2, R4, R5.

**Dependencies:** None.

**Files:**

- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`
- `apps/admin/src/app/dashboard/video-library-utils.ts`
- `apps/admin/src/app/dashboard/video-library-utils.test.ts`

**Approach:** Add category state beside the existing query state, render a
styled native select below the search field, and use shared category matching
for both local fallback rows and server-returned result keys. Treat a non-All
category as an active filter for loading and empty-state behavior. Reset the
category when opening a picker. Preserve the existing final selection gates for
Video Hero blocks and already-present collection/carousel items.

**Patterns to follow:** `VideoLibraryToolbar` for category labels and select
styling; `parseVideoLibraryCategory` and the category-to-label mapping used by
`VideoService`; the existing debounced picker search and pending-state tests.

**Test scenarios:**

1. Opening a picker exposes all canonical type options with an accessible
   "Filter by video type" label and defaults to All types.
2. Selecting Collections with no query requests category-filtered server rows
   and shows collection results while hiding other labels.
3. Selecting Short films and entering a query passes both values to the search
   action and renders only the server-ranked short-film matches.
4. A Video Hero picker still excludes collection targets even when the
   Collections filter is selected.
5. A media-collection or carousel picker still excludes videos already in the
   target block after type filtering.
6. Closing and reopening the picker restores All types and an empty query.
7. No matching combined filters show the existing filter-aware empty state;
   pending and failed requests do not flash a false empty result.

**Verification:** The focused Experience editor and shared video-library utility
tests prove type state, action context, result intersection, picker-mode gates,
and reset behavior.

### U2. Resolve type filters through the existing server action

**Goal:** Return full-library type results without changing public search or
GraphQL contracts.

**Requirements:** R2, R3, R5.

**Dependencies:** U1.

**Files:**

- `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
- `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx`
- `apps/admin/src/app/dashboard/live-data.ts`
- `apps/admin/src/app/dashboard/live-data.test.ts`

**Approach:** Extend the existing action context and `loadVideoRows` options
with the shared category type. For category-only requests, use that picker row
loader with the active Experience locale and category constraint, avoiding the
language-option and collection-summary queries used by the full Video Library
page. For text queries, preserve ranked Watch search, hydrate the result IDs,
then apply the same shared category matcher while retaining search order. Merge
returned rows through the existing wrapper so selection and preview hydration
continue to work. Do not record a search trace for a blank-query category load;
query searches retain their existing client-specific trace identity.

**Patterns to follow:** `loadVideoRowSlice` and `videoListWhere` category
semantics; the current `searchVideoLibraryAction` ranked-ID hydration; the
wrapper's additive `mergeVideoLibraryItems` behavior.

**Test scenarios:**

1. A category-only request uses the Video Library page loader with page one,
   the selected category, and the active Experience locale.
2. A query-plus-category request preserves Watch search ordering while dropping
   hydrated rows whose labels do not match the selected category.
3. The All category leaves ranked query results unchanged.
4. Blank-query category loads do not create Watch search traces.
5. Existing locale-aware dub hydration and collection-preview metadata remain
   present on returned rows.

**Verification:** Focused loader/action tests demonstrate server-backed type
retrieval and unchanged ranked-search ordering, followed by Admin typecheck.

### U3. Track and prove the shipped editor change

**Goal:** Keep the roadmap and browser-facing evidence aligned with the
implementation.

**Requirements:** R1, R4, R5.

**Dependencies:** U1, U2.

**Files:**

- `docs/roadmap/platform/feat-280-admin-editor-video-picker-type-filter.md`
- `docs/roadmap/README.md`

**Approach:** Create the next platform roadmap ticket before code changes,
mark it in-progress during implementation, and complete it after validation.
Refresh the roadmap index through the repository generator. Browser-smoke the
Experience media-collection picker at desktop width, confirm the control and
combined result behavior, and capture a screenshot without mutating production
content.

**Patterns to follow:** `feat-274` and `feat-275` for ticket structure and
verification language; the Admin worktree preview guide for isolated local
runtime setup.

**Test scenarios:**

Test expectation: none -- this unit records status and captures runtime proof;
the feature behavior is covered in U1 and U2.

**Verification:** The generated roadmap index includes feat-280, the ticket is
complete, and browser/DOM evidence shows the type control narrowing the modal
without page-load, hydration, or console regressions.

## System-Wide Impact

The initial Experience editor page load remains unchanged. Additional server
work occurs only while the video-picker modal is open and the editor selects a
type or enters a query, using the existing debounce and 30-row response limit.
No schema generation, database migration, public route, or consumer codegen is
involved.

## Risks and Mitigations

- **Category drift between modal and Video Library:** centralize matching in the
  existing shared utility and cover every category mapping.
- **Narrow filters can keep a stale selected row:** continue deriving pending
  selection from visible result keys and clear invalid selections when results
  change.
- **Type-only requests could pollute search telemetry:** bypass Watch search and
  its trace path when the query is blank.
- **Picker mode rules could be weakened by the new control:** apply category
  matching before, not instead of, the existing collection-target and duplicate
  exclusions.

## Acceptance Criteria

- Editors can filter the Experience video picker by All types, Collections,
  Features, Short films, or Series.
- Type and text filters combine, including server-backed type-only retrieval.
- Existing picker eligibility, preview, dub, collection expansion, and apply
  behavior are preserved.
- Focused tests, Admin typecheck, and browser smoke pass.
- A visual proof screenshot shows the filter in the media-collection picker.

## References

- `docs/roadmap/platform/feat-274-admin-editor-video-picker-server-search.md`
- `docs/roadmap/platform/feat-275-admin-editor-video-picker-language-aware-dubs.md`
- `docs/solutions/logic-errors/admin-editor-video-picker-locale-first-dub-trimming-20260721.md`
- `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx`
- `apps/admin/src/app/dashboard/video-library-utils.ts`
- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
- `apps/admin/src/app/dashboard/live-data.ts`
