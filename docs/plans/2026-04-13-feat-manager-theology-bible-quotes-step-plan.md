---
title: "feat: Add manager theology Bible quotes placeholder step"
type: feat
status: active
date: 2026-04-13
origin: docs/brainstorms/2026-04-12-manager-theology-bible-quotes-step-brainstorm.md
related:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/platform/feat-067-doctrinal-validation-engine.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
  - docs/solutions/platform/multimodal-scene-analysis-pipeline.md
  - docs/solutions/platform/restoring-upstream-ui-verbatim.md
---

# feat: Add manager theology Bible quotes placeholder step

## Overview

Add one combined final Manager enrichment workflow step for Theology Validation
and Bible Quotes generation. In this first pass, the step is a no-op
placeholder: it must be visible in the Manager job UI as `skipped`, but it must
not call external services, produce artifacts, introduce environment variables,
or write generated content back to CMS.

This is intentionally a new-jobs-only change. Existing enrichment jobs do not
need a migration or read-time backfill for this placeholder.

## Found Brainstorm

Found brainstorm from 2026-04-12:
`docs/brainstorms/2026-04-12-manager-theology-bible-quotes-step-brainstorm.md`.
Using it as context for planning.

Key decisions already made:

- add one combined step, not two separate placeholders
- show the step as `skipped`, not `pending` or `completed`
- keep runtime behavior unchanged
- add the visible step after `mux_upload`
- treat `feat-031` as the closest roadmap context
- keep future real doctrinal validation and Bible quote generation outside v1

## Research Decision

Local repo context is strong and the feature is a small internal workflow/UI
contract change. External research is not needed.

Relevant local guidance:

- `AGENTS.md` requires the `ce:plan -> ce:work -> ce:review -> ce:compound`
  loop and PR-focused validation, including format/CI-sensitive checks.
- `CLAUDE.md` requires conventional commits, branch names like
  `feat/description`, PRs targeting `main`, and never skipping pre-commit hooks.
- `apps/manager/AGENTS.md` identifies `src/workflows/videoEnrichment.ts` as the
  main pipeline and reminds agents to keep workflow steps idempotent.
- `packages/graphql/AGENTS.md` says not to hand-edit generated GraphQL outputs
  and to regenerate when CMS schema changes.

Current branch is already `feat/manager-theology-bible-quotes-step`, which
matches the repo branch naming convention.

PR hygiene for the implementation pass:

- target `main`
- use a conventional PR title such as
  `feat(manager): add theology validation bible quotes step`
- before opening a PR, follow `.claude/commands/pr.md` and check recent PR title
  conventions with `gh pr list --state all --limit 20`
- never skip hooks with `--no-verify`
- keep the PR scoped to Manager, CMS enum contract, generated GraphQL outputs,
  and this plan unless implementation reveals a required adjacent fix

## Current State

The Manager job step model already supports the desired status:

- `apps/manager/src/types/job.ts` defines `StepStatus` and already includes
  `skipped`.
- `apps/cms/src/components/enrichment/job-step.json` already includes
  `skipped` in the step status enum.

The step name is not yet part of the contract:

- `apps/manager/src/types/job.ts` defines `WorkflowStepName` without a theology
  or Bible quotes value.
- `apps/cms/src/components/enrichment/job-step.json` limits persisted step names
  to `transcription`, `translation`, `chapters`, `metadata`, `embeddings`, and
  `mux_upload`.
- `packages/graphql/src/graphql-env.d.ts` and `apps/cms/schema.graphql` reflect
  the current CMS enum and should be regenerated, not hand-edited, after the CMS
  schema change.

The UI already knows how to display skipped steps:

- `apps/manager/src/features/jobs/live-job-steps-table.tsx` renders skipped
  status icons and has an exhaustive `STEP_DESCRIPTION_BY_NAME` map.
- `apps/manager/src/features/jobs/jobs-table-presenter.ts` maps skipped status
  to the existing list-dot presentation.
- `apps/manager/src/app/globals.css` already has skipped status styling.

The workflow currently completes core enrichment through `mux_upload`, then may
run optional scene analysis outside the persisted step list. This placeholder
should not become a new service, artifact, or failure mode.

## SpecFlow Analysis

### User Flows

1. Operator starts a new enrichment job from Manager. The job is created with
   the existing core steps plus the final combined placeholder step. The job
   proceeds through the existing core workflow and the final placeholder is
   visible as skipped.
2. Operator opens a newly created job detail page while the job is running or
   after completion. The steps table shows the new final row after Mux Upload
   with skipped status and an explanatory description.
3. Operator opens an older job created before this change. The job renders from
   its persisted `steps` array and does not require a synthetic placeholder row.
4. Developer runs the enrichment workflow tests. The placeholder does not
   introduce external calls, artifact writes, env vars, or job failure behavior.

### Gaps and Defaults

- No product blocker remains around one step versus two; use one combined
  internal step name, likely `theology_validation_bible_quotes`.
- Do not change existing job rendering. The established pattern is to render
  persisted `job.steps[]`, so historical jobs can omit the placeholder.
- Prefer initializing the placeholder as `skipped` in `buildInitialSteps()` over
  adding a fake runtime mark-complete phase. This keeps the no-op honest and
  avoids implying elapsed work.
- If a skipped step has no `startedAt` or `finishedAt`, keep the existing
  duration display behavior (`-`) rather than changing `updateStepStatus()`.

## Proposed Solution

Add the placeholder as a real persisted workflow step name, but keep its status
and behavior intentionally inert.

1. Add `theology_validation_bible_quotes` to `WorkflowStepName` in
   `apps/manager/src/types/job.ts`.
