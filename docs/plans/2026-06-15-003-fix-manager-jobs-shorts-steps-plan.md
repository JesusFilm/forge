---
title: "fix: Keep Manager jobs parsing aligned with Shorts workflow steps"
type: fix
status: complete
date: 2026-06-15
origin: docs/brainstorms/2026-06-11-manager-shorts-studio-requirements.md
---

# fix: Keep Manager jobs parsing aligned with Shorts workflow steps

## Summary

The Manager jobs page can fail during the Server Components render when the latest Admin-backed jobs include Shorts Studio records. Shorts writes `shorts_prepare`, `shorts_render`, and `shorts_mux_output` into persisted job state, but the Admin GraphQL adapter validates job step names with a duplicated enum that omits those values.

This plan makes the Manager runtime parser derive from the same step-name source as `WorkflowStepName`, adds regression coverage for Shorts jobs in the list payload, and keeps truly invalid job payloads rejected at the Admin boundary.

---

## Problem Frame

Shorts Studio meets the origin requirement that shorts run as durable Manager jobs with visible progress and retryable failures. The current crash comes from a local contract split: `apps/manager/src/types/job.ts` includes Shorts steps, `apps/manager/src/lib/workflow-steps.ts` persists them, and Shorts routes/workflows write them, while `apps/manager/src/backend/admin-client.ts` rejects them on read.

The user-facing symptom is intermittent because `/dashboard/jobs` server-renders only the latest 50 jobs. The page works until a Shorts job enters that window, then the server component throws before `LiveJobsTable` can render.

---

## Requirements

Requirement IDs below are plan-local. Origin requirements are referenced with
the `origin R<N>` form when needed.

**Runtime contract**

- R1. Manager must parse every currently declared `WorkflowStepName` value from Admin-backed job records.
- R2. The jobs list and job detail readers must still reject invalid job status, invalid step status, and unknown step-name values at the Admin boundary.
- R3. Adding a future workflow step should require one canonical step-name update, not a second hidden parser update.

**Operator behavior**

- R4. `/dashboard/jobs` must render when the latest job window contains Shorts prepare or render jobs.
- R5. Existing Shorts jobs must not require a data backfill.

---

## Key Technical Decisions

- **Derive runtime validation from a tuple:** Export a `WORKFLOW_STEP_NAMES` tuple from `apps/manager/src/types/job.ts` and derive `WorkflowStepName` from it. This keeps TypeScript and Zod on one source for the step-name literal set.
- **Keep strict status validation:** Job status and step status remain closed runtime schemas because Admin GraphQL already exposes status enums and invalid statuses are real data-contract failures.
- **Do not change Admin schema:** Admin stores step names as strings by design, and the immediate bug is Manager-side parser drift. No generated GraphQL artifacts or database migration are needed.
- **Test list parsing, not only detail parsing:** The reported page calls `listJobs({ limit: 50 })`; coverage must prove a list payload containing Shorts steps parses successfully.

---

## Implementation Units

### U1. Centralize Manager workflow step names

- **Goal:** Replace the duplicated hardcoded parser step list with a canonical exported literal tuple.
- **Requirements:** R1, R3
- **Dependencies:** None
- **Files:** `apps/manager/src/types/job.ts`, `apps/manager/src/backend/admin-client.ts`
- **Approach:** Add `WORKFLOW_STEP_NAMES` in `types/job.ts`, derive `WorkflowStepName` from `typeof WORKFLOW_STEP_NAMES[number]`, and build `workflowStepSchema` in `admin-client.ts` from the tuple. Keep the runtime schema typed as `WorkflowStepName` so downstream job records preserve the current type contract.
- **Patterns to follow:** `apps/manager/src/lib/workflow-steps.ts` already treats step inventories as literal arrays; keep the canonical list near the type that all surfaces import.
- **Test scenarios:** Covered by U2.
- **Verification:** Manager typecheck accepts all existing step inventories and workflow calls without widening step names to plain `string`.

### U2. Prove Shorts jobs parse from Admin list payloads

