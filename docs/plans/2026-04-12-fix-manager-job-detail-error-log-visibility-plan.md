---
title: "fix: Manager job detail error log visibility"
type: fix
status: completed
date: 2026-04-12
branch: fix/manager-job-detail-error-log-visibility
origin: docs/brainstorms/2026-04-12-manager-job-detail-error-log-visibility-brainstorm.md
roadmap:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md
---

# fix: Manager job detail error log visibility

## Overview

Hide the manager job detail `Error Log` card unless the current job has logged
errors. The header already follows that rule by only linking to `#error-log`
when `job.errors.length > 0`, but the body always renders the full diagnostic
card and shows `No errors recorded.` for clean jobs.

This should be a narrow Manager UI fix. Keep `job.errors` as the only source of
truth, preserve the existing error table when errors exist, and let the review
player move directly below the steps table when the error block is absent.

## Found Brainstorm

Found brainstorm from 2026-04-12:
`docs/brainstorms/2026-04-12-manager-job-detail-error-log-visibility-brainstorm.md`.
Using it as context for planning.

Key decisions from the brainstorm:

- hide the empty `Error Log` card entirely
- keep the existing error table, count, formatting, and `#error-log` anchor
  when errors exist
- remove the visible `No errors recorded.` state from job details
- do not change error recording or job-state normalization
- treat a failed job with no logged errors as a separate data-recording concern

## Problem Statement

Operators open manager job details to inspect workflow state, artifacts, errors,
and review-player output. For successful or still-clean jobs, the current empty
`Error Log` card adds page noise and pushes the review surface lower without
offering an action.

The UI is also internally inconsistent: the summary header hides the `Error log`
anchor when there are no errors, while the page body still renders an empty
error section. The body should mirror the header's persisted-state rule.

## Proposed Solution

Extract the error-log markup into a small pure presentational component, then
render it from `LiveJobDetailScreen`.

The component should accept `errors: JobError[]` and:

- return `null` when `errors.length === 0`
- render the existing `section#error-log` card when `errors.length > 0`
- keep the existing table structure, code formatting, operator hint, count, and
  date formatting behavior

`LiveJobDetailScreen` should continue to pass current live `job.errors`, not
`initialJob.errors`, so the block appears if live polling later appends an
error.

## Scope Boundaries

In scope:

- Manager job detail page only
- hiding the error block when `job.errors.length === 0`
- preserving the existing error block when one or more errors exist
- Red/Green unit coverage for zero-error and error-present render states
- user smoke testing on real job detail pages

Out of scope:

- jobs list error behavior
- workflow error recording, retry behavior, or `JobRecord` schema changes
- adding a new `hasErrors` flag or local UI-only error source
- adding React Testing Library, jsdom, or a browser test stack to
  `apps/manager`
- changing review-player behavior beyond its natural vertical position

## Implementation Plan

### Unit 1: Add Red coverage for the error-log render contract

Red:

- Add `apps/manager/src/features/jobs/job-error-log-section.test.ts`.
- Follow the existing `renderToStaticMarkup` pattern from
  `apps/manager/src/features/coverage/coverage-empty-state.test.ts` so the test
  works under the repo's Node-only Manager Vitest setup.
- Write failing tests that assert:
  - zero errors render no markup and do not include `No errors recorded`
  - one logged error renders `id="error-log"`, `Error Log`, the count, the error
    message, the optional code, and the operator hint

Green:

- Add `apps/manager/src/features/jobs/job-error-log-section.tsx`.
- Move the existing error-card markup and date formatting from
  `apps/manager/src/features/jobs/live-job-detail-screen.tsx` into this
  component.
- Return `null` for an empty `errors` array.

Refactor:

- Keep CSS class names unchanged so no styling update is needed.
- Keep `formatStepName(...)` as the step-label formatter.
- Do not add a second visibility helper unless the component starts doing more
  than this one rule.

### Unit 2: Wire the live job detail screen to the component

Red:

- The Unit 1 render test should still fail until `LiveJobDetailScreen` imports
  the real component or the component exists.
- If implementation confidence is low, add a small presenter test for a helper
  such as `shouldShowJobErrorLog(errors)`, but prefer the render test first.

Green:

- Update `apps/manager/src/features/jobs/live-job-detail-screen.tsx` to render:

```tsx
<JobErrorLogSection errors={job.errors} />
```

- Leave it in the same location between `LiveJobStepsTable` and
  `ReviewPlayerCard`.
- Remove the inline `No errors recorded.` branch.
- Keep `LiveJobDetailHeader` unchanged because it already gates the `Error log`
  link on `job.errors.length > 0`.

Refactor:

- Remove unused imports from `live-job-detail-screen.tsx`.
- Keep the review context loading and polling dependencies unchanged.

### Unit 3: Validate live-state and layout behavior

Red:

- No additional app-code unit test is required unless the implementation
  introduces a separate state helper. The visibility rule derives from the
  current `job` state, so React re-rendering should handle live updates.

Green:

- Confirm the screen passes `job.errors`, not `initialJob.errors`, so a later
  `onJobUpdate` from `LiveJobStepsTable` can reveal the card if errors are
  appended.
- Confirm the review player remains after the error-log component in JSX order.
  When the component returns `null`, the review player naturally moves up.

## Acceptance Criteria

- [x] A job detail page with `job.errors.length === 0` does not render
      `Error Log`.
