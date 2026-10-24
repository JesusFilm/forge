---
title: "feat: Match admin video library reference layout"
type: feat
status: completed
date: 2026-06-02
roadmap: docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md
---

# feat: Match admin video library reference layout

## Summary

Bring `apps/admin` `/dashboard/videos` closer to the user-provided production
reference screenshot: a dark operator catalog with a search/tabs/sort toolbar,
one large list surface, visual thumbnails, prominent dub-coverage metrics, and
compact row actions.

## Problem Frame

The first redesign kept too much of the older Forge dashboard framing: summary
tiles, an info strip, and a secondary signals rail. The screenshot target is
more focused and flatter. It treats the page as a video library, not an
analytics dashboard, and makes dub coverage the main scannable metric per row.

## Requirements

- R1. Header copy reads like the reference: `Video Library` plus catalog count
  copy using the real pagination total.
- R2. The top controls visually match the screenshot: search on the left,
  category tabs in the middle, sort control on the right, and the red manual
  video action above the sort control.
- R3. Remove the prior redesign's info strip, summary-tile grid, and right-side
  media-signals rail from this page.
- R4. Rows use the screenshot hierarchy: thumbnail, title/meta/source, large
  dubbed-language count, percentage bar, language chips, updated date, kebab,
  and visitor link.
- R5. Preserve the existing server-rendered search, pagination, thumbnail,
  duration, relative updated time, visitor-link, and disabled unavailable-action
  behavior.
- R6. Keep the Core-sourced read-only boundary. Do not add video creation,
  editing, filters, sorting, GraphQL, Prisma, or generated type changes in this
  visual correction.

## Scope Boundaries

- Category tabs and the sort control are visual placeholders for this slice;
  they should not imply data mutation or new filtering semantics.
- Coverage percentages are display metrics derived from current dub rows and a
  stable catalog-language target until a richer language-total endpoint exists.
- Browser validation may be limited by local admin auth/session setup; record
  that honestly if it blocks visual capture.

## Context & Patterns

- Page: `apps/admin/src/app/dashboard/videos/page.tsx`
- Loader: `apps/admin/src/app/dashboard/live-data.ts`
- URL helpers: `apps/admin/src/app/dashboard/video-library-utils.ts`
- Copy: `apps/admin/src/i18n/messages.ts`
- SSR tests: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- Existing completed redesign plan:
  `docs/plans/2026-06-02-002-feat-admin-video-library-redesign-plan.md`
- Roadmap umbrella:
  `docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md`

## Implementation Units

### U1. Screenshot Toolbar and Page Frame

**Goal:** Replace the prior dashboard-style frame with the screenshot's
library-first composition.

**Files:**

- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Test scenarios:**

- Header renders `Video Library` and count-based catalog copy.
- Search remains URL-backed and preserves the active query and clear action.
- Tabs, sort, and manual-video controls render as unavailable/read-only UI
  without changing search or pagination behavior.

### U2. Dub Coverage Row Data

**Goal:** Expose enough derived row data to render the screenshot's coverage
metric without changing service contracts.

**Files:**

- Modify: `apps/admin/src/app/dashboard/live-data.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Test scenarios:**

- Rows expose a dubbed-language count, display chips, overflow count, coverage
  percentage, and short updated date.
- Existing `dubs` summary remains available for compatibility and empty states.

### U3. Screenshot-Style Row Layout

**Goal:** Render each video as a stable media row with visual thumbnails,
coverage bars, chips, and compact actions.

**Files:**

- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Test scenarios:**

- Rows with images use lazy thumbnails and duration overlays.
- Rows without images render polished patterned fallback thumbnails.
- Visitor links and unavailable row actions keep accessible labels.
- Pagination remains query-aware after the visual rewrite.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/dashboard-ui.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- Browser smoke with Helium/browser tooling against `/dashboard/videos` when the
  local auth/session path permits it; otherwise record the redirect/blocker.
