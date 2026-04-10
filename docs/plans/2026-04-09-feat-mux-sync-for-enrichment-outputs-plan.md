---
title: "feat: Sync enrichment outputs back to Mux when appropriate"
type: feat
status: active
date: 2026-04-09
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# feat: Sync enrichment outputs back to Mux when appropriate

## Overview

Add a post-enrichment Mux sync phase that:

- pushes generated translated subtitles into Mux as first-class text tracks when that language is missing on the target asset
- pushes generated AI metadata into Mux only where Mux has a real first-class metadata field
- explains in the job details when Forge did not sync because Mux already had data, or because Mux has no first-class sink for that artifact type
- shows generated output side by side with the current Mux-side data when a sync was skipped because data already exists
- allows an operator to override the Mux-side data with the newly generated data for supported artifact types

This plan is intentionally capability-aware. Based on current Mux docs and the current branch:

- translated subtitles map cleanly to Mux text tracks
- asset metadata maps only partially to Mux asset `meta`
- chapters are supported by Mux Player at playback time, but are not stored as first-class asset-side records in the Video API
- embeddings do not have a Mux-native first-class storage target

So the implementation must separate:

- artifacts that can be truly synced into Mux
- artifacts that can only be explained, compared, and retained in Forge-managed storage

## Problem Frame

Today Forge creates and uses a stage Mux asset, but finished enrichment outputs remain Forge-managed artifacts:

- translated subtitles are written to Forge artifact storage, not to Mux text tracks
- metadata is written to Forge artifacts, not to Mux asset metadata
- chapters are written to Forge artifacts and rendered from the job page only
- embeddings are written to Forge artifacts only

That leaves three operator problems:

1. Enrichment results are not reflected in Mux even when Mux has a native destination.
2. When Mux already has data, Forge has no durable comparison state explaining why sync was skipped.
3. There is no operator affordance to review generated output against current Mux-side state and force an overwrite when desired.

## Capability Reality

### Current Forge behavior

Relevant current code:

- [mux.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/mux.ts)
- [transcription.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/transcription.ts)
- [subtitleTranslation/index.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/subtitleTranslation/index.ts)
- [storage.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/storage.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)

Current behavior:

- Forge creates a Mux asset and may request generated source subtitles
- Forge stores generated artifacts locally or in Railway S3-compatible storage
- the `mux_upload` workflow step exists in the job vocabulary and UI copy, but this branch does not yet implement a real sync phase for enrichment outputs

### Current Mux capability constraints

Current official Mux docs support:

- subtitle tracks as asset text tracks via create-asset input or create-asset-track API
- asset metadata fields `title`, `creator_id`, and `external_id`
- chapters as Mux Player input, not as first-class asset-side persisted records
- AI chaptering and embeddings workflows via `@mux/ai`, but not a first-class Mux Video write target for embeddings

Sources:

- [Add subtitles/captions to videos | Mux](https://support-agent.mux.com/docs/guides/add-subtitles-to-your-videos)
- [Add metadata to your videos | Mux](https://www.mux.com/docs/guides/add-metadata-to-your-videos)
- [Advanced usage of Mux Player | Mux](https://www.mux.com/docs/guides/player-advanced-usage)
- [AI-generated chapters for your videos with Mux Player | Mux](https://www.mux.com/blog/ai-generated-chapters-for-your-videos-with-mux-player/)
- [Use Mux in AI Workflows | Mux](https://www.mux.com/docs/integrations/ai-workflows)

### Implication

The user-facing feature request needs one strategic adjustment:

- **Subtitles:** true native Mux sync
- **Metadata:** partial native Mux sync only for fields Mux actually stores
- **Chapters:** no true Mux asset-side sync today; compare/explain only unless product later accepts a Forge-managed playback layer
- **Embeddings:** no Mux-native sync target; compare/explain only

The plan below treats that as a product truth to surface clearly in the job UI, not something to hide.

## Requirements Trace

- R1. After enrichment completes, Forge must inspect the target Mux asset before attempting any write.
- R2. Forge must sync translated subtitle tracks into Mux only when the target language is missing on Mux.
- R3. Forge must sync metadata only for fields that map to real Mux asset metadata fields.
- R4. When Mux already has a supported destination populated, Forge must skip the write, persist the reason, and expose generated-vs-existing comparison data in the job details.
- R5. Job details must include an explicit operator action to override Mux-side data with newly generated Forge data for supported artifact types.
- R6. For artifact types that Mux does not support as first-class persisted asset data, job details must explain that no native sync target exists.
- R7. The sync decision and comparison result must be durable in job state so the page does not recompute everything ad hoc on each refresh.
- R8. The workflow and UI must distinguish:
  - `synced`
  - `skipped_missing_generated_data`
  - `skipped_existing_mux_data`
  - `unsupported_mux_target`
  - `override_applied`
  - `failed`
- R9. All new behavior must be added with red/green tests before implementation.

## Scope Boundaries

In scope:

- a real post-enrichment `mux_upload` step
- Mux asset inspection and sync decision logic
- durable sync/comparison state on jobs
- job details UI for explanation, side-by-side comparison, and override actions
- translated subtitle sync into Mux text tracks
- mapped metadata sync into Mux asset metadata

In scope with explicit limitation:

- metadata only where the field has a real Mux destination
- chapters and embeddings explanation/comparison state, not a fake native sync

Out of scope:

- redefining Mux’s API surface
- pretending chapters or embeddings are first-class Mux asset records when they are not
- replacing Forge artifact storage as the system of record
- adopting `@mux/ai` as part of this plan
- CMS write-back or player-side rollout outside the manager job detail flow

## Product Decisions

### 1. Treat syncability per artifact type, not as one global yes/no

The job UI and workflow should not say “uploaded to Mux” as a blanket claim. It should report per artifact type:

- what Forge generated
- whether Mux has a native destination
- whether Mux already had data
- whether Forge synced it

### 2. Subtitle sync is the first-class happy path

For each generated `subtitles-<lang>` artifact:

- if Mux lacks a track for that language, upload the generated WebVTT as a Mux text track
- if Mux already has a track for that language, skip and persist comparison state
- operator can force an override later

### 3. Metadata sync is field-mapped, not artifact-shaped

Forge metadata artifacts currently contain richer structure than Mux asset metadata supports. Current Mux asset metadata fields are:

- `title`
- `creator_id`
- `external_id`

So this feature must decide an explicit mapping policy. Recommended initial policy:

- sync generated `title` into Mux `meta.title`
- do **not** overwrite `creator_id` or `external_id` with AI-generated content
- treat generated `description`, `topics`, `speakers`, and `tags` as Forge-only for now, with an explanation that Mux has no equivalent first-class asset metadata field

This keeps the sync honest and avoids abusing `creator_id` or `external_id`.

### 4. Chapters are compare-only unless product later accepts a Forge playback layer

Mux Player supports chapters passed into the player, but Mux Video does not expose a first-class asset-side persisted chapter record comparable to text tracks or asset meta.

So for this plan:

- show generated chapters in the job
- show explanation that Mux has no first-class persisted chapter target on the asset
- do not implement a fake “sync to Mux” step for chapters
- do not expose an override button for chapters in v1

### 5. Embeddings are compare/explain only

Embeddings remain Forge-managed and should continue to live outside Mux.

For this plan:

- explain that Mux has no first-class embedding storage target
- do not expose override-to-Mux for embeddings in v1

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

### Unsupported target path

1. Workflow generates chapters and embeddings.
2. `mux_upload` evaluates these artifact types.
3. Forge marks them as `unsupported_mux_target`.
4. Job details explain:
   - chapters: `Mux Player supports chapters at playback time, but Mux Video has no first-class persisted chapter record on the asset`
   - embeddings: `Mux has no native embedding storage target`

## Technical Approach

## Durable sync model

Add a dedicated metadata artifact or expanded job-step details object to persist a `muxSyncReport`, for example:

```ts
type MuxSyncStatus =
  | "synced"
  | "skipped_existing_mux_data"
  | "skipped_missing_generated_data"
  | "unsupported_mux_target"
  | "override_applied"
  | "failed"

type MuxSyncComparison = {
  artifactKey: string
  muxTargetType: "text_track" | "asset_meta_field" | "unsupported"
  muxTargetKey?: string
  status: MuxSyncStatus
  explanation: string
  generatedPreview?: unknown
  muxPreview?: unknown
  syncedAt?: string
}
```

Recommended storage location:

- new `artifacts.muxSync` metadata entry for the cross-artifact report
- additive `details` on the `mux_upload` step for high-level summary counts

This keeps:

- the full compare data durable and queryable
- the step table concise

## Service boundaries

Recommended new service layers:

- `services/mux-sync/read.ts`
  - inspect current Mux text tracks and asset metadata
- `services/mux-sync/plan.ts`
  - compare generated artifacts against current Mux state
  - produce the durable sync plan/report
- `services/mux-sync/write.ts`
  - apply missing writes
  - apply override writes
- `services/mux-sync/preview.ts`
  - produce safe UI preview payloads for side-by-side compare

This avoids burying comparison logic directly inside [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts).

## Job detail UI changes

Recommended UI additions:

- extend the step table or job detail page with a dedicated `Mux Sync` section
- render per-artifact cards showing:
  - artifact name
  - target type
  - sync status
  - explanation
  - generated preview
  - current Mux preview
  - override action when supported

Likely entry points:

- [live-job-detail-header.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [app/dashboard/jobs/[id]/page.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx)

## Override action

Recommended operator flow:

- add a protected manager API endpoint to apply an override for a single supported target
- require job id + artifact key + target descriptor
- endpoint re-reads Mux state before writing to avoid stale compare decisions
- endpoint updates `muxSync` metadata and the `mux_upload` step details afterward

Supported v1 override targets:

- subtitle text tracks by language
- `meta.title`

Not supported in v1:

- chapters
- embeddings
- AI-generated `description`, `topics`, `speakers`, `tags` into Mux, because there is no first-class destination

## Red/Green TDD Units

- [ ] **Unit 1: Model current Mux state and sync decisions**

  **Goal:** Build a deterministic comparison layer before writing any Mux data.

  **Files:**
  - Add: [apps/manager/src/services/mux-sync/read.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/mux-sync/read.ts)
  - Add: [apps/manager/src/services/mux-sync/plan.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/mux-sync/plan.ts)
  - Add tests for both

  **Red**
  - failing tests for subtitle-track comparison:
    - missing track -> `synced` candidate
    - existing track -> `skipped_existing_mux_data`
  - failing tests for metadata-field comparison:
    - missing title -> `synced` candidate
    - existing title -> `skipped_existing_mux_data`
  - failing tests for chapters and embeddings:
    - always `unsupported_mux_target`

  **Green**
  - implement Mux-state reader and sync planner
  - normalize Mux asset tracks and asset metadata into a stable compare model

  **Refactor**
  - keep comparison payloads compact enough for durable job storage

- [ ] **Unit 2: Persist sync report into job state**

  **Goal:** Make sync decisions durable and visible on refresh.

  **Files:**
  - [apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts)
  - [apps/manager/src/lib/state.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/state.ts)
  - job/state tests

  **Red**
  - failing tests proving `muxSync` report round-trips through job reads
  - failing tests proving `mux_upload` step details can summarize per-artifact results

  **Green**
  - add durable job metadata shape and hydration
  - keep backwards compatibility for existing jobs without sync data

  **Refactor**
  - centralize the promoted fields so read-model drift does not recur

- [ ] **Unit 3: Implement workflow-side sync for supported targets**

  **Goal:** Make `mux_upload` a real workflow phase.

  **Files:**
  - [apps/manager/src/workflows/videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)
  - Add: `apps/manager/src/services/mux-sync/write.ts`
  - workflow tests

  **Red**
  - failing workflow test for missing subtitle track leading to Mux write
  - failing workflow test for existing subtitle track leading to skip + explanation
  - failing workflow test for metadata title sync
  - failing workflow test for unsupported chapter/embedding targets producing explanations instead of fake writes

  **Green**
  - insert `mux_upload` after artifact generation
  - persist compare report before and after writes
  - mark step `completed` only after report persistence succeeds

  **Refactor**
  - keep sync behavior idempotent so reruns do not duplicate text tracks

- [ ] **Unit 4: Add job detail compare UI**

  **Goal:** Let operators understand why data was or was not synced.

  **Files:**
  - [apps/manager/src/features/jobs/live-job-detail-header.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
  - [apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
  - [apps/manager/src/app/globals.css](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/globals.css)
  - UI tests

  **Red**
  - failing test for existing-data explanation rendering
  - failing test for generated-vs-mux side-by-side preview rendering
  - failing test that unsupported targets show explanation and no override button

  **Green**
  - render the compare cards and status copy
  - wire download/view affordances for generated artifacts

  **Refactor**
  - keep the section readable on both small and wide layouts

- [ ] **Unit 5: Add override action for supported targets**

  **Goal:** Allow an operator to replace Mux-side data after review.

  **Files:**
  - Add manager override route, likely under `/api/jobs/:id/mux-sync/override`
  - service tests
  - UI tests

  **Red**
  - failing test for overriding an existing subtitle text track
  - failing test for overriding `meta.title`
  - failing test proving unsupported targets cannot be overridden

  **Green**
  - implement override endpoint
  - re-read Mux before write
  - update durable compare report after success

  **Refactor**
  - keep override payloads narrow and auditable

## Risks and Mitigations

- **Risk: product language says “sync everything to Mux” but Mux does not support that uniformly.**
  - Mitigation: encode per-artifact capability and explanation in the job model and UI.

- **Risk: metadata sync silently abuses `creator_id` or `external_id`.**
  - Mitigation: restrict v1 sync to `meta.title` unless a separate product decision explicitly redefines those fields.

- **Risk: subtitle override duplicates tracks instead of replacing the intended one.**
  - Mitigation: implement explicit target selection and replacement semantics in the writer layer; do not rely on naive append-only behavior.

- **Risk: compare payload becomes too large for durable job state.**
  - Mitigation: persist compact previews only, not full artifact bodies; rely on existing artifact endpoints for the full generated output.

- **Risk: UI claims chapters or embeddings are “on Mux” when they are not.**
  - Mitigation: require exact target-type labels and unsupported copy in tests.

## Acceptance Criteria

- [ ] Enrichment jobs run a real `mux_upload` phase after artifact generation.
- [ ] Missing translated subtitle tracks are pushed into Mux as text tracks.
- [ ] Existing translated subtitle tracks are not overwritten automatically.
- [ ] Job details explain when subtitle sync was skipped because Mux already had data.
- [ ] Job details show generated subtitle preview side by side with current Mux subtitle preview before override.
- [ ] Operators can override an existing Mux subtitle track with the newly generated subtitle.
- [ ] Generated metadata sync only writes to fields that Mux natively supports.
- [ ] Existing Mux metadata fields are not overwritten automatically.
- [ ] Job details explain which metadata fields were syncable and which were Forge-only because Mux has no equivalent field.
- [ ] Chapters are explicitly marked as having no first-class Mux asset sync target.
- [ ] Embeddings are explicitly marked as having no first-class Mux sync target.
- [ ] Unsupported targets do not show misleading override affordances.
- [ ] Sync decisions survive page refresh and job polling because they are persisted in job state.
- [ ] All new sync behavior is covered with red/green tests before implementation.

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
7. Run a job with generated metadata where Mux has no title.
8. Confirm `meta.title` syncs and Forge-only metadata fields are clearly labeled as unsupported by Mux.
9. Confirm chapters and embeddings always show explanation-only state, never fake sync success.

## References

- [feat-031 AI Video Enrichment Pipeline](/Users/o/.codex/worktrees/1ec2/forge/docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- [mux.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/mux.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [live-job-detail-header.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
- [Add subtitles/captions to videos | Mux](https://support-agent.mux.com/docs/guides/add-subtitles-to-your-videos)
- [Add metadata to your videos | Mux](https://www.mux.com/docs/guides/add-metadata-to-your-videos)
- [Advanced usage of Mux Player | Mux](https://www.mux.com/docs/guides/player-advanced-usage)
- [AI-generated chapters for your videos with Mux Player | Mux](https://www.mux.com/blog/ai-generated-chapters-for-your-videos-with-mux-player/)
- [Use Mux in AI Workflows | Mux](https://www.mux.com/docs/integrations/ai-workflows)
