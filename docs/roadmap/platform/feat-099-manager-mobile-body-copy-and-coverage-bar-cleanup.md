---
id: "feat-099"
title: "Manager Mobile Body Copy And Coverage Bar Cleanup"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-096"
blocks: []
tags:
  - "manager"
  - "mobile"
  - "design-system"
  - "coverage"
---

## Problem

On mobile, the shared page-description copy reads too faint compared to the surrounding interface, and the active segment in the coverage bar shows an extra inset outline that adds visual noise.

## Entry Points — Read These First

1. `apps/manager/src/components/ui/page-intro.tsx` — shared eyebrow, title, and description primitives.
2. `apps/manager/src/features/coverage/coverage-report-client.tsx` — mobile coverage report intro and segment bar interactions.

## Grep These

- `PageDescription`
- `CoverageBar`
- `shadow-[inset_0_0_0`

## What To Build

1. Make shared dashboard body-copy descriptions read as normal supporting text rather than overly light muted text.
2. Remove the extra active outline treatment from the coverage bar segment buttons.
3. Keep the current spacing, sizing, and palette direction intact.

## Constraints

- Preserve the existing typography scale.
- Keep the change shared where possible instead of screen-specific overrides.
- Do not introduce new colors outside the existing manager palette direction.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/coverage`
- Confirm the intro copy reads darker on mobile and the coverage bar no longer shows an inset outline on the active segment.

## Completion Notes

- Updated the shared `PageDescription` primitive in `apps/manager/src/components/ui/page-intro.tsx` to use stronger body-copy contrast.
- Removed the active inset outline styling from coverage bar segment buttons in `apps/manager/src/features/coverage/coverage-report-client.tsx`.
- Verified both changes on the local mobile coverage screen.
