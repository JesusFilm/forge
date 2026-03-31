---
title: "fix(manager): resolve coverage dashboard review regressions"
type: fix
status: completed
date: 2026-03-28
---

# fix(manager): resolve coverage dashboard review regressions

## Overview

Tighten the current `apps/manager` dashboard refresh into one reviewable fix slice by addressing the three concrete regressions surfaced in review:

1. Remove the broken CMS admin link built from the internal `STRAPI_URL`.
2. Restore metadata coverage data instead of returning `none` for every video.
3. Distinguish empty successful video data from an actual API failure.

## Scope

### In scope

- `apps/manager/src/app/api/videos/route.ts`
- `apps/manager/src/app/dashboard/layout.tsx`
- `apps/manager/src/features/coverage/coverage-report-client.tsx`
- `apps/manager/src/features/nav/dashboard-nav.tsx`
- related formatting and lint cleanup in touched manager files

### Out of scope

- broad `/api/videos` query optimization beyond the already tracked todo
- language metadata enrichment beyond the already tracked todo
- adding a new public CMS admin URL environment variable

## Implementation Plan

1. Remove the CMS link prop and menu item so the dashboard does not expose an unreachable admin URL in production.
2. Restore `aiMetadata` to the videos GraphQL query and map metadata coverage from real CMS data.
3. Add explicit client-side video load failure state so:
   - successful empty collections render an empty-state message
   - fetch failures render the outage message
   - coverage controls are not hidden purely because the collection count is zero
4. Run manager lint and typecheck, then update tracking docs and prepare the branch for PR creation.

## Acceptance Criteria

- [x] dashboard user menu no longer links to `STRAPI_URL/admin`
- [x] metadata report reflects `aiMetadata` again
- [x] empty successful `/api/videos` response shows a truthful empty state
- [x] failed `/api/videos` response shows a server failure state
- [x] `pnpm --filter @forge/manager typecheck` passes
- [x] `pnpm --filter @forge/manager lint` passes

## References

- GitHub issue: `#556`
- Todo: `todos/003-complete-p1-manager-review-regressions.md`
- Existing follow-up todos:
  - `todos/001-pending-p2-optimize-videos-graphql-query.md`
  - `todos/002-pending-p2-review-update-language-meta-info.md`

## Outcome

The fix slice keeps the intended dashboard refresh intact while restoring metadata coverage and making the coverage page honest about empty data versus server failure. The user menu now remains safe for production because it no longer exposes an internal service URL to the browser.
