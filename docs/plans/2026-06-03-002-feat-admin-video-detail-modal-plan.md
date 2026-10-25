---
title: "feat: Add admin video detail modal"
type: feat
status: active
date: 2026-06-03
roadmap: docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md
---

# feat: Add admin video detail modal

## Summary

Add URL-backed video drill-down behavior to `/dashboard/videos`: ordinary video rows open a detail modal, while collection-like rows apply a collection filter to the list. The implementation should preserve the current search/type/language/sort controls, reuse the existing admin dashboard data patterns, and keep the surface read-only.

---

## Problem Frame

The admin video library now supports search, type, language, and sort filters, but a found record still cannot be inspected in place. Operators need a quick way to see the known admin data for a video, and collections need to behave like drill-down filters rather than inert catalog rows.

---

## Assumptions

_This plan was authored without synchronous confirmation after the initial request. The items below are agent inferences that should be reviewed before implementation proceeds._

- Collection-labeled rows, and series rows with child relations, should filter the list by collection on primary click instead of opening the detail modal.
- Query parameters are the preferred URL representation for this feature because the current list filters already live in query state and should remain visible.
- "All information known about this video" means all useful admin-readable metadata and relation summaries in the local admin database. Heavy internal artifacts such as embedding vectors and full transcript chunks should be summarized by counts/provenance rather than rendered raw in the modal.

---

## Requirements

- R1. Clicking an ordinary video row opens a modal with the known admin metadata for that video.
- R2. The selected video is represented in the URL so the modal can be deep-linked, refreshed, and closed through normal browser navigation.
- R3. Clicking a collection-like video row filters the video list to that collection's child videos instead of opening the modal.
- R4. The active collection filter is represented in the URL, composes with existing search/type/language/sort filters, resets pagination when changed, and has a visible clear affordance.
- R5. A selected video and an active collection filter can coexist in the URL so a child video can be inspected while the list remains scoped to its parent collection.
- R6. Missing, deleted, or stale `video` and `collection` URL values degrade gracefully without throwing a page error.
- R7. Existing external visitor links and disabled row-action placeholders keep their current behavior and do not accidentally trigger the modal or collection filter.
- R8. The modal is accessible on desktop and mobile: clear dialog semantics, focus management, Escape/backdrop close, body scroll lock, and usable scrolling for dense detail sections.
- R9. The feature remains read-only; it does not introduce video editing, collection management, reordering, or Core sync changes.

---

## Scope Boundaries

- Do not create a new editor route or mutation flow.
- Do not add schema migrations or change Core sync ingestion.
- Do not change public web, mobile, TV, or manager behavior.
- Do not render raw embedding vectors, full transcript chunks, or large machine artifacts in the modal.
- Do not replace the existing search/type/language/sort toolbar behavior.

### Deferred to Follow-Up Work

- Editable video metadata, locale publishing, and manual video creation remain part of the broader video editorial workflow roadmap.
- Collection child reordering and parent-child relation editing are out of scope for this read-only drill-down slice.
- A dedicated full-screen video editor route can reuse the modal detail loader later if the admin workflow expands beyond inspection.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/videos/page.tsx` renders the current server-side video library list, header, row controls, and pagination.
- `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx` owns URL-backed search/type/language/sort interactions and already pushes query-state changes through `videoLibraryHref`.
- `apps/admin/src/app/dashboard/video-library-utils.ts` centralizes video library query parsing, href construction, pagination, thumbnail normalization, and visitor URL helpers.
- `apps/admin/src/app/dashboard/live-data.ts` loads dashboard video rows, language options, visitor links, thumbnail choices, dub coverage, and list pagination.
- `apps/admin/src/services/video.service.ts` owns the reusable video list/count filters and already has `getBySlug`, `getById`, and `getByCoreId` read helpers.
- `apps/admin/prisma/schema.prisma` defines `VideoRelation` as the parent/child relation for collections and series, plus the related metadata tables the modal can summarize.
- `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx` provides the closest existing dialog pattern: focus trap, Escape close, backdrop close, and body scroll lock.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`, `apps/admin/src/app/dashboard/video-library-utils.test.ts`, and `apps/admin/src/services/video.service.test.ts` already cover the affected UI, URL, and service layers.

### Institutional Learnings

