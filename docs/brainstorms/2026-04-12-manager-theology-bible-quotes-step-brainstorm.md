---
date: 2026-04-12
topic: manager-theology-bible-quotes-step
related:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/platform/feat-067-doctrinal-validation-engine.md
  - docs/roadmap/topic-experiences/feat-061-watch-platform-upgrade-bible-verse-visuals.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
  - docs/solutions/platform/multimodal-scene-analysis-pipeline.md
---

# Manager Theology Validation and Bible Quotes Step

## What We're Building

Add a final visible step to the Manager enrichment job workflow for Theology
Validation and Bible Quotes generation. In this first pass, the step is a
placeholder only: it performs no external calls, produces no artifacts, does
not alter generated content, and is shown in job UI as `skipped`.

The purpose is to make the intended end-state of the enrichment pipeline
visible to operators while keeping runtime behavior unchanged. The core
workflow should continue to succeed or fail based on the existing essential
steps: transcription, translation, chapters, metadata, embeddings, and Mux
upload.

## Why This Approach

We considered three shapes:

- one combined placeholder step at the end of the existing workflow
- two separate placeholders, one for theology validation and one for Bible
  Quotes generation
- no workflow step yet, only a note or placeholder in the job detail UI

The chosen approach is one combined workflow step. The request describes a
single step, and a combined placeholder keeps the UI honest without creating
two fake progress points. It also leaves the broader future work in the right
roadmap homes: doctrinal validation can grow out of `feat-067`, while Bible
Quote output can later connect to verse-oriented content and watch experiences.

## Key Decisions

- Combined final step: use one visible workflow step for Theology Validation
  and Bible Quotes generation rather than splitting it now.
- Skipped by design: the step should be initialized or marked with the existing
  `skipped` status, not `completed`, because no work is being performed yet.
- No-op execution: do not add a service client, model call, env var, artifact
  writer, CMS mutation beyond step-state persistence, or downstream content
  update in this milestone.
- End-of-core placement: show the step after the current Mux Upload step and
  before the job is marked complete, so the visible job timeline ends with the
  future validation/generation intent.
- New jobs first: newly created jobs should include the step in their persisted
  `steps` array. Historical jobs do not need migration for this placeholder.
- Keep optional behavior isolated: this placeholder must not affect the host
  workflow's success or failure state.
- Preserve the Strapi contract: adding a new step name requires updating the
  CMS `enrichment.job-step` enum as well as the Manager `WorkflowStepName`
  union, then regenerating GraphQL types if the schema changes.

## Resolved Questions

- This should be one combined step, based on the singular wording in the
  request.
- The correct UI state for v1 is `skipped`, not `pending` or `completed`.
- The step is a dummy placeholder and should not run real theology validation,
  Bible Quote generation, or artifact persistence yet.
- The closest existing roadmap context is the in-progress AI Video Enrichment
  Pipeline ticket rather than a new standalone roadmap ticket.

## Open Questions

No product-level blockers remain for planning.

## Deferred to Planning

- Choose the internal step name, likely something like
  `theology_validation_bible_quotes`, while keeping the visible label concise.
- Decide whether `updateStepStatus` should stamp `finishedAt` for skipped
  steps or whether the placeholder should be initialized as skipped with no
  duration.
- Update tests around initial step order, workflow step status calls, CMS enum
  compatibility, and job-detail skipped rendering.
- Decide whether a lightweight detail string is needed in the UI, such as
  "Planned future step; skipped for now."

## Next Steps

Proceed to planning against `apps/manager/src/lib/workflow-steps.ts`,
`apps/manager/src/types/job.ts`, `apps/cms/src/components/enrichment/job-step.json`,
`apps/manager/src/workflows/videoEnrichment.ts`, and the manager job step UI.
