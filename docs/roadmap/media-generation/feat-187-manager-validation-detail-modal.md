---
id: "feat-187"
title: "Manager validation detail modal"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-13"
duration: 1
depends_on:
  - "feat-186"
blocks: []
tags:
  - "manager"
  - "coverage"
  - "subtitle-enrichment"
---

## Problem

After the Manager Coverage `Enrich Now` route returns a validation failure, the
job order sidebar shows a compact error but does not let operators inspect the
full error body. This hides useful details such as field validation messages,
unresolved language IDs, and per-video materialization failures.

## Entry Points - Read These First

1. `docs/plans/2026-06-13-002-fix-manager-validation-detail-modal-plan.md`
   - implementation plan for this follow-up.
2. `apps/manager/src/features/enrich-selection.ts`
   - shared enrich feedback model and error formatting.
3. `apps/manager/src/features/coverage/enrich-action-controls.tsx`
   - job order sidebar controls and feedback rendering.
4. `apps/manager/src/features/coverage/coverage-report-client.tsx`
   - caller that parses `/api/enrich` responses.
5. `apps/manager/src/app/api/enrich/route.ts`
   - route response envelopes the UI should display.

## Grep These

- `EnrichFeedback` in `apps/manager/src`
- `formatEnrichRequestErrorMessage` in `apps/manager/src`
- `translation-feedback` in `apps/manager/src/app/globals.css`

## What To Build

- Preserve the sidebar's compact feedback message.
- Add structured detail rows to error feedback when route responses include
  `details.formErrors`, `details.fieldErrors`, `errors`, or
  `unresolvedTargetLanguageIds`.
- Render error feedback with detail rows as a clickable message.
- Open a modal dialog containing the detailed errors.
- Keep success feedback and job links unchanged.

## Constraints

- Do not change `/api/enrich` response shapes.
- Do not add new color values unless needed for accessible states; reuse
  existing Manager UI styling tokens and classes.
- Keep the fix inside `apps/manager` UI/model code.

## Verification

- `pnpm --filter @forge/manager test -- enrich-selection enrich-action-controls`
  passed on 2026-06-13.
- `pnpm --filter @forge/manager typecheck` passed on 2026-06-13.
- `pnpm --filter @forge/manager lint` passed on 2026-06-13.
- Helium/browser smoke on local Manager Coverage passed on 2026-06-13:
  selected a mock coverage video, intercepted `/api/enrich` with a structured
  validation failure, clicked the sidebar error message, and confirmed the
  modal showed field and per-video error rows.

## Resolution

Manager Coverage feedback now carries optional structured error details. Failed
`Enrich Now` responses render the compact sidebar message as a dialog trigger,
and the modal shows validation field errors, unresolved IDs, and per-video
errors without changing success feedback or job links.