- `docs/plans/2026-06-03-001-feat-admin-video-library-controls-plan.md` intentionally excluded row actions and modal work. This plan supersedes that boundary because the user explicitly requested a detail modal and collection drill-down.
- `docs/plans/2026-06-01-001-fix-admin-interaction-affordances-plan.md` established that admin rows should only look interactive when there is a real implemented action. This feature should make the row click affordance real and keep disabled placeholders disabled.
- `docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md` identifies video inspection and discovery-to-edit handoff as part of the broader admin video/media editorial workflow.

### External References

- None. Local Next.js App Router, Prisma, and modal patterns are sufficient for this bounded admin feature.

---

## Key Technical Decisions

- Use query parameters for state: `video=<video-slug-or-id>` opens the modal and `collection=<collection-slug-or-id>` scopes the list. This preserves the current route and composes naturally with `q`, `type`, `language`, `sort`, and `page`.
- Prefer slugs in generated URLs, with loaders accepting slug/core id/database id for stale-link tolerance. Slugs are operator-readable, while permissive resolution prevents old links from failing unnecessarily.
- Implement collection filtering in the service/query layer through `VideoRelation`, not by filtering the current page in the UI. Counts, pagination, search, type, language, and sort must all reflect the same filtered scope.
- Keep data loading server-owned. The page should parse URL state, load rows and optional modal data on the server, and pass a normalized detail object into a client dialog component only for focus/close behavior.
- Treat collections and series as drill-down targets when they have child relations. This matches the current category taxonomy and avoids making series rows a dead end.
- Bound modal detail sections for high-volume relations. Show complete identity and canonical metadata, show useful relation rows where practical, and summarize very large artifacts by counts and provenance.

---

## Open Questions

### Resolved During Planning

- Path state or query state: Use query state because the page already uses query-backed filters and the modal should preserve the list context.
- Collection click behavior: Treat collection-like primary clicks as a list filter, not as the same modal behavior used by ordinary videos.
- Data owner: Extend the current admin dashboard server data layer and video service rather than moving video-library state into client-side fetching.

### Deferred to Implementation

- Exact visual grouping and ordering of modal sections: finalize after seeing the real returned detail density, while preserving the required content categories.
- Exact row caps for very large relation lists: choose conservative defaults after inspecting fixture/live data volume; counts must remain visible when rows are capped.
- Whether `SERIES` rows with zero children should open a modal or show an empty collection state: decide from actual row metadata during implementation.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

| URL State                               | List Scope                                                           | Primary Row Click                                                                               | Modal State                                                             |
| --------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| No `video`, no `collection`             | Existing search/type/language/sort list                              | Ordinary video adds `video`; collection-like row adds `collection` and resets page              | Closed                                                                  |
| `video=<video>`                         | Existing search/type/language/sort list                              | Ordinary video swaps `video`; collection-like row swaps to `collection`                         | Open for selected video if found                                        |
| `collection=<collection>`               | Child videos for selected parent, further narrowed by active filters | Ordinary child adds `video` while preserving `collection`; nested collection swaps `collection` | Closed unless `video` is also present                                   |
| `collection=<collection>&video=<video>` | Child videos for selected parent, further narrowed by active filters | Ordinary child swaps `video`; clear collection removes only `collection` and `page`             | Open for selected video if found                                        |
| Stale `video` or `collection`           | Valid parts of the URL still apply                                   | Generated links replace stale state with valid state                                            | Missing detail/filter is ignored or shown as a non-crashing empty state |

---

## Implementation Units

### U1. Extend Video Library URL State

**Goal:** Add parsed URL state and href construction for selected videos and active collection filters.

