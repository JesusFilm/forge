---
title: "feat: Redesign admin video library page"
type: feat
status: active
date: 2026-06-02
roadmap: docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md
---

# feat: Redesign admin video library page

## Summary

Redesign `/dashboard/videos` so the admin video library reads like the current
production admin reference while preserving the newly shipped server-rendered
search, pagination, thumbnail, visitor-link, and read-only Core catalog
behavior.

---

## Problem Frame

The admin video library has accumulated the right data path but still presents
as a dense operational table with older Forge shell framing. The user asked to
redesign the page to match `https://admin.jesusfilm.org/dashboard/videos`, so
the implementation should make the local page visually align with that
reference without widening into video editing or new data mutations.

---

## Assumptions

_This plan was authored without synchronous user confirmation. The items below
are agent inferences that fill gaps in the input and should be reviewed before
implementation proceeds._

- The target is the `apps/admin` `/dashboard/videos` surface, not the public
  web `/videos` route.
- "Like this" means visual/layout parity with the production admin videos page
  while keeping current local behavior intact.
- The production reference requires an authenticated admin session; unauthenticated
  planning-time access redirects through login, so implementation should verify
  against the accessible local page and any browser-authenticated reference
  available during smoke testing.
- The redesign should remain read-oriented under `feat-100`; manual video
  creation, row editing, bulk actions, and advanced filters stay deferred.

---

## Requirements

- R1. `/dashboard/videos` adopts a refreshed page composition aligned with the
  production admin reference at `https://admin.jesusfilm.org/dashboard/videos`.
- R2. Existing search behavior remains URL-backed through `q`, with submitted
  queries, clear action, active-query copy, and filtered empty states preserved.
- R3. Existing pagination remains server-rendered and query-aware, including
  truthful counts and previous/next links.
- R4. Video rows still expose thumbnail, title, Core ID, type label, source,
  dub coverage, relative updated time, duration, and visitor-link availability.
- R5. The redesigned table/list is responsive: it stays dense and scannable on
  desktop and avoids broken overflow or unreadable controls on narrow screens.
- R6. Disabled or unavailable workflows remain visibly disabled with accessible
  labels; the redesign must not make deferred creation, filtering, editing, or
  row actions look operational.
- R7. The change preserves the Core-sourced read-only boundary and does not add
  Prisma, Pothos, GraphQL SDL, or generated type changes.

---

## Scope Boundaries

- Do not add video creation, editing, deletion, publish, or bulk-action
  behavior.
- Do not replace the current server-rendered loader with client-side filtering
  or client-owned pagination state.
- Do not change the video service search contract unless implementation
  discovers a narrow display data gap.
- Do not import from `apps/web`, alter public watch routes, or change visitor
  URL resolution behavior.
- Do not create a one-off visual system that conflicts with existing
  `apps/admin` shell tokens and `admin-ui` component grammar.

### Deferred to Follow-Up Work

- Authenticated production-reference visual capture can be attached to a later
  QA note if Helium/browser access to the production admin session is available.
- Manual video creation, full video editing, faceted filters, column sorting,
  and bulk actions remain later `feat-100` slices.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/videos/page.tsx` is the server-rendered route
  that currently renders the search form, table, row actions, and pagination.
- `apps/admin/src/app/dashboard/live-data.ts` owns `loadVideoLibraryPage` and
  returns the row fields the page should keep displaying.
- `apps/admin/src/app/dashboard/video-library-utils.ts` owns URL query parsing,
  pagination helpers, thumbnail URL normalization, and visitor-link helpers.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` already covers the
  videos page SSR output, search wiring, pagination links, thumbnails, relative
  updated time, and visitor-link states.
- `apps/admin/src/i18n/messages.ts` owns the copy for the videos page,
  including search, empty states, action labels, and unavailable workflow text.
- `apps/admin/src/components/admin-ui.tsx` provides `DashboardPageHeader`,
  `InfoStrip`, `PageSection`, `StatusPill`, and button primitives used across
  dashboard pages.
