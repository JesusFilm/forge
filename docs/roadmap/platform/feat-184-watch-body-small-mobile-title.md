---
id: "feat-184"
title: "Compact Watch body title on small mobile screens"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "responsive-ui"
---

## Problem

Long Watch video titles use too much horizontal and vertical space beside the
Download action on small mobile screens. The existing medium and desktop title
sizes already have the intended hierarchy and must remain unchanged.

## Entry Points - Read These First

1. `docs/plans/2026-07-16-001-fix-watch-body-small-mobile-title-plan.md` - implementation plan and scope boundaries.
2. `apps/web/src/components/watch/WatchBody.tsx` - repeated video title and Download action layout.
3. `apps/web/src/components/watch/__tests__/WatchBody.test.tsx` - responsive class and title-row regression coverage.

## Grep These

- `watch-body-title`
- `text-[27px]`
- `md:text-4xl`
- `watch-body-title-row`

## What To Build

1. Use a smaller title size below the Tailwind `sm` breakpoint.
2. Preserve the current 27px size from `sm` until `md`.
3. Preserve the current `md` and `xl` title sizes.
4. Keep the title and Download action in the existing non-wrapping row.
5. Pin the complete responsive title-size chain in the focused component test.

## Constraints

- Do not change the title's heading level, line height, font weight, or content.
- Do not change the Download button or title-row layout.
- Do not alter other Watch heading components.

## Verification

- Run the focused `WatchBody` component test.
- Run the `@forge/web` typecheck.
- Verify the long-title state visually at a small mobile viewport and confirm the existing scale remains at a medium viewport.
