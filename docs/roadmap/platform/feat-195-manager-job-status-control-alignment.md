---
id: "feat-195"
title: "Manager job status control alignment"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on:
  - "feat-114"
blocks: []
tags:
  - "manager"
  - "jobs"
  - "ui"
  - "design-system"
---

## Problem

Manager job detail rows right-align a variable-width status control group. Rows
with expandable details include a chevron action button, while static rows do
not, so completed checkmarks land at different horizontal positions in the same
Status column.

## Entry Points - Read These First

1. `apps/manager/src/features/jobs/collapsible-step-row.tsx` - renders the
   status icon, retry count, and optional details chevron.
2. `apps/manager/src/app/globals.css` - owns the `.jobs-step-status-cell` and
   `.jobs-step-expand-button` layout rules.
3. `apps/manager/src/features/jobs/collapsible-step-row.test.ts` - focused
   server-rendered component regression coverage.
4. `apps/manager/src/features/jobs/live-job-steps-table.tsx` - maps job steps
   into static or expandable `CollapsibleStepRow` instances.

## Grep These

- `jobs-step-status-cell`
- `jobs-step-expand-button`
- `jobs-step-expand-spacer`
- `CollapsibleStepRow`

## What To Build

- Reserve the same trailing action slot for static and expandable job rows.
- Keep the reserved slot hidden from assistive technology and pointer events.
- Preserve the existing chevron button affordance, focus state, and click
  behavior for expandable rows.
- Add a focused regression test that proves static rows render the reserved
  slot and expandable rows render the real disclosure button.

## Constraints

- Do not redesign the Manager jobs table or introduce new color tokens.
- Do not change job data, step expansion rules, live polling, or artifact
  behavior.
- Keep the fix local to Manager job detail row rendering and shared CSS.

## Verification

- `pnpm --filter @forge/manager test -- collapsible-step-row`
- `pnpm --filter @forge/manager typecheck`
- Browser smoke screenshot of a Manager job detail table showing status
  checkmarks aligned for rows with and without the chevron action.

## Completion Notes

- Static job rows now render an invisible `.jobs-step-expand-spacer` so their
  status control group reserves the same trailing action slot as expandable
  rows.
- The spacer is hidden from assistive technology and has pointer events
  disabled; expandable rows still render the real disclosure button.
- Focused component coverage verifies static rows get the spacer and
  expandable rows get the disclosure button.
- Local browser smoke on `/dashboard/jobs/mock-job-1` measured every visible
  status icon at `x=1180` (`maxDeltaPx: 0`) across rows with and without the
  chevron. Screenshot: `/private/tmp/manager-job-status-alignment.png`.