- `docs/plans/2026-06-01-001-feat-admin-video-library-pagination-plan.md`
  shipped the page's pagination, thumbnail, label, and visitor-link baseline.
- `docs/plans/2026-06-02-001-feat-admin-video-library-search-plan.md`
  shipped the URL-backed broad search baseline this redesign must preserve.
- `docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md`
  is already `in-progress` and is the correct roadmap umbrella for this slice.

### Institutional Learnings

- `docs/roadmap/platform/feat-153-admin-interaction-affordance-polish.md`
  completed disabled-state and clickability polish for `/dashboard/videos`;
  the redesign should preserve those affordance rules instead of making
  placeholders look active.

### External References

- `https://admin.jesusfilm.org/dashboard/videos` is the user-provided visual
  reference. A planning-time unauthenticated request redirected to the admin
  auth flow, so exact post-login pixels must be verified with an authenticated
  browser if available during the browser-test phase.

---

## Key Technical Decisions

- Keep the redesign in the page layer first: most of the work should be layout,
  composition, copy placement, and styling in `videos/page.tsx`, reusing the
  row data already returned by `loadVideoLibraryPage`.
- Prefer small reusable admin UI helpers only when a layout primitive is likely
  to benefit sibling dashboard pages; otherwise keep page-specific markup near
  the videos route to avoid broad visual churn.
- Preserve server rendering and URL state. The search form, pagination links,
  and empty states should remain HTML-first and testable through SSR output.
- Treat unavailable controls as part of the design, not as future promises:
  disabled creation/filter/editorial affordances should remain clearly
  non-clickable and accessible.
- Use the current admin token palette and restrained operational density rather
  than marketing-page composition; this is an operator catalog, not a landing
  page.

---

## Open Questions

### Resolved During Planning

- Should this create a new roadmap ticket? No. `feat-100` already covers admin
  video/media editorial workflow refinement and is in progress.
- Should the existing search plan be reused? No. Search is already represented
  by a separate active plan and current code; this plan is the visual redesign
  slice that preserves search.
- Should implementation wait for unauthenticated access to the production
  reference? No. The URL is an authoritative visual target, but the authenticated
  page is not readable from plain planning access; continue with local
  implementation and browser validation.

### Deferred to Implementation

- Exact visual deltas from the authenticated production reference: capture or
  inspect through Helium/browser if a logged-in session is available.
- Whether the final presentation is still a table, a media-list table hybrid,
  or responsive cards on small screens: choose the smallest shape that matches
  the reference and preserves scannability.

---

## Implementation Units

### U1. Reference-Oriented Page Structure

**Goal:** Recompose the videos page around the production-reference layout
while preserving existing page data and disabled workflow semantics.

**Requirements:** R1, R2, R3, R6, R7

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Rework the header, status strip, search area, primary action placement, and
  table/list section so the page feels like the current admin reference rather
  than the older dense table composition.
- Preserve `requireSession`, `parseVideoLibraryPage`,
  `parseVideoLibraryQuery`, `loadVideoLibraryPage`, and
  `videoLibraryHref` wiring.
- Keep manual video creation and any deferred filter/action affordances
  disabled and clearly labeled.

**Patterns to follow:**

- `apps/admin/src/components/admin-ui.tsx` for existing admin shell tokens,
  buttons, sections, and status pills.
- `docs/roadmap/platform/feat-153-admin-interaction-affordance-polish.md` for
  disabled and read-only affordance rules.

**Test scenarios:**

- Happy path: the page renders the refreshed header/search/table composition
  while calling `loadVideoLibraryPage` with the parsed page and query.
- Edge case: disabled manual video creation remains disabled and carries the
  unavailable label.
- Integration: clear/search links and previous/next pagination links preserve
  the same URL semantics as before the redesign.

**Verification:**

- SSR output proves existing behavior was preserved while the new copy and
  structural landmarks render.

---

### U2. Responsive Video Row Presentation

**Goal:** Redesign the video row/table presentation so catalog records are more
visual and scan-friendly without losing any current row facts.

