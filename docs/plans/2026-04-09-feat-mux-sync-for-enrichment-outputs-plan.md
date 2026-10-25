---
title: "feat: Sync translated subtitles back to Mux"
type: feat
status: completed
date: 2026-04-09
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# feat: Sync translated subtitles back to Mux

## Overview

Add a post-enrichment Mux sync phase that:

- pushes generated translated subtitles into Mux as first-class text tracks when that language is missing on the target asset
- explains in the job details when Forge did not sync because Mux already had a subtitle track for that language
- shows generated subtitle output side by side with the current Mux subtitle track when sync was skipped because data already exists
- allows an operator to override an existing Mux subtitle track with the newly generated subtitle

This plan is intentionally subtitles-only. It does not sync metadata, chapters, embeddings, or any other enrichment artifact back to Mux.

## Problem Frame

Today Forge creates and uses a stage Mux asset, but translated subtitle outputs remain Forge-managed artifacts:

- translated subtitles are written to Forge artifact storage, not to Mux text tracks
- when Mux already has a subtitle track for the same language, Forge does not persist comparison state explaining why sync was skipped
- there is no operator flow to review generated subtitle output against the current Mux subtitle track and intentionally replace it

The product outcome for this work is operational parity between Forge-generated translated subtitles and the Mux asset surface that playback and delivery tooling already reads. In v1, that means:

- translated subtitle tracks become visible in Mux without a second manual upload path
- operators can see exactly why Forge did or did not sync a subtitle track
- operators can intentionally replace an existing Mux subtitle track after review

## Capability Reality

### Current Forge behavior

Relevant current code:

- [mux.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/services/mux.ts)
- [transcription.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/services/transcription.ts)
- [subtitleTranslation/index.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/services/subtitleTranslation/index.ts)
- [storage.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/services/storage.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)

Current behavior:

- Forge creates a Mux asset and may request generated source subtitles
- Forge stores generated subtitle artifacts locally or in Railway S3-compatible storage
- the `mux_upload` workflow step exists in the job vocabulary and UI copy, but this branch does not yet implement a real sync phase for translated subtitles

### Current Mux capability constraints

Current official Mux docs support:

- subtitle tracks as asset text tracks via create-asset input or create-asset-track API
- track inspection on the asset so Forge can determine whether a target language already exists

Sources:

- [Add subtitles/captions to videos | Mux](https://support-agent.mux.com/docs/guides/add-subtitles-to-your-videos)

### Implication

This plan only addresses the one enrichment artifact type that maps cleanly to a first-class Mux Video write target:

- **Subtitles:** true native Mux sync

Everything else stays out of scope for this plan.

## Requirements Trace

- R1. After enrichment completes, Forge must inspect the target Mux asset before attempting any subtitle write.
- R2. Forge must sync translated subtitle tracks into Mux only when the target language is missing on Mux.
- R3. When Mux already has a subtitle track for that language, Forge must skip the write, persist the reason, and expose generated-vs-existing comparison data in the job details.
- R4. Job details must include an explicit operator action to override an existing Mux subtitle track with the newly generated subtitle.
- R5. The subtitle sync decision and comparison result must be durable in job state so the page does not recompute everything ad hoc on each refresh.
- R6. The workflow and UI must distinguish:
  - `synced`
  - `skipped_missing_generated_data`
  - `skipped_existing_mux_data`
  - `override_applied`
  - `failed`
- R7. All new behavior must be added with red/green tests before implementation.

## Scope Boundaries

In scope:

- a real post-enrichment `mux_upload` step for translated subtitles
- Mux asset inspection and subtitle sync decision logic
- durable subtitle sync/comparison state on jobs
- job details UI for explanation, side-by-side subtitle comparison, and subtitle override actions
- translated subtitle sync into Mux text tracks

Out of scope:

- metadata sync of any kind
- chapters sync of any kind
- embeddings sync of any kind
- any generic “sync all enrichment outputs” abstraction
- replacing Forge artifact storage as the system of record
- adopting `@mux/ai` as part of this plan
- CMS write-back or player-side rollout outside the manager job detail flow

## Product Decisions

### 1. Subtitle sync is the only supported artifact type

The job UI and workflow should not imply broader Mux sync coverage. This plan is only about translated subtitle tracks.

### 2. Subtitle sync is the first-class happy path

For each generated `subtitles-<lang>` artifact:

- if Mux lacks a track for that language, upload the generated WebVTT as a Mux text track
- if Mux already has a track for that language, skip and persist comparison state
- operator can force an override later

### 3. Existing Mux subtitle data wins by default

Automatic sync should never overwrite an existing Mux subtitle track. Replacement requires an explicit operator action after review.

## Proposed User Flow

### Happy path: missing subtitle track

1. User enriches a video into Russian.
2. Workflow generates `subtitles-ru.vtt`.
3. `mux_upload` inspects the target Mux asset and sees no Russian text track.
4. Forge uploads the Russian text track to Mux.
5. Job details show `Mux sync: synced` for `subtitles-ru`.

### Existing Mux data path

1. User enriches a video into French.
2. Workflow generates `subtitles-fr.vtt`.
3. `mux_upload` sees that Mux already has a French subtitle track.
4. Forge skips the write.
5. Job details explain why:
   - `Mux already has French subtitles`
6. Job details show side by side:
   - generated subtitle preview
   - current Mux subtitle preview
7. Operator can click `Override Mux data` to replace the existing French track.

## Technical Approach

## Durable sync model

Persist a single canonical `muxSyncReport` in job artifacts, for example:

```ts
type MuxSyncStatus =
  | "synced"
  | "skipped_existing_mux_data"
  | "skipped_missing_generated_data"
  | "override_applied"
  | "failed"

type MuxSyncComparison = {
  artifactKey: string
  muxTargetType: "text_track"
  muxTargetKey: string
  status: MuxSyncStatus
  explanation: string
  generatedPreview?: unknown
  muxPreview?: unknown
  syncedAt?: string
}
```

Recommended storage location:

- `artifacts.muxSync` metadata entry as the canonical durable report
- `mux_upload.details` may contain a derived summary only if the UI truly needs it, but it must be treated as a projection, not a second source of truth

This keeps:

- the full compare data durable and queryable
- the step table concise without creating persistence drift

Preview payload rules:

- persist truncated subtitle previews only, never full subtitle bodies
- preview payloads must be safe for the existing manager job-detail audience
- if a preview cannot be safely truncated, persist a lightweight summary plus a link to the existing subtitle artifact instead

## Service boundaries

Recommended v1 service shape:

- `services/mux-sync/index.ts`
  - read current Mux subtitle tracks
  - compare generated subtitle artifacts against current Mux state
  - produce the canonical sync report
  - apply missing subtitle writes and subtitle override writes
- optional small helpers only where they clearly reduce duplication, for example preview shaping or Mux track normalization

This keeps v1 implementation right-sized while still avoiding burying comparison logic directly inside [videoEnrichment.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/workflows/videoEnrichment.ts).

## Job detail UI changes

Recommended UI additions:

- extend the step table or job detail page with a dedicated `Mux Sync` section
- render compare cards for translated subtitle tracks that have generated-vs-Mux comparison data:
  - artifact name
  - language
  - sync status
  - explanation
  - generated preview
  - current Mux preview
  - override action when supported

Likely entry points:

- [live-job-detail-header.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [app/dashboard/jobs/[id]/page.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx)

## Override action

Recommended operator flow:

- add a protected manager API endpoint to apply an override for a single subtitle target
- require job id + artifact key + target language
- authorize the endpoint to a narrow manager role that already has access to mutate enrichment outcomes
- verify tenant/job ownership server-side before writing to Mux
- endpoint re-reads Mux state before writing to avoid stale compare decisions
- endpoint records an audit event for each override attempt
- endpoint updates the canonical `muxSync` artifact report afterward

Supported v1 override targets:

- subtitle text tracks by language

## Red/Green TDD Units

- [x] **Unit 1: Model current Mux subtitle state and sync decisions**

  **Goal:** Build a deterministic subtitle comparison layer before writing any Mux data.

  **Files:**
  - Add: [apps/manager/src/services/mux-sync/index.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/services/mux-sync/index.ts)
  - Add tests

  **Red**
  - failing tests for subtitle-track comparison:
    - missing track -> `synced` candidate
    - existing track -> `skipped_existing_mux_data`
  - failing tests for missing generated subtitle data:
    - missing artifact -> `skipped_missing_generated_data`
  - failing tests proving preview payloads are truncated before persistence

  **Green**
  - implement Mux subtitle-track reading, comparison, and report shaping
  - normalize Mux subtitle track data into a stable compare model

  **Refactor**
  - keep comparison payloads compact enough for durable job storage

- [x] **Unit 2: Persist subtitle sync report into job state**

  **Goal:** Make subtitle sync decisions durable and visible on refresh.

  **Files:**
  - [apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/types/job.ts)
  - [apps/manager/src/lib/state.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/lib/state.ts)
  - job/state tests

  **Red**
  - failing tests proving `muxSync` report round-trips through job reads
  - failing tests proving any derived `mux_upload` summary is computed from the canonical artifact report
  - failing tests proving non-translation step details do not get dropped during hydration

  **Green**
  - add durable job metadata shape and hydration for `artifacts.muxSync`
  - widen `JobStepDetails` only if a derived summary is required by the current UI
  - keep backwards compatibility for existing jobs without sync data

  **Refactor**
  - centralize the promoted fields so read-model drift does not recur

- [x] **Unit 3: Implement workflow-side subtitle sync**

  **Goal:** Make `mux_upload` a real subtitle workflow phase.

  **Files:**
  - [apps/cms/src/components/enrichment/job-step.json](/Users/o/.codex/worktrees/f618/forge/apps/cms/src/components/enrichment/job-step.json)
  - regenerated GraphQL artifacts for the added CMS step enum
  - [apps/manager/src/lib/workflow-steps.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/lib/workflow-steps.ts)
  - [apps/manager/src/workflows/videoEnrichment.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/workflows/videoEnrichment.ts)
  - [apps/manager/src/services/mux-sync/index.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/services/mux-sync/index.ts)
  - workflow tests

  **Red**
  - failing test proving `mux_upload` exists as a persisted CMS-backed step for new jobs
  - failing workflow test for missing subtitle track leading to Mux write
  - failing workflow test for existing subtitle track leading to skip + explanation
  - failing workflow test for missing generated subtitle artifact leading to `skipped_missing_generated_data`

  **Green**
  - insert `mux_upload` after subtitle artifact generation
  - persist compare report before and after writes
  - mark step `completed` only after report persistence succeeds

  **Refactor**
  - keep sync behavior idempotent so reruns do not duplicate text tracks

- [x] **Unit 4: Add job detail subtitle compare UI**

  **Goal:** Let operators understand why subtitle data was or was not synced.

  **Files:**
  - [apps/manager/src/features/jobs/live-job-detail-header.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
  - [apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
  - [apps/manager/src/app/globals.css](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/app/globals.css)
  - UI tests

  **Red**
  - failing test for existing-data explanation rendering
  - failing test for generated-vs-mux side-by-side subtitle preview rendering
  - failing test that override appears only for subtitle tracks with replaceable Mux data

  **Green**
  - render compare cards for translated subtitle tracks
  - wire download/view affordances for generated subtitle artifacts

  **Refactor**
  - keep the section readable on both small and wide layouts

- [x] **Unit 5: Add subtitle override action**

  **Goal:** Allow an operator to replace a Mux subtitle track after review.

  **Files:**
  - Add manager override route, likely under `/api/jobs/:id/mux-sync/override`
  - service tests
  - UI tests

  **Red**
  - failing test for overriding an existing subtitle text track
  - failing test proving unauthorized roles cannot invoke override
  - failing test proving override events are audited

  **Green**
  - implement override endpoint
  - re-read Mux before write
  - update durable compare report after success

  **Refactor**
  - keep override payloads narrow and auditable

## Risks and Mitigations

- **Risk: subtitle override duplicates tracks instead of replacing the intended one.**
  - Mitigation: implement explicit target selection and replacement semantics in the writer layer; do not rely on naive append-only behavior.

- **Risk: compare payload becomes too large for durable job state.**
  - Mitigation: persist compact previews only, not full subtitle bodies; rely on existing artifact endpoints for the full generated output.

- **Risk: override writes expand the mutation surface without clear access control.**
  - Mitigation: require narrow role-based authorization, tenant/job ownership checks, and audit logging for every override attempt.

## Acceptance Criteria

- [x] Enrichment jobs run a real `mux_upload` phase after subtitle artifact generation.
- [x] Missing translated subtitle tracks are pushed into Mux as text tracks.
- [x] Existing translated subtitle tracks are not overwritten automatically.
- [x] Missing generated subtitle artifacts are reported as `skipped_missing_generated_data`.
- [x] Job details explain when subtitle sync was skipped because Mux already had data.
- [x] Job details show generated subtitle preview side by side with current Mux subtitle preview before override.
- [x] Operators can override an existing Mux subtitle track with the newly generated subtitle when authorized.
- [x] Override writes require explicit authorization and are audit logged.
- [x] Sync decisions survive page refresh and job polling because they are persisted in job state.
- [x] All new subtitle sync behavior is covered with red/green tests before implementation.

## Verification

Manager validation:

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `pnpm run format:check`

Focused manual QA:

1. Run a translated enrichment job where Mux does not already have the target subtitle language.
2. Confirm the job finishes with `mux_upload` showing `synced` for that subtitle language.
3. Open Mux and confirm the new text track exists.
4. Run the same language again.
5. Confirm the second job shows `skipped_existing_mux_data` with side-by-side comparison and no automatic overwrite.
6. Trigger override and confirm the Mux-side track updates.
7. Run a job where the translated subtitle artifact is missing and confirm the job records `skipped_missing_generated_data`.
8. Confirm an unauthorized operator cannot invoke override.
9. Confirm successful override attempts are audit logged.

## References

- [feat-031 AI Video Enrichment Pipeline](/Users/o/.codex/worktrees/f618/forge/docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- [mux.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/services/mux.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [live-job-detail-header.tsx](/Users/o/.codex/worktrees/f618/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
- [Add subtitles/captions to videos | Mux](https://support-agent.mux.com/docs/guides/add-subtitles-to-your-videos)
