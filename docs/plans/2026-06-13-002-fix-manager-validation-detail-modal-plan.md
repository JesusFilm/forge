---
title: "Fix Manager validation detail modal"
type: fix
status: completed
date: 2026-06-13
origin: docs/roadmap/media-generation/feat-187-manager-validation-detail-modal.md
---

# Fix Manager Validation Detail Modal

## Summary

Make failed Manager Coverage `Enrich Now` feedback inspectable. When the
request returns structured validation or per-video errors, the sidebar feedback
should be clickable and open a modal with the full detail list.

## Problem Frame

The coverage sidebar currently shows a compact error such as
`Validation failed`, or a single appended detail. Operators need to inspect the
full failure body without leaving the job order context, especially when the
route returns `details.fieldErrors`, `details.formErrors`, unresolved language
IDs, or per-video errors.

## Requirements

- Keep the existing compact feedback text in the job order sidebar.
- When error details exist, render the feedback message as an accessible
  button.
- Clicking the message opens a modal with the detailed errors.
- Include structured validation details, unresolved language IDs, and per-video
  errors in the modal.
- Keep success feedback, job links, and select-mode cancel behavior unchanged.
- Stay inside `apps/manager` UI/model code plus this roadmap/plan work.

## Scope Boundaries

In scope:

- Shared enrich feedback model in `apps/manager/src/features/enrich-selection.ts`.
- Coverage action controls in
  `apps/manager/src/features/coverage/enrich-action-controls.tsx`.
- Focused tests for the presenter/model behavior.

Out of scope:

- Changing `/api/enrich` response envelopes.
- Changing Admin read models, GraphQL generated artifacts, or enrichment job
  creation behavior.
- Reworking broader coverage dashboard styling.

## Implementation Units

### 1. Feedback Details Model

Touch:

- `apps/manager/src/features/enrich-selection.ts`
- `apps/manager/src/features/coverage/enrich-selection.test.ts`

Extend `EnrichFeedback` with optional detail rows. Add helpers that collect
form errors, field errors, unresolved language IDs, and per-video errors from
the existing route response shapes. Reuse the first detail for the compact
message so current behavior remains familiar.

Tests:

- Request validation details produce a compact message and full detail rows.
- Per-video failure outcomes include inspectable detail rows.

### 2. Clickable Feedback Modal

Touch:

- `apps/manager/src/features/coverage/enrich-action-controls.tsx`
- `apps/manager/src/features/coverage/enrich-action-controls.test.ts`
- `apps/manager/src/app/globals.css`

Render feedback with details as a button inside the existing feedback area.
Open a modal dialog using existing manager modal styling conventions and show
the detail rows in a simple list. Leave feedback without details as plain text.

Tests:

- Error feedback with details renders a button with dialog affordance.
- Success feedback still renders a normal jobs link and no detail button.

## Verification

- `pnpm --filter @forge/manager test -- enrich-selection enrich-action-controls`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- Helium/browser smoke on Manager Coverage if local manager starts cleanly.
