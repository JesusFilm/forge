---
id: "feat-081"
title: "Cleaned Audio Review Links On Manager Job Detail"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-12"
duration: 5
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "audio"
---

## Problem

Managers can inspect transcripts, subtitles, metadata, and several sync outcomes from job details, but they cannot listen to the output of audio noise cleaning from the normal job detail flow. That makes audio QA slower and pushes operators into external tools when they should be able to review the cleaned result against the original track inside manager.

## Entry Points — Read These First

1. `apps/manager/src/workflows/videoEnrichment.ts` — current enrichment orchestration, step execution, and artifact persistence flow.
2. `apps/manager/src/types/job.ts` — `WorkflowStepName`, artifact manifest shape, and step state contract.
3. `apps/manager/src/lib/workflow-steps.ts` — initial manager step list.
4. `apps/manager/src/lib/job-artifacts.ts` — artifact descriptors, step-to-artifact mapping, and protected href builder.
5. `apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts` — artifact-serving route and auth boundary.
6. `apps/manager/src/features/jobs/live-job-detail-header.tsx` — current summary/header surface for job details.
7. `apps/manager/src/features/jobs/live-job-steps-table.tsx` — current step artifact rendering and job detail table patterns.
8. `apps/manager/src/config/env.ts` — validated env boundary for new external provider secrets.
9. `docs/plans/2026-04-02-fix-manager-job-artifact-links-plan.md` — canonical artifact-link contract precedent.
10. `docs/brainstorms/2026-04-12-manager-cleaned-audio-review-links-requirements.md` — v1 decisions and scope boundaries.

## Grep These

- `persistMergedArtifacts|buildDownloadableArtifactManifest` in `apps/manager/src/`
- `WorkflowStepName|buildInitialSteps` in `apps/manager/src/`
- `resolveJobArtifactDescriptor|getArtifactsForStep` in `apps/manager/src/`
- `jobs-step-artifact|Watch on Mux|jobs-detail` in `apps/manager/src/`
- `writeArtifact|readArtifact` in `apps/manager/src/services/`

## What To Build

1. Add a manager-side audio cleanup integration that calls ElevenLabs voice isolation after the core enrichment path has produced the main job artifacts.
2. Persist two downloadable job artifacts for review: `original-audio` and `cleaned-audio`.
3. Extend the artifact contract so both audio artifacts stream correctly through the existing protected artifact route.
4. Expose labeled `Original audio` and `Cleaned audio` review links from the manager job detail UI.
5. Keep v1 artifact-only and manager-only: no CMS sync, no content-model writeback, no public playback usage.
6. Add focused automated tests plus a real user smoke test on a completed job detail page.

## Constraints

- Do not add CMS content types or GraphQL schema changes in this slice.
- Do not build a compare card, waveform editor, or approval flow.
- Do not switch manager away from its existing auth and artifact-serving model.
- Keep the branch and PR flow aligned with repo conventions: `feat/...` branch naming, PR to `main`, squash merge, and no `--no-verify`.

## Verification

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- Run one manager job that executes audio cleanup and confirm the job detail exposes both labeled review links.
- Open both links from the job detail page and verify the original and cleaned files are playable.
