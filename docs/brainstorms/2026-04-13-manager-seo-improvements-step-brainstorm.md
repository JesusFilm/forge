---
date: 2026-04-13
topic: manager-seo-improvements-step
related:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/topic-experiences/feat-002-wire-enrichment-metadata-to-cms.md
  - docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md
  - docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md
  - docs/brainstorms/2026-04-12-job-detail-enrichment-review-player-brainstorm.md
  - docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md
---

# Manager SEO Improvements Step

## What We're Building

Add an SEO improvements step to the end of the manager enrichment job workflow.
For this first slice, the step is intentionally a placeholder: it performs no
SEO actions, writes no new artifact, and does not change generated metadata or
CMS state. It exists so operators can see the future SEO phase in the workflow
without believing SEO work has run.

The UI should display the step as skipped. This should read as an intentional
no-op, not as a failure, missing artifact, or hidden pending task. The step
should appear after the current workflow tail so the job still communicates the
core enrichment lifecycle first, then the future SEO hook at the end.

## Why This Approach

The recommended approach is to make SEO a real persisted workflow step and mark
it skipped, rather than rendering a synthetic UI-only row. The manager already
drives job detail UI from persisted `JobRecord.steps`, and `StepStatus` already
includes `skipped`; using that model keeps list views, detail views, polling,
and rerun behavior aligned.

We considered a UI-only placeholder row, but that would make the visible
workflow diverge from persisted job state. We also considered adding a step
registry with explicit active/no-op modes, but that is more abstraction than one
dummy step needs. The simplest honest design is a durable final step that is
intentionally skipped until real SEO behavior is planned.

## Key Decisions

- Persisted step, not decoration: the SEO step should live in the same job step
  model as transcription, translation, chapters, metadata, embeddings, and Mux
  upload.
- Final placement: SEO improvements belongs after the current workflow tail so
  it reads as a future post-enrichment phase.
- Skipped status for v1: the placeholder should be marked `skipped` in the UI
  instead of `completed`, because no SEO action has been performed.
- No artifact contract yet: do not create an SEO artifact, CMS sync report, or
  metadata mutation until the actual SEO scope exists.
- Do not duplicate metadata extraction: the placeholder should not imply the
  existing `metadata` step is doing SEO optimization.
- Keep the implementation slice narrow: use the existing step/status display
  patterns and avoid a new step registry unless planning uncovers more
  placeholder steps.

## Planning Notes

- `apps/manager/src/lib/workflow-steps.ts` seeds the persisted step order; a
  real SEO step belongs there so newly created jobs include it.
- Transcription rerun resets jobs using the same initial-step builder, so the
  placeholder should survive reruns automatically if it uses the shared seed.
- `apps/manager/src/types/job.ts` will need a new workflow step name for SEO,
  with matching description/icon metadata in the job detail step table.
- `apps/manager/src/lib/state.ts` currently stamps `finishedAt` for completed
  and failed steps, not skipped ones. Planning should decide whether the dummy
  skipped step should remain durationless or whether skipped should count as a
  terminal timestamped state.
- Existing Compound docs point to `feat-031` as the roadmap anchor for
  additional manager enrichment steps. If real SEO generation expands beyond
  this placeholder later, create a dedicated roadmap ticket before that work.

## Resolved Questions

- The first version is a dummy step with no actions.
- The UI should indicate the step was skipped.
- The step should be at the end of the manager job workflow.
- The step should be treated as a future SEO hook, not as a replacement for the
  existing metadata step.

## Open Questions

No product-level blockers remain for planning. The skipped-step timestamp choice
is a small implementation decision for the plan.

## Next Steps

Proceed to planning with the persisted-final-step approach. The implementation
plan should keep the placeholder additive, verify job creation and rerun step
ordering, and confirm skipped SEO renders consistently in job list and job
detail UI.
