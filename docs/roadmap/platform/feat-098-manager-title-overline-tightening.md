---
id: "feat-098"
title: "Manager Title Overline Tightening"
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
  - "design-system"
  - "mobile"
  - "styling"
---

## Problem

The shared dashboard title treatment still leaves visible top spacing between the overline and the page title on mobile. That weakens the hierarchy of the intro block and makes the title feel detached from the label above it.

## Entry Points — Read These First

1. `apps/manager/src/components/ui/page-intro.tsx` — shared title, eyebrow, and description primitives.
2. `apps/manager/src/features/coverage/coverage-report-client.tsx` — coverage route example using the shared intro components.

## Grep These

- `PageTitle`
- `PageEyebrow`
- `PageIntro`

## What To Build

1. Remove the remaining top margin between `PageEyebrow` and `PageTitle`.
2. Keep the rest of the shared intro rhythm intact unless needed for consistency.
3. Let the change propagate through shared usage rather than patching an individual screen.

## Constraints

- Preserve the current typography scale and tokens.
- Keep the change scoped to the shared intro primitives.
- Do not introduce screen-specific overrides unless verification shows a regression.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/coverage`
- Confirm the mobile title sits directly under the overline with no extra top spacing.

## Completion Notes

- Removed the shared `PageTitle` top margin in `apps/manager/src/components/ui/page-intro.tsx`.
- Verified on the local mobile coverage screen that the title now sits directly beneath the overline.