2. Add the same value to the CMS job-step `name` enum in
   `apps/cms/src/components/enrichment/job-step.json`.
3. Update `apps/manager/src/lib/workflow-steps.ts` so `buildInitialSteps()`
   appends the new step after `mux_upload` with `status: "skipped"` and
   `retries: 0`.
4. Add a description for the new step in
   `apps/manager/src/features/jobs/live-job-steps-table.tsx`, for example:
   "Planned theology validation and Bible Quotes generation; skipped for now."
5. Avoid adding service files, workflow execution calls, env vars, artifacts, or
   downstream CMS content writes.
6. Regenerate GraphQL outputs after the CMS schema update with the repo's
   documented command rather than editing generated files by hand.

## Red/Green TDD Plan

Start with failing tests before implementation:

1. Update `apps/manager/src/lib/workflow-steps.test.ts` to assert:
   - the final step name is `theology_validation_bible_quotes`
   - its status is `skipped`
   - its `retries` value is `0`
   - `mux_upload` remains immediately before it
2. Add or update a workflow-level test in
   `apps/manager/src/workflows/videoEnrichment.test.ts` to prove the happy path
   still completes without a theology/Bible-quote service call or artifact
   mutation. If implementation only initializes the skipped step, this can focus
   on job step state and no new workflow action.
3. Add UI coverage if a lightweight existing render test pattern is available
   for `LiveJobStepsTable`; otherwise rely on TypeScript exhaustiveness for
   `STEP_DESCRIPTION_BY_NAME` plus the user smoke test below.

Then make the minimal implementation changes until the tests pass.

## Acceptance Criteria

- [ ] New enrichment jobs persist a final step named
  `theology_validation_bible_quotes` after `mux_upload`.
- [ ] The new step is shown as `skipped` in Manager job UI.
- [ ] The step is one combined placeholder for Theology Validation and Bible
  Quotes generation, not two separate steps.
- [ ] Existing jobs are not backfilled and continue rendering from their
  persisted `steps` arrays.
- [ ] No external calls, service clients, env vars, artifacts, or content writes
  are added for the placeholder.
- [ ] CMS `enrichment.job-step` accepts the new step name.
- [ ] Generated GraphQL schema/types are regenerated if the CMS schema change
  affects generated outputs.
- [ ] Red/green tests cover initial step order/status and workflow no-op
  behavior.
- [ ] A user smoke test confirms the final skipped row appears in a newly
  created job detail page.

## Implementation Tasks

- [ ] Red: update `apps/manager/src/lib/workflow-steps.test.ts` for final
  skipped step order and state.
- [ ] Red: update `apps/manager/src/workflows/videoEnrichment.test.ts` for
  no-op workflow behavior or persisted skipped step expectations.
- [ ] Green: update `apps/manager/src/types/job.ts` with the new
  `WorkflowStepName`.
- [ ] Green: update `apps/cms/src/components/enrichment/job-step.json` with the
  new enum value.
- [ ] Green: update `apps/manager/src/lib/workflow-steps.ts` to append the
  skipped placeholder for new jobs.
- [ ] Green: update `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  with the new description.
- [ ] Regenerate GraphQL outputs via
  `pnpm turbo run generate --filter=@forge/graphql`.
- [ ] Run targeted tests and PR validation.
- [ ] Run the user smoke test locally.

## Verification

Automated checks:

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
pnpm turbo run generate --filter=@forge/graphql
pnpm format:check
git diff --check
```

If generated GraphQL output changes, review it for the CMS enum update only. If
codegen cannot run because the required local CMS/schema source is unavailable,
document the blocker in the work notes and do not hand-edit generated GraphQL
outputs.

User smoke test:

1. Start the local CMS and Manager dev servers using the repo's normal local dev
   flow.
2. Create or trigger a new Manager enrichment job.
3. Open the job detail page in Manager.
4. Confirm the final step appears after Mux Upload as "Theology Validation Bible
   Quotes" or equivalent formatting.
5. Confirm the final step is marked skipped.
6. Confirm the job still succeeds or fails based only on existing core workflow
   steps.
7. Confirm there are no new artifacts, content writes, or required env vars for
   this placeholder.

## Risks

- CMS enum changes can fail at runtime if GraphQL generated outputs are stale.
  Mitigation: regenerate `@forge/graphql` outputs in the same work item.
- Updating `updateStepStatus()` for skipped steps could unintentionally change
  duration semantics across existing workflows. Mitigation: initialize this
  placeholder as skipped and leave duration behavior unchanged.
- Adding a fake workflow action would make the UI imply work happened.
  Mitigation: keep the step no-op and avoid new service/artifact code.
- Coverage/dashboard surfaces may have their own step lists. Mitigation: grep
  for `FORGE_STEPS` and only update additional surfaces if they intentionally
  mirror persisted Manager workflow steps.

## Out of Scope

- Real theology validation logic
- Real Bible Quotes generation
- LLM prompts or OpenRouter calls
- New artifacts or storage keys
- New environment variables
- CMS video/content updates
- Historical job migration or read-time backfill
- Operator override/retry UI for this placeholder

## References

- `docs/brainstorms/2026-04-12-manager-theology-bible-quotes-step-brainstorm.md`
- `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
- `docs/roadmap/platform/feat-067-doctrinal-validation-engine.md`
- `docs/solutions/cms/strapi-enrichment-job-content-type.md`
- `docs/solutions/platform/multimodal-scene-analysis-pipeline.md`
- `docs/solutions/platform/restoring-upstream-ui-verbatim.md`
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`
