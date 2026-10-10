---
title: "feat: Add manager cleaned audio review links"
type: feat
status: completed
date: 2026-04-12
origin: docs/brainstorms/2026-04-12-manager-cleaned-audio-review-links-requirements.md
roadmap:
  - /docs/roadmap/media-generation/feat-081-cleaned-audio-review-links.md
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# feat: Add manager cleaned audio review links

## Overview

Add a narrow manager-only audio review flow so a completed enrichment job can expose two playable artifacts in job details:

- `Original audio`
- `Cleaned audio`

The cleaned file comes from ElevenLabs audio isolation / voice isolator. The original file is a persisted audio artifact extracted from the same source video so operators can make an honest before/after comparison inside manager without leaving the job detail page.

This slice is intentionally local to `apps/manager`: workflow integration, artifact persistence, and job-detail presentation. It does **not** include CMS sync, public playback, or a new compare-card workflow.

## Found Brainstorm Context

Found brainstorm from `2026-04-12`: `manager-cleaned-audio-review-links`. Using it as planning context.

Key decisions from the brainstorm:

- manager-only v1
- persist both `original-audio` and `cleaned-audio`
- use clearly labeled review links instead of a compare card
- require Red/Green TDD
- require a user smoke test

## Problem Frame

Manager job details already surface text artifacts and some specialized review states, but not audio cleanup output. That means an operator can see that a noise-cleaning step ran without being able to directly judge whether it improved the track.

There are two real constraints hidden inside that simple request:

1. manager currently has no built-in audio artifact descriptor or labeled audio-review surface
2. persisting an actual `original-audio` artifact requires extracting audio from a video-based job input, not just linking to the existing Mux player

So this is not just a UI tweak. It is a small end-to-end feature across workflow execution, artifact storage, route serving, and the job-detail UI.

## Requirements Trace

- R1. Persist `original-audio` and `cleaned-audio` as durable review artifacts.
- R2. Show labeled `Original audio` and `Cleaned audio` links in job details.
- R3. Keep v1 manager-only, with no CMS writeback.
- R4. Reuse the existing protected artifact route and auth model.
- R5. Keep the contract additive for future CMS sync or richer review UX.
- R6. Include a real user smoke test.

## Scope Boundaries

In scope:

- `apps/manager` workflow/service changes for audio cleanup
- manager env validation for ElevenLabs
- audio artifact descriptors and serving
- job detail UI for labeled review links
- focused tests and smoke-test instructions
- manager deployment/runtime notes if audio extraction needs a system binary

Out of scope:

- CMS schema changes
- GraphQL codegen
- public watch surfaces
- waveform UI, compare cards, approvals, or overrides
- generic provider abstraction across multiple audio-cleaning vendors
- broad refactors of the enrichment pipeline

## Context & Research

### Relevant Code and Repo Patterns

- `apps/manager/src/workflows/videoEnrichment.ts`
  - owns step state, artifact persistence, and overall job completion semantics
  - already uses additive `persistMergedArtifacts(...)` updates
- `apps/manager/src/types/job.ts`
  - defines `WorkflowStepName` and the flat `JobArtifactManifest`
- `apps/manager/src/lib/workflow-steps.ts`
  - manager-only step list currently includes `transcription`, `translation`, `chapters`, `metadata`, `embeddings`, and `mux_upload`
- `apps/manager/src/lib/job-artifacts.ts`
  - current artifact descriptor map supports JSON and VTT only
  - current job-detail step mapping assumes icon-only artifact links
- `apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts`
  - protected inline artifact-serving route
- `apps/manager/src/services/storage.ts`
  - artifact keys already allow hyphenated logical names such as `original-audio`
- `apps/manager/src/features/jobs/live-job-detail-header.tsx`
  - current best location for a compact, labeled, human-readable job-detail review control