**Requirements:** R2, R4, R5, R6

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/app/dashboard/video-library-utils.ts`
- Test: `apps/admin/src/app/dashboard/video-library-utils.test.ts`

**Approach:**

- Add normalized parsing for `video` and `collection` URL values with trimming, array handling, length limits, and safe identifier characters.
- Extend `videoLibraryHref` to preserve, set, or omit `video` and `collection` alongside existing page/query/category/language/sort state.
- Ensure collection-changing links reset page state and selected-video state when appropriate, while modal links preserve current list filters.
- Include collection in the active-filter calculation so empty-state copy and clear affordances behave consistently.

**Patterns to follow:**

- Existing parse helpers and defaults in `apps/admin/src/app/dashboard/video-library-utils.ts`
- Existing URL-state assertions in `apps/admin/src/app/dashboard/video-library-utils.test.ts`

**Test scenarios:**

- Happy path: `videoLibraryHref` builds a URL preserving `q`, `type`, `language`, `sort`, and adding `video`.
- Happy path: a collection filter URL includes `collection`, omits default filters, and uses page `1` when changing collection scope.
- Edge case: array values use the first item for `video` and `collection`.
- Edge case: whitespace, empty strings, overlong values, and unsafe identifier values normalize to empty state.
- Regression: existing search/type/language/sort href tests continue to pass unchanged.

**Verification:**

- URL helpers can represent all required list, modal, and collection states without hand-building query strings in page components.

---

### U2. Add Collection-Aware List Queries

**Goal:** Make the video list and count queries understand a collection parent so pagination and filters operate against child videos.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/services/video.service.ts`
- Test: `apps/admin/src/services/video.service.test.ts`
- Modify: `apps/admin/src/app/dashboard/live-data.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Extend the video list input shape with an optional collection identifier.
- Add a collection filter that matches a non-deleted parent video by slug, Core id, or database id, then filters rows through `VideoRelation`.
- Compose the collection filter with existing search, category, dubbed-language, and sort filters for both `list` and `countActive`.
- Thread collection state through `countActiveVideos`, `loadVideoRowSlice`, and `loadVideoLibraryPage`.
- Add batched row metadata for whether a row is a collection drill-down target and, where practical, how many child videos it has.

**Patterns to follow:**

- `videoCategoryWhere`, `videoLanguageWhere`, and `videoListWhere` composition in `apps/admin/src/services/video.service.ts`
- Current `loadVideoLibraryPage` pattern in `apps/admin/src/app/dashboard/live-data.ts`

**Test scenarios:**

- Happy path: `VideoService.list` adds a parent-relation filter when `collection` is present.
- Happy path: `VideoService.countActive` uses the same collection filter as `list`.
- Integration: collection, search, category, dubbed language, and sort can be present together and produce a combined Prisma filter/order.
- Edge case: missing collection input produces the same non-deleted scope as today.
- Edge case: stale collection input produces zero rows rather than falling back to the full catalog.
- Regression: existing category, language, search, and sort tests keep their current expectations when collection is absent.

**Verification:**

- The list total, visible rows, and pagination all reflect the active collection scope.

---

### U3. Load Normalized Video Detail Data

**Goal:** Create a bounded server-side detail loader for the modal that gathers the admin-known metadata and relation summaries for one selected video.

**Requirements:** R1, R2, R5, R6, R9

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/app/dashboard/live-data.ts`
- Modify: `apps/admin/src/services/video.service.ts`
- Test: `apps/admin/src/services/video.service.test.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Add a server-side detail-loading path keyed by the normalized `video` URL value.
- Resolve selected videos by slug first, then Core id or database id as a stale-link fallback.
- Select and normalize detail categories for identity, source/origin, primary language, timestamps, localized metadata, dubs, images, subtitles, study questions, Bible citations, keywords, parents, children, scene summaries, and transcript summaries.
- Keep heavyweight internal data bounded: do not expose vectors, and summarize transcript chunks or scene locale blobs by counts/provenance unless a small preview is clearly safe.
- Return `null` for missing/deleted videos and let the page render the list without crashing.

**Patterns to follow:**

- Existing row-normalization helpers in `apps/admin/src/app/dashboard/live-data.ts`
- Existing `VideoService.getBySlug` and `VideoService.getById` read helpers in `apps/admin/src/services/video.service.ts`
- Schema relationships documented in `apps/admin/prisma/schema.prisma`

**Test scenarios:**

- Happy path: a selected video resolves and the page receives detail data for the modal.
- Happy path: detail data includes localized titles/descriptions, dubs with language labels, image metadata, parent/child relations, and count summaries for heavy artifact groups.
- Edge case: an unknown `video` value returns no modal data and does not affect the list render.
- Edge case: a soft-deleted selected video is not shown.
- Regression: list loading still works when no `video` URL param is present and does not run unnecessary detail work.

**Verification:**

- Modal data is available from a single normalized server object and does not require client-side database/API fetching.

---

### U4. Render Clickable Rows, Collection Context, And Detail Modal

**Goal:** Wire the URL-backed row interactions into the video library UI and render an accessible read-only detail modal.

**Requirements:** R1, R2, R3, R4, R5, R7, R8, R9

**Dependencies:** U1, U2, U3

**Files:**

- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Create: `apps/admin/src/app/dashboard/videos/video-detail-modal.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Parse `video` and `collection` from `searchParams` in the page and pass collection state into `loadVideoLibraryPage`.
- Generate primary row links from the URL helper: ordinary rows set `video`; collection-like rows set `collection` and reset page/modal state.
- Add an active collection context treatment near the toolbar or list header with the selected collection label, child count when available, and a clear link.
- Keep external visitor anchors and disabled row-action placeholders separate from the primary row click target to avoid nested interactive controls and accidental modal/filter activation.
- Render a client modal component only when the server returned selected video detail data. The modal owns focus trap, Escape/backdrop close, body scroll lock, and close navigation to an href that removes only `video`.
- Organize modal content into scannable sections using the current compact admin visual language rather than a marketing-style card layout.

