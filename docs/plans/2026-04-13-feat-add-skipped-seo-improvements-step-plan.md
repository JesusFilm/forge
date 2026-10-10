---
title: "feat: Add skipped SEO improvements step"
type: feat
status: completed
date: 2026-04-13
origin: docs/brainstorms/2026-04-13-manager-seo-improvements-step-brainstorm.md
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
related:
  - docs/roadmap/topic-experiences/feat-002-wire-enrichment-metadata-to-cms.md
  - docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md
  - docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md
  - docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md
  - docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
  - docs/solutions/integration-issues/manager-transcription-routing-artifact-boundary-20260412.md
  - .context/compound-engineering/todos/019-pending-p2-remove-legacy-cms-notify-ui-and-step.md
---

# feat: Add skipped SEO improvements step

## Overview

Add `SEO Improvements` as the final persisted step in the manager enrichment
workflow. In this first slice, the step is intentionally a placeholder: it
does not perform SEO work, does not write artifacts, does not mutate generated
metadata, and does not sync anything to CMS.

The purpose is workflow truthfulness. Operators should see that SEO is a known
future phase, but the UI must also make clear that no SEO action ran. The step
therefore ends as `skipped`, using the existing manager step-status vocabulary.

## Found Brainstorm

Found brainstorm from 2026-04-13:
[docs/brainstorms/2026-04-13-manager-seo-improvements-step-brainstorm.md](/Users/o/.codex/worktrees/b727/forge/docs/brainstorms/2026-04-13-manager-seo-improvements-step-brainstorm.md).
Using it as context for planning.

Key decisions from the brainstorm:

- make SEO a real persisted workflow step, not a UI-only synthetic row
- place it at the end of the manager enrichment workflow
- mark it `skipped` for v1
- do not create an SEO artifact, CMS sync report, metadata mutation, or new
  service yet
- treat this as a future SEO hook, not as a replacement for the existing
  `metadata` step

## Research Decision

Local repo context is strong and the feature is a small internal workflow/UI
placeholder. External web research is not needed.

Relevant local findings:

- [apps/manager/src/lib/workflow-steps.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/lib/workflow-steps.ts)
  seeds the persisted job step order through `mux_upload`.
- [apps/manager/src/lib/state.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/lib/state.ts)
  uses that seed for new jobs, and the transcription rerun route resets jobs
  through the same builder.
- [apps/manager/src/workflows/videoEnrichment.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/workflows/videoEnrichment.ts)
  runs a hardcoded workflow chain and marks the job complete after `mux_upload`
  and optional scene analysis.
- [apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/types/job.ts)
  already has `StepStatus = "skipped"`, but it has no SEO step name.