- `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  - current step-driven execution UI and artifact rendering model
- `apps/manager/src/config/env.ts`
  - validated env boundary for new provider secrets
- `CLAUDE.md`
  - branch naming must use `feat/...`
  - PRs must target `main`
  - squash merge
  - never skip hooks with `--no-verify`

### Institutional Learnings

- `docs/solutions/platform/videoforge-manager-integration.md`
  - prefer lazy/shared service clients and validated external boundaries
- `docs/solutions/cms/strapi-enrichment-job-content-type.md`
  - job artifacts are intentionally flexible JSON; additive artifact growth is the normal pattern
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
  - keep one shared read-model truth so job detail and API responses do not drift
- `docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md`
  - evolve artifacts additively instead of replacing existing contracts
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
  - when an external-service step is persisted in job state, recovery and UI honesty matter
- `docs/solutions/platform/railpack-deploy-apt-packages.md`
  - if audio extraction depends on `ffmpeg`, deployment support needs to be planned explicitly instead of assumed

### External Research Decision

External research is required here because this feature touches a current external API.

Primary-source findings from ElevenLabs docs:

- [Voice isolator overview](https://elevenlabs.io/docs/overview/capabilities/voice-isolator)
  - supports removing background noise from audio and video files
  - supports common audio and video formats
  - documents practical file-size and duration limits
- [Voice Isolator quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/voice-isolator)
  - shows the provider’s intended request flow
  - confirms the API is suitable for a simple request/response integration
- [Audio isolation API reference](https://elevenlabs.io/docs/api-reference/audio-isolation/convert/)
  - documents `POST /v1/audio-isolation`
  - uses multipart form upload
  - returns audio bytes directly

### External Research Conclusion

Use a small dedicated manager service with direct `fetch` + multipart upload, not a new ElevenLabs SDK dependency.

Why:

- manager already uses direct service wrappers around external APIs
- the endpoint is simple enough to call directly
- avoiding a new SDK keeps the scope smaller and the deployment footprint clearer

This is an inference from the official docs plus local repo patterns.

## Spec-Flow Analysis

### User Flows

1. A manager opens a completed job detail page for a job that ran audio cleanup.
2. The page shows a compact `Audio review` area with labeled `Original audio` and `Cleaned audio` links.
3. The manager opens each artifact through the existing protected artifact route and listens to both files.
4. If only one artifact is present, the page stays honest: show the available artifact and a clear failure note for the missing one.

### Resolved Defaults

- **Workflow boundary**
  - Add a new explicit step: `audio_cleanup`
  - Rationale: this is a user-visible, review-oriented artifact and deserves explicit job-state visibility instead of being hidden inside `transcription`
- **UI placement**
  - Add a compact labeled `Audio review` section in the job detail header/summary area
  - Rationale: the current step-table artifact UI is icon-only, which is poor for audio review
- **Artifact keys and format**
  - Use `original-audio` and `cleaned-audio`
  - Use `.mp3` as the v1 review format
- **Failure semantics**
  - `audio_cleanup` is error-isolated from the core enrichment result
  - if cleanup fails after the core job artifacts are complete, keep the overall job completed, persist any available artifact, and surface the step failure honestly
- **Smoke test**
  - manual manager-only browser check on one completed job
  - verify both links render
  - verify both files play
  - verify cleaned audio is audibly different from the original track

## Proposed Solution

Add a narrow `audio_cleanup` step near the end of the enrichment workflow that:

1. fetches the source video or source download URL already associated with the job
2. extracts an `original-audio.mp3` artifact
3. uploads that audio to ElevenLabs audio isolation
4. stores the returned cleaned bytes as `cleaned-audio.mp3`
5. persists both logical keys into `job.artifacts`
6. exposes a small labeled `Audio review` section in job details

The manager UI should not treat this as a compare/override flow. It is just a truthful operator-review surface over two artifacts.

## Key Technical Decisions

### 1. Add a dedicated `audio_cleanup` workflow step

This is the cleanest repo fit because:

- the manager UI is step-oriented
- failures should land in a named step and error log
- future audio review or retry work has a stable boundary

Files affected:

- `apps/manager/src/types/job.ts`
- `apps/manager/src/lib/workflow-steps.ts`
- `apps/manager/src/features/jobs/live-job-steps-table.tsx`

### 2. Keep the feature manager-only and artifact-driven

Do not add CMS sync or new GraphQL work. The only durable storage is the existing job artifact manifest plus the stored files in S3/local tmp.

This follows the additive artifact-contract pattern already used by manager.

### 3. Use labeled review links in the summary area, not icon-only step artifacts

The current step table uses external-link icons without human-readable labels. That is fine for engineering artifacts, but poor for audio QA. A small dedicated `Audio review` section near the top of the job detail keeps the experience obvious and still lightweight.

### 4. Use direct `fetch` for ElevenLabs, not a new SDK

The official API is a simple multipart POST. A small service wrapper is a better repo fit than adding a new package dependency for one endpoint.

### 5. Plan explicitly for source-audio extraction

Persisting `original-audio` is the feature’s hardest technical edge. The likely v1 path is:

- obtain a stable source video URL for the job
- extract audio to mp3 with `ffmpeg`
- store the extracted bytes as `original-audio`
- send the extracted audio or source video to ElevenLabs

This is the main delivery risk and must be validated early.

## Alternative Approaches Considered

### A. Put both audio artifacts in the existing step-table artifact column

Rejected for v1 because the current artifact UI is icon-only and too opaque for audio review.

### B. Link `Original audio` to the existing Mux player instead of persisting an artifact

Rejected because the product decision is to compare two actual audio files, not a cleaned audio file against a video player page.

### C. Hide audio cleanup inside `transcription`

Rejected because it obscures a user-visible artifact-producing step and makes failures harder for operators to reason about.

## Implementation Units

- [x] **Unit 1: Define the audio cleanup job contract**

  **Goal:** Add the new step and artifact descriptors before wiring the provider call.

  **Files:**
  - Modify: `apps/manager/src/types/job.ts`
  - Modify: `apps/manager/src/lib/workflow-steps.ts`
  - Modify: `apps/manager/src/lib/job-artifacts.ts`
  - Modify: `apps/manager/src/lib/job-artifacts.test.ts`
  - Modify: `apps/manager/src/lib/workflow-steps.test.ts`

  **Red**
  - add failing tests for `audio_cleanup` in initial steps
  - add failing tests for `original-audio` / `cleaned-audio` descriptor resolution and href generation

  **Green**
  - add `audio_cleanup` to the manager step list
  - add audio artifact descriptors with `audio/mpeg` content type
  - keep the contract additive

- [x] **Unit 2: Add the audio cleanup service boundary**

  **Goal:** Build a dedicated service that extracts source audio, calls ElevenLabs, and writes the two artifacts.

  **Files:**
  - Add: `apps/manager/src/services/audioCleanup.ts`
  - Add: `apps/manager/src/services/audioCleanup.test.ts`
  - Modify: `apps/manager/src/config/env.ts`
  - Modify: `apps/manager/CLAUDE.md`
  - Modify: `apps/manager/AGENTS.md`
  - Modify: `apps/manager/railway.toml` if runtime audio extraction requires an explicit system package strategy

  **Red**
  - failing service tests for:
    - source-audio extraction invocation
    - multipart upload to ElevenLabs
    - original/cleaned artifact writes
    - error mapping when ElevenLabs rejects or times out

  **Green**
  - validate `ELEVENLABS_API_KEY`
  - implement the provider call with direct `fetch`
  - implement source-audio extraction
  - write both artifacts through `writeArtifact(...)`

  **Risk check**
  - validate the chosen audio-extraction strategy in the runtime environment before treating the service as done

- [x] **Unit 3: Wire the workflow with honest failure semantics**

  **Goal:** Run `audio_cleanup` near the end of enrichment without destabilizing the core pipeline.

  **Files:**
  - Modify: `apps/manager/src/workflows/videoEnrichment.ts`
  - Modify: `apps/manager/src/workflows/videoEnrichment.test.ts`

  **Red**
  - failing workflow tests for:
    - successful audio cleanup persists both artifacts
    - audio cleanup failure does not discard already completed core artifacts
    - original artifact can survive even if cleaned artifact fails later

  **Green**
  - mark `audio_cleanup` running/completed/failed explicitly
  - persist merged artifacts as soon as each audio file is available
  - keep overall job completion truthful for the chosen optional-step behavior

- [x] **Unit 4: Add labeled audio review UI**

  **Goal:** Expose human-readable `Original audio` and `Cleaned audio` links in the job detail surface.

  **Files:**
  - Add: `apps/manager/src/features/jobs/audio-review-links.tsx`
  - Add: `apps/manager/src/features/jobs/audio-review-links.test.tsx`
  - Modify: `apps/manager/src/features/jobs/live-job-detail-header.tsx`
  - Modify: `apps/manager/src/app/globals.css`

  **Red**
  - failing component tests for:
    - both links render when both artifacts exist
    - single-link + failure message render for partial cases
    - no section renders when the job never ran audio cleanup

  **Green**
  - add the compact labeled section
  - keep styling aligned with existing manager cards and inline controls
  - do not build a compare card or waveform UI

- [x] **Unit 5: Final validation and operator smoke test**

  **Goal:** Prove the feature works end to end for both automated and human review.

  **Automated checks**
  - [x] `pnpm --filter @forge/manager test`
  - [x] `pnpm --filter @forge/manager lint`
  - [x] `pnpm --filter @forge/manager typecheck`

  **User smoke test**
  - [x] rendered the actual `AudioReviewLinks` component in a local browser smoke harness
  - [x] verified `Original audio` and `Cleaned audio` links are visible for a completed job with both artifacts
  - [x] verified partial availability renders `Cleaned audio not available yet.`
  - [x] verified the artifact endpoint returns `audio/mpeg` for the cleaned-audio link
  - [x] captured screenshot proof at `/tmp/audio-review-smoke.png`
  - [x] ran a live ElevenLabs audio-cleaning integration smoke through Doppler `forge-manager/dev` using a generated noisy speech clip and local artifact writes
  - [x] verified both generated MP3 files are non-empty, have matching roughly 5.1s durations, and differ by SHA-256:
    - `original-audio.mp3`: `ca690b6b06fa7188629910470abf8ade1d683015fa6710e52875974d886f9945`
    - `cleaned-audio.mp3`: `55bca5ef0b2e18c4c8f653c38f35815e9f5bcd9e0f3c5969cabcd82be5f8d9d8`

## Acceptance Criteria

### Functional Requirements

- [x] Jobs that complete audio cleanup persist `original-audio` and `cleaned-audio` artifacts.
- [x] Job detail UI exposes labeled review links for both artifacts.
- [x] The artifact route serves both audio files through existing manager auth rules.
- [x] Partial availability is surfaced honestly.
- [x] No CMS sync or schema change is introduced.

### Non-Functional Requirements

- [x] Artifact contract remains additive.
- [x] The provider integration is validated through env schema and focused tests.
- [x] The source-audio extraction approach is explicitly supported in local and deploy environments.

### Quality Gates

- [x] Red/Green TDD is used for each implementation unit.
- [x] Focused tests cover artifact contract, service behavior, workflow persistence, and UI rendering.
- [x] User smoke test is completed in a browser-rendered job-detail component harness plus a live ElevenLabs provider smoke through Doppler dev secrets.

## Dependencies & Risks

### Dependencies

- `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
- manager artifact storage via `apps/manager/src/services/storage.ts`
- manager auth/artifact route via `apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts`
- ElevenLabs audio isolation availability and credentials