**Patterns to follow:**

- Row visual language in `apps/admin/src/app/dashboard/videos/page.tsx`
- Dialog behavior in `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
- Current message grouping under `pages.videos` in `apps/admin/src/i18n/messages.ts`

**Test scenarios:**

- Happy path: rendering a page with ordinary video rows includes row links that add `video=<slug>` while preserving active filters.
- Happy path: rendering a collection-like row includes a primary link that adds `collection=<slug>` and does not add `video`.
- Happy path: rendering with a valid `video` URL state includes `role="dialog"`, selected video title, identity fields, and a close link that preserves filters while removing `video`.
- Happy path: rendering with a valid `collection` URL state includes a collection context label and a clear link.
- Edge case: external visitor links remain `target="_blank"` anchors and their hrefs do not become modal links.
- Edge case: empty filtered collection results use the existing empty-search treatment plus collection context, not a page error.
- Accessibility: modal markup has dialog labeling, a close control with an accessible name, and scrollable content regions for long details.

**Verification:**

- Operators can click a video to inspect it, close the modal back to the same list state, click a collection to drill into children, and combine collection plus selected-video URL state.

---

## System-Wide Impact

- **Interaction graph:** `/dashboard/videos` gains two new URL states but keeps the same route, auth gate, and server-rendered page entry point.
- **Error propagation:** Missing table fallbacks should remain limited to dashboard data loaders; stale selected video/collection values should become empty/null UI state rather than thrown errors.
- **State lifecycle risks:** The main risk is accidentally dropping existing query params when opening/closing modal or switching collection. Centralizing href construction in `videoLibraryHref` mitigates this.
- **API surface parity:** No public GraphQL schema, admin SDL, or downstream typed-client contracts change in this plan.
- **Integration coverage:** Unit tests should cover helpers and service filters; dashboard render tests should cover URL composition, modal presence, collection context, and control isolation.
- **Unchanged invariants:** The video catalog remains read-only, Core-sourced rows remain authoritative, and public visitor URL resolution stays unchanged.

---

## Risks & Dependencies

| Risk                                                                    | Mitigation                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Modal detail queries become expensive for large videos                  | Use bounded selects, relation counts, and summary sections for heavy artifacts; avoid loading embedding vectors or full chunk bodies. |
| Query params produce confusing stale states                             | Normalize params, resolve permissively by slug/Core id/database id, and render missing detail/filter states without crashing.         |
| Row click targets conflict with external links or disabled placeholders | Keep controls as separate interactive elements and use tests to assert visitor links remain external anchors.                         |
| Collection filtering conflicts with type filters                        | Compose filters intentionally and document that `collection` scopes the universe before the existing filters narrow it further.       |
| Modal content becomes visually overwhelming                             | Use compact sections, count summaries, and scrollable areas following existing admin diagnostics modal patterns.                      |

---

## Documentation / Operational Notes

- Update the relevant roadmap or follow-up docs only if implementation discovers behavior that changes the broader `feat-100` editorial workflow.
- Browser proof should use the local admin preview on port `3003` and Helium, matching this repo's agent guidance. If authentication blocks local verification, ask the user to resolve login and then continue the smoke pass.
- No database migration, sync rerun, or production rollout step is expected for this slice.

---

## Sources & References

- Roadmap: `docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md`
- Prior controls plan: `docs/plans/2026-06-03-001-feat-admin-video-library-controls-plan.md`
- Prior interaction-affordance plan: `docs/plans/2026-06-01-001-fix-admin-interaction-affordances-plan.md`
- Video library page: `apps/admin/src/app/dashboard/videos/page.tsx`
- Video library toolbar: `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx`
- URL helpers: `apps/admin/src/app/dashboard/video-library-utils.ts`
- Dashboard data loader: `apps/admin/src/app/dashboard/live-data.ts`
- Video service: `apps/admin/src/services/video.service.ts`
- Prisma video schema: `apps/admin/prisma/schema.prisma`
- Modal pattern: `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
- Related PR: #1121