**Requirements:** R1, R4, R5, R6

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Keep row data fields intact: thumbnail, duration, title, Core ID, label,
  source, dubs, updated time, and visitor action state.
- Adjust desktop and narrow-screen layout with stable dimensions so thumbnails,
  labels, icons, and text do not resize or overlap unexpectedly.
- Preserve lazy thumbnail loading and visitor-link accessibility.

**Patterns to follow:**

- Existing thumbnail rendering in `apps/admin/src/app/dashboard/videos/page.tsx`.
- Existing status pill tone usage from the current videos and dashboard pages.

**Test scenarios:**

- Happy path: rows still include thumbnails, lazy image attributes, duration,
  label, source, dubs, updated time, and visitor URL when available.
- Edge case: rows without thumbnails or visitor URLs render polished fallback
  states and disabled accessible controls.
- Responsive expectation: markup and class choices avoid hard desktop-only
  assumptions for the primary row content.

**Verification:**

- Unit/SSR tests continue to assert row facts and accessible action states.
- Browser smoke confirms the redesigned rows fit without incoherent overlap on
  desktop and mobile widths.

---

### U3. Visual Smoke and Regression Coverage

**Goal:** Validate the redesign through targeted tests and a browser smoke of
the real page state.

**Requirements:** R1, R2, R3, R5, R6

**Dependencies:** U1, U2

**Files:**

- Modify: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- Create if useful: `docs/qa/admin-video-library-redesign-2026-06-02.md`

**Approach:**

- Update SSR expectations for the redesigned structure without turning tests
  into brittle class snapshots.
- Run the focused dashboard tests plus admin typecheck/lint.
- Use Helium/browser smoke for `/dashboard/videos` and a queried state such as
  `/dashboard/videos?q=mux`; capture desktop and mobile evidence if available.

**Patterns to follow:**

- Existing dashboard SSR tests in
  `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`.
- Prior Forge UI QA pattern of recording screenshots or a concise QA note when
  visual behavior is the point of the change.

**Test scenarios:**

- Happy path: default videos page renders redesigned structure with current
  row data.
- Integration: queried videos page renders active search state and query-aware
  pagination.
- Accessibility: disabled controls and unavailable visitor links expose clear
  labels/states.

**Verification:**

- `pnpm --filter @forge/admin test -- src/app/dashboard/dashboard-ui.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- Helium/browser smoke for desktop and mobile `/dashboard/videos` views.

---

## Risks & Dependencies

| Risk                                                                           | Mitigation                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| The authenticated production reference cannot be inspected in this session.    | Preserve the user-provided URL as the visual target, use local browser smoke, and document any auth limitation in QA evidence. |
| A visual redesign could accidentally regress search or pagination.             | Keep the server-rendered helpers and loader contract unchanged, and assert the current URL semantics in SSR tests.             |
| Dense operator content can break on mobile if converted directly from a table. | Use stable thumbnail/action dimensions and verify both desktop and narrow browser widths.                                      |
| Disabled future workflows could look active after restyling.                   | Preserve disabled button/link semantics and assert unavailable labels in tests.                                                |

---

## Documentation / Operational Notes

- If browser smoke produces useful screenshots or authenticated-reference notes,
  record them in `docs/qa/admin-video-library-redesign-2026-06-02.md`.
- No GraphQL SDL, Prisma, or generated type updates are expected for this
  redesign.

---

## Sources & References

- Roadmap: `docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md`
- Related plan: `docs/plans/2026-06-01-001-feat-admin-video-library-pagination-plan.md`
- Related plan: `docs/plans/2026-06-02-001-feat-admin-video-library-search-plan.md`
- Related roadmap note: `docs/roadmap/platform/feat-153-admin-interaction-affordance-polish.md`
- Page entry point: `apps/admin/src/app/dashboard/videos/page.tsx`
- Dashboard loader: `apps/admin/src/app/dashboard/live-data.ts`
- Tests: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- User-provided reference: `https://admin.jesusfilm.org/dashboard/videos`