- [x] A job detail page with `job.errors.length === 0` does not render
      `No errors recorded.`
- [x] A job detail page with one or more errors renders the existing error card
      and table.
- [x] The `#error-log` anchor exists only when the body error section exists.
- [x] The existing header `Error log` link remains visible only when errors
      exist.
- [x] The review player remains below the error card when errors exist and
      directly below the steps table when the error card is absent.
- [x] Red/Green TDD evidence is captured in implementation notes.
- [x] User smoke test evidence is captured before PR.

## Work Notes

- Red: `pnpm --filter @forge/manager test -- src/features/jobs/job-error-log-section.test.ts`
  failed because `@/features/jobs/job-error-log-section` did not exist.
- Green: added `JobErrorLogSection`, wired `LiveJobDetailScreen` to pass
  current `job.errors`, and reran the targeted test successfully.
- Full Manager tests passed: `pnpm --filter @forge/manager test`.
- Typecheck passed: `pnpm --filter @forge/manager typecheck`.
- Lint passed after a Prettier-only section-tag wrap:
  `pnpm --filter @forge/manager lint`.
- User-like browser smoke used a temporary uncommitted Next route under
  `/login/job-error-log-smoke` because the local authenticated job-detail route
  required a running CMS at `localhost:1337` and a Manager-role session. The
  route rendered the real `JobErrorLogSection` with app CSS, proved the clean
  state omits the error card and `No errors recorded.`, and proved the
  error-present state renders the table and count. The temporary route was
  deleted before commit. Screenshot proof:
  `/tmp/forge-job-error-log-smoke.png`.

## User Smoke Test

Use real manager job detail pages, not only unit tests.

1. Start or reuse the local Manager app at `http://localhost:3002`.
2. Open a clean job detail page where `job.errors.length === 0`.
3. Confirm the summary/header still renders and has no `Error log` anchor link.
4. Confirm the body does not show `Error Log` or `No errors recorded.`
5. Confirm the review player appears directly after the steps table.
6. Open a job detail page with at least one logged error.
7. Confirm the summary/header shows the `Error log` anchor link.
8. Click the `Error log` link and confirm it lands on the existing error table.
9. Confirm the table still shows time, step, code, message, and operator hint.
10. Confirm the review player appears below the error table.

If local data does not include a logged-error job, create or run a job that
fails naturally and document the job ID used. Do not add committed fixture-only
routes or fake production states for this smoke.

## Verification

Run the red test first and confirm it fails before the green implementation:

```bash
pnpm --filter @forge/manager test -- src/features/jobs/job-error-log-section.test.ts
```

After implementation:

```bash
pnpm --filter @forge/manager test -- src/features/jobs/job-error-log-section.test.ts
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
git diff --check
```

Before PR, run broader Manager tests if time allows:

```bash
pnpm --filter @forge/manager test
```

## Branch and PR Notes

- Current branch: `fix/manager-job-detail-error-log-visibility`
- PR target: `main`
- Suggested PR title: `fix(manager): hide empty job error log`
- Do not skip hooks with `--no-verify`.
- Keep this PR scoped to Manager job detail UI plus plan/compound docs.
- Attach this work to the in-progress `feat-031` umbrella and cite completed
  `feat-082` as placement context. No roadmap status change is needed for this
  planning pass.

## Research Notes

Local repo findings:

- `apps/manager/src/features/jobs/live-job-detail-screen.tsx` always renders
  the error section and currently owns the `No errors recorded.` branch.
- `apps/manager/src/features/jobs/live-job-detail-header.tsx` already hides the
  `Error log` anchor when `job.errors.length === 0`.
- `apps/manager/src/lib/state.ts` appends durable job errors only when a step
  update includes an error string.
- `apps/manager/vitest.config.ts` uses a Node test environment and includes
  only `src/**/*.test.ts`.
- `apps/manager/src/features/coverage/coverage-empty-state.test.ts` proves a
  pure `.tsx` component can be tested with `renderToStaticMarkup` from a
  `.test.ts` file.

Institutional learnings:

- `docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md`
  reinforces separating empty data from true failure state.
- `docs/solutions/integration-issues/manager-transcription-routing-artifact-boundary-20260412.md`
  reinforces gating operator detail panels by durable read-model state.
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
  reinforces keeping job detail aligned with the shared job read model.
- `docs/solutions/ui-bugs/manager-review-player-before-after-toggle-buttons-2026-04-12.md`
  reinforces avoiding extra semantics or layout machinery when plain UI is
  enough.

The expected `docs/solutions/patterns/critical-patterns.md` file was not present
in this checkout, so no critical-pattern entry was applied.

External research was skipped because the repo has strong local patterns and
this is a narrow internal UI visibility fix.

## SpecFlow Notes

User flows to preserve:

- Clean job: header and steps render, error block is absent, review player moves
  up.
- Job with logged errors: header link and body error card render together,
  existing table remains intact.
- Live update: if polling appends an error, the component should appear on the
  next render because visibility uses current `job.errors`.

Default assumptions:

- `job.errors` remains the source of truth.
- A failed job with no logged errors does not get a synthetic fallback error
  block in this fix.
- Hiding the block changes vertical spacing only; it should not change review
  player state, controls, or review-context loading.

## Open Questions

No blockers. If implementation uncovers failed jobs with no `job.errors`
entries, create a follow-up for error-recording correctness instead of widening
this UI fix.