- [apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
  already renders skipped step glyphs and maps descriptions/icons by
  `WorkflowStepName`.
- [apps/manager/src/features/jobs/jobs-table-presenter.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/features/jobs/jobs-table-presenter.ts)
  already maps `skipped` to a dash for compact job-list step dots.
- `.context/compound-engineering/todos/019-pending-p2-remove-legacy-cms-notify-ui-and-step.md`
  warns that stale CMS notify vocabulary already confuses operators. This SEO
  placeholder must not repeat that mistake by implying real CMS or SEO writes.

## Repo Workflow Notes

- Current branch: `feat/manager-seo-improvements-step`.
- Roadmap anchor: `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`,
  already `in-progress`.
- Keep the PR manager-scoped. Do not broaden into CMS sync, web SEO, or legacy
  `cms_notify` cleanup unless explicitly requested.
- PR target branch: `main`.
- Suggested PR title: `feat(manager): add skipped SEO improvements step`.
- Use conventional commits and never skip pre-commit hooks with `--no-verify`.
- Before push/PR, run package-local checks plus any format/CI-sensitive checks
  required by the touched scope.

## Product Decisions

- **New step name:** use `seo_improvements` in code and `SEO Improvements` in
  user-facing UI.
- **Step placement:** make it the last persisted workflow step, after
  `mux_upload`.
- **Step status:** set it to `skipped` during successful workflow completion.
- **No migration:** existing completed jobs do not need backfill. New jobs and
  reruns after this change will show the step.
- **No `currentStep` handoff:** do not mark SEO as running and do not set
  `currentStep` to `seo_improvements`. The step performs no work, so the
  workflow should write the skipped status and then complete the job.
- **No timestamp behavior change:** leave the skipped row duration as `-` for
  v1. Do not change `updateStepStatus` to stamp `finishedAt` for all skipped
  steps unless a later UX requirement asks for it.
- **No details panel:** render it as a normal static skipped row with no
  expandable detail content.

## SpecFlow Validation

The feature has three operator-visible flows:

1. A new enrichment job is created from the shared persisted step seed and
   later renders the final SEO row in job list/detail views.
2. A transcription rerun resets an existing job through the same seed and keeps
   SEO as the final pending step.
3. A completed job detail view shows `SEO Improvements` as skipped, matching
   persisted job state rather than a synthetic UI-only row.

SpecFlow gaps were resolved with these defaults:

- skipped SEO rows remain durationless for v1
- the workflow does not set `currentStep` to `seo_improvements`
- existing completed jobs are not migrated or backfilled
- the UI label should be hard-coded as `SEO Improvements` rather than relying
  on generic title casing
- the row stays static with no details panel or actions

## Proposed Solution

Add the SEO placeholder through the same persisted step model the manager
already uses.

1. Extend `WorkflowStepName` with `seo_improvements`.
2. Add `seo_improvements` as the final entry in the shared initial step seed.
3. Preserve acronym casing by teaching the display formatter to render
   `SEO Improvements`.
4. Add a step-table description and icon for `seo_improvements`.
5. In `runVideoEnrichment`, after `mux_upload` succeeds and after optional
   scene analysis completes or is error-isolated, mark `seo_improvements` as
   `skipped` before marking the whole job completed.
6. Do not add a service file, environment variable, CMS write path, artifact
   manifest entry, or UI action.

Suggested copy:

```ts
seo_improvements: "Future SEO optimization phase. No SEO actions run in this version."
```

## Red / Green TDD Plan

### Unit 1: Step Contract and Seed

**Goal:** New jobs and reruns both receive the same final SEO step.

**Red**

- Update [apps/manager/src/lib/workflow-steps.test.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/lib/workflow-steps.test.ts)
  to expect exact step order:
  `transcription`, `translation`, `chapters`, `metadata`, `embeddings`,
  `mux_upload`, `seo_improvements`.
- Add a formatter expectation: `formatStepName("seo_improvements")` returns
  `SEO Improvements`.
- Update [apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.test.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.test.ts)
  so rerun reset expectations include the final pending `seo_improvements`
  step.

These tests should fail first because the step does not exist yet.

**Green**

- Add `seo_improvements` to `WorkflowStepName` in
  [apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/types/job.ts).
- Add `seo_improvements` as the final `FORGE_STEPS` entry in
  [apps/manager/src/lib/workflow-steps.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/lib/workflow-steps.ts).
- Add the display special case for `SEO Improvements`.

**Refactor**

- Keep the step seed in one place. Do not create a separate UI-only step list.

### Unit 2: Workflow Completion Writes a Skipped Step

**Goal:** Successful workflows record the SEO placeholder as intentionally
skipped before job completion.

**Red**

- Extend success-path tests in
  [apps/manager/src/workflows/videoEnrichment.test.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/workflows/videoEnrichment.test.ts)
  to expect:
  - `updateStepStatus(jobId, "seo_improvements", "skipped")`
  - no call that marks `seo_improvements` as `running`
  - the skipped call happens before the final
    `updateJob(..., { status: "completed", currentStep: undefined, completedAt: ... })`
- Add a failure-path assertion that if a core step fails before completion,
  `seo_improvements` is not marked skipped.

These tests should fail first because the workflow currently completes after
`mux_upload`/scene-analysis handling without touching SEO.

**Green**

- Add a small helper such as `markStepSkipped(jobId, step)` if it keeps the
  workflow readable, or call
  `updateStepStatus(input.jobId, "seo_improvements", "skipped")` directly.
- Place the skipped write after the optional scene-analysis block and before
  the final job-complete update.
- Do not call `markStepRunning` for this dummy step.

**Refactor**

- Keep the helper narrow. Do not introduce a generic step registry or service
  layer for one no-op step.

### Unit 3: UI Metadata and Status Rendering

**Goal:** Manager list/detail UI renders the persisted SEO step truthfully.

**Red**

- Add a focused presenter/formatting test, preferably in
  [apps/manager/src/lib/workflow-steps.test.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/lib/workflow-steps.test.ts)
  or [apps/manager/src/features/jobs/jobs-table-presenter.test.ts](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/features/jobs/jobs-table-presenter.test.ts),
  proving skipped still maps to the compact dash and `seo_improvements` formats
  as `SEO Improvements`.
- Rely on TypeScript to force `STEP_DESCRIPTION_BY_NAME` coverage for the new
  union member in
  [apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/b727/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx).

**Green**

- Add `seo_improvements` to `STEP_DESCRIPTION_BY_NAME`.
- Add an icon branch for `seo_improvements`, using the existing
  `lucide-react` pattern. Prefer a simple `Search` icon or another existing
  semantically close icon without introducing new colors.

**Refactor**

- Do not add an expandable detail panel, action button, or artifact link for
  SEO in this slice.

## User Smoke Test

The implementation is not complete until a human-visible smoke test has been
performed or explicitly documented as blocked.

1. Start the manager app locally, following the existing manager setup:
   `pnpm --filter @forge/manager dev`.
2. Create a fresh enrichment job against a local/test asset.
3. Let it complete.
4. Open the job list and job detail page.
5. Confirm the final step row is labeled `SEO Improvements`.
6. Confirm the status is shown as skipped, not completed, failed, running, or
   pending.
7. Confirm the row has no artifact link or action panel.
8. Rerun transcription for the job and confirm the reset job still includes
   `SEO Improvements` as the final step.
9. Confirm the rerun completes with the SEO step skipped again.

If local CMS/Manager prerequisites block the smoke test, document the blocker
in the PR and include automated test output instead.

## Acceptance Criteria

- [x] `seo_improvements` is part of the persisted manager workflow step union.
- [x] New jobs seed `seo_improvements` as the final pending step.
- [x] Transcription reruns reset jobs with `seo_improvements` as the final
      pending step.
- [x] Successful enrichment marks `seo_improvements` as `skipped` before job
      completion.
- [x] Failed enrichment paths do not mark SEO skipped after an earlier core
      failure.
- [x] Job detail UI renders the final row as `SEO Improvements`.
- [x] Job list/detail UI uses the existing skipped status treatment.
- [x] No SEO artifact, CMS sync report, metadata mutation, environment
      variable, or new service is introduced.
- [x] Existing jobs are not migrated or backfilled.
- [x] Red/Green TDD evidence is captured in the implementation notes or PR.
- [x] User smoke test is completed or a concrete blocker is documented.

## Implementation Notes

Red/Green TDD evidence:

- Red focused test run failed as expected before implementation:
  `pnpm --filter @forge/manager test -- src/lib/workflow-steps.test.ts 'src/app/api/jobs/[id]/transcription/rerun/route.test.ts' src/workflows/videoEnrichment.test.ts src/features/jobs/jobs-table-presenter.test.ts`
  failed on the missing final `seo_improvements` seed, missing `SEO`
  formatter casing, missing rerun reset step, and missing skipped workflow
  status write.
- Green focused test run passed after implementation with 26 tests passing.
- Full manager test suite passed with 302 tests passing.
- Manager typecheck and lint passed.

User smoke evidence:

- Started the real manager Next dev server on `http://localhost:3002` with a
  local Strapi-shaped mock on `http://localhost:4888`.
- Drove the real browser login flow, opened the Jobs list, and opened the
  mocked completed job detail page.
- Captured screenshots:
  - [output/manager-seo-smoke-jobs.png](/Users/o/.codex/worktrees/b727/forge/output/manager-seo-smoke-jobs.png)
  - [output/manager-seo-smoke-detail.png](/Users/o/.codex/worktrees/b727/forge/output/manager-seo-smoke-detail.png)
- Browser snapshot confirmed the final detail row renders:
  `SEO Improvements Future SEO optimization phase. No SEO actions run in this version.`
  with duration `–`, artifacts `-`, and status `skipped`.

The smoke test used mocked Strapi data rather than creating a real Mux/CMS
enrichment job. Live create/rerun execution depends on local CMS, Manager role
credentials, and external media/Mux prerequisites. The skipped workflow write
and rerun reset paths are covered by automated tests.

## Verification Commands

Run focused tests first:

```bash
pnpm --filter @forge/manager test -- src/lib/workflow-steps.test.ts 'src/app/api/jobs/[id]/transcription/rerun/route.test.ts' src/workflows/videoEnrichment.test.ts src/features/jobs/jobs-table-presenter.test.ts
```

Then run the manager quality gates:

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
```

Before PR, also run any root-level format/CI-sensitive validation the repo
requires for touched files.

## Risks and Mitigations

- **Risk:** Operators read the placeholder as completed SEO work.
  **Mitigation:** Mark it `skipped`, not `completed`; use copy that says no SEO
  actions run in this version.
- **Risk:** UI diverges from persisted job truth.
  **Mitigation:** Add the step to the shared seed and workflow state, not as a
  synthetic row.
- **Risk:** The new step deepens stale CMS-write confusion.
  **Mitigation:** Do not reuse `cms_notify`; do not write CMS data; keep the
  existing pending CMS notify cleanup out of this scope unless explicitly
  requested.
- **Risk:** Acronym formatting becomes `Seo Improvements`.
  **Mitigation:** Add a formatter special case and a test for it.
- **Risk:** The scope expands into real SEO generation.
  **Mitigation:** This plan is only the placeholder step. Create a new roadmap
  ticket before adding real SEO actions.

## Out of Scope

- Real SEO title/description generation
- Web app SEO metadata changes
- CMS schema, CMS sync, GraphQL codegen, or Strapi mutations
- Artifact contract changes
- Backfill or migration for historical jobs
- Removing stale `cms_notify` UI/type vocabulary
- New service clients, environment variables, or Railway settings

## References

- Origin brainstorm:
  [docs/brainstorms/2026-04-13-manager-seo-improvements-step-brainstorm.md](/Users/o/.codex/worktrees/b727/forge/docs/brainstorms/2026-04-13-manager-seo-improvements-step-brainstorm.md)
- Roadmap anchor:
  [docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md](/Users/o/.codex/worktrees/b727/forge/docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- Manager agent guide:
  [apps/manager/AGENTS.md](/Users/o/.codex/worktrees/b727/forge/apps/manager/AGENTS.md)
- CMS sync non-goal context:
  [docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md](/Users/o/.codex/worktrees/b727/forge/docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md)
- Additive metadata/embedding precedent:
  [docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md](/Users/o/.codex/worktrees/b727/forge/docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md)
- Stale CMS notify todo:
  [.context/compound-engineering/todos/019-pending-p2-remove-legacy-cms-notify-ui-and-step.md](/Users/o/.codex/worktrees/b727/forge/.context/compound-engineering/todos/019-pending-p2-remove-legacy-cms-notify-ui-and-step.md)