### Main Risks

1. **Source-audio extraction is harder than the UI change.**
   - Mitigation: validate extraction early and explicitly plan runtime support.

2. **A failed optional step could leave confusing job state.**
   - Mitigation: introduce explicit `audio_cleanup` step semantics and test partial-failure behavior.

3. **The summary UI and step UI could drift.**
   - Mitigation: keep one helper for deriving audio-review state from `job.artifacts` and step status.

4. **This could sprawl into CMS sync or voiceover work.**
   - Mitigation: keep the branch scoped to manager-only review artifacts and document follow-ups separately.

## Delivery Workflow

### Branch / PR Rules

- Create branch: `feat/manager-cleaned-audio-review-links`
- Target PR branch: `main`
- Use conventional commits such as `feat: add manager cleaned audio review links`
- Do not skip hooks with `--no-verify`
- Keep the PR scoped to this feature only

### Recommended Sequence

1. update roadmap ticket `feat-081`
2. write failing tests first
3. validate audio extraction strategy locally before polishing UI
4. finish implementation
5. run manager test/lint/typecheck
6. complete the user smoke test
7. proceed to review and compound documentation

## References & Research

### Internal References

- `apps/manager/src/workflows/videoEnrichment.ts`
- `apps/manager/src/lib/job-artifacts.ts`
- `apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts`
- `apps/manager/src/features/jobs/live-job-detail-header.tsx`
- `apps/manager/src/lib/workflow-steps.ts`
- `docs/plans/2026-04-02-fix-manager-job-artifact-links-plan.md`
- `docs/solutions/platform/videoforge-manager-integration.md`
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
- `docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md`
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`

### External References

- [ElevenLabs Voice isolator overview](https://elevenlabs.io/docs/overview/capabilities/voice-isolator)
- [ElevenLabs Voice Isolator quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/voice-isolator)
- [ElevenLabs Audio isolation API reference](https://elevenlabs.io/docs/api-reference/audio-isolation/convert/)