- **Goal:** Add regression coverage for the exact page-load failure mode.
- **Requirements:** R1, R2, R4, R5
- **Dependencies:** U1
- **Files:** `apps/manager/src/backend/admin-client.test.ts`
- **Approach:** Extend `AdminGraphqlClient` list-job tests with Admin payloads containing `shorts_prepare`, `shorts_render`, and `shorts_mux_output` in `steps` and `currentStep`. Assert `listJobs` resolves and preserves those names. Keep or add negative assertions that unknown step names, invalid step statuses, and invalid job statuses still throw.
- **Execution note:** Add the failing Shorts payload test before changing the parser so the regression is visible.
- **Patterns to follow:** Existing `listJobs` pagination test and invalid `managerJob` payload test in the same file.
- **Test scenarios:**
  - Happy path: `managerJobs` returns a prepare job with `currentStep: "shorts_prepare"` and a matching step; `listJobs` resolves with that step.
  - Happy path: `managerJobs` returns a render job with `currentStep: "shorts_render"` plus `shorts_render` and `shorts_mux_output` steps; `listJobs` resolves with both.
  - Happy path: `managerJobs` returns a render job with `currentStep: "shorts_mux_output"` after render completion; `listJobs` resolves with that terminal Mux-output step.
  - Failure path: a payload with an unknown step name still rejects with `invalid Manager job list payload`.
  - Failure path: a payload with a valid step name but invalid step status still rejects for both list and detail reads.
  - Failure path: a payload with an invalid job status still rejects.
- **Verification:** Targeted backend tests fail before U1 and pass after U1.

### U3. Validate the page data path

- **Goal:** Ensure the server-render data loader can receive Shorts jobs without tripping the page boundary.
- **Requirements:** R4, R5
- **Dependencies:** U1, U2
- **Files:** `apps/manager/src/app/dashboard/jobs/page.test.ts`, `apps/manager/src/features/jobs/jobs-table-presenter.test.ts`
- **Approach:** Keep `page.test.ts` scoped to the server component data-loading and prop-handoff boundary because it mocks `LiveJobsTable`. Add presenter-level coverage for Shorts `currentStep` values so the visible jobs-table status/progress formatting accepts the same step names that the parser accepts.
- **Patterns to follow:** Existing jobs page tests should continue to mock the state and gateway boundaries instead of requiring a live Admin GraphQL endpoint.
- **Test scenarios:**
  - Happy path: a Shorts job from `listJobs` is passed through the jobs page with language labels loaded.
  - Happy path: presenter formatting for `currentStep: "shorts_render"` produces a stable in-progress label instead of throwing or falling back to an unrelated step.
  - Edge case: a Shorts job with an empty language list still renders, matching current Shorts job creation behavior.
- **Verification:** Page test proves the server component returns a renderable tree for a Shorts job payload.

---

## Scope Boundaries

- Do not make unknown future step names render silently; unknown steps remain data-contract failures until intentionally added.
- Do not change Shorts workflow phase semantics or the `ShortsPhase` metadata artifact.
- Do not alter Admin GraphQL schema, Prisma models, or generated `packages/admin-graphql` artifacts.
- Do not address unrelated UI alignment changes already present in the worktree.

### Deferred to Follow-Up Work

- If operators need the jobs page to degrade around corrupt historical rows, plan a separate resilience pass that reports or skips invalid records without hiding data-quality issues.

---

## Sources & Research

- `docs/roadmap/media-generation/feat-178-manager-shorts-studio.md` records Shorts Studio as active work and documents `shorts_` step and artifact contracts.
- `docs/brainstorms/2026-06-11-manager-shorts-studio-requirements.md` requires Shorts to use durable Manager jobs with visible progress and retry.
- `docs/plans/2026-06-11-002-feat-manager-shorts-studio-plan.md` establishes the Shorts job lifecycle, including `shorts_prepare`, `shorts_render`, and `shorts_mux_output`.
- `docs/solutions/integration-issues/manager-cleaned-audio-review-links-20260412.md` documents a prior instance of persisted Manager step-name drift causing job contract failures.
