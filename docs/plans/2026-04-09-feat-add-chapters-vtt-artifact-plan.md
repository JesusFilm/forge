---
title: "feat: Add derived WebVTT chapters artifact"
type: feat
status: completed
date: 2026-04-09
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# feat: Add derived WebVTT chapters artifact

## Overview

Add a second timing-backed chapters export derived from the existing canonical `chapters.json` output.

The current chapter pipeline already produces structured chapter data with:

- `title`
- `startSeconds`
- `endSeconds`
- `summary`

That is enough to generate a standards-compatible WebVTT chapters track for:

- `video.js` chapter tracks
- native `<track kind="chapters">`
- simple exports to downstream players

The goal is to keep `chapters.json` as the canonical structured artifact while exposing a downloadable WebVTT chapter track under manager's existing logical-key model as `chapters-vtt` (`chapters-vtt.vtt` on download).

## Problem Statement / Motivation

Today manager stores chapters only as JSON:

- [chapters.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.ts) writes `chapters.json`
- [job-artifacts.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/job-artifacts.ts) treats chapters as a single downloadable JSON artifact
- job UI can download/view the chapter JSON, but operators and downstream experiments cannot download a ready-made chapter track from a timing-backed enrichment job

That is fine for internal workflow logic, but it leaves a gap in the current manager export surface:

- native/video.js-style chapter-track consumers typically want a WebVTT file with timed chapter cues
- manager jobs already expose downloadable subtitle `.vtt` artifacts, so chapter exports are the inconsistent outlier

Because we already compute `endSeconds`, the missing piece is not semantics. It is just artifact packaging.

Adding a derived WebVTT chapter export gives us:

- a concrete operator-facing outcome: a downloadable chapter-track artifact on timing-backed enrichment jobs
- parity with how subtitles are already stored as downloadable `.vtt`
- a standard export artifact for downstream experiments without changing the canonical JSON contract

This plan is intentionally enablement work for manager QA/download flows and downstream experiments. It does not claim to change playback UX by itself.

## Found Brainstorm

No relevant recent brainstorm was found for this exact feature. Proceeding from current code and branch context.

## Context & Research

### Relevant current code

- [chapters.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.ts)
  - generates normalized chapters
  - already derives `endSeconds`
  - can still produce a final `endSeconds: null` when called without transcript segments
  - currently writes only `chapters.json`
- [job-artifacts.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/job-artifacts.ts)
  - controls logical artifact keys, file extensions, content types, and step artifact linking
- [artifacts route](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts)
  - uses the logical artifact key as the download filename prefix
  - means `chapters-vtt` will download as `chapters-vtt.vtt` unless the route contract is expanded
- [storage.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/storage.ts)
  - already supports writing arbitrary artifact types with `.vtt`
- [vtt.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/vtt.ts)
  - already provides shared WebVTT timestamp formatting utilities
- [videoEnrichment.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/workflows/videoEnrichment.ts)
  - passes timing-backed transcript segments into `generateChapters(...)`
  - merges artifact keys returned by `generateChapters(...)`
- [sceneAnalysisPipeline.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/workflows/sceneAnalysisPipeline.ts)
  - calls `generateChapters(...)` with plain transcript text only
  - should remain JSON-only in this plan
- [chapters.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.test.ts)
  - already covers chapter normalization and artifact writing behavior
- [job-artifacts.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/job-artifacts.test.ts)
  - already covers descriptor lookup and per-step artifact mapping
- [videoEnrichment.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/workflows/videoEnrichment.test.ts)
  - already covers chapter artifact manifest persistence

### Institutional learnings

- [2026-04-02-fix-manager-job-artifact-links-plan.md](/Users/o/.codex/worktrees/6179/forge/docs/plans/2026-04-02-fix-manager-job-artifact-links-plan.md)
  - established the pattern that step services return `artifactKeys` and the workflow/job UI should rely on those keys rather than hardcoded assumptions
- [2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md](/Users/o/.codex/worktrees/6179/forge/docs/plans/2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md)
  - intentionally kept the artifact contract at `chapters.json` during the chapter-quality work
  - this new plan deliberately expands that contract in a focused, additive way
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/6179/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
  - confirms artifacts should remain portable across local `.tmp` storage and Railway S3 object storage

### External research decision

Skipped. The repo already contains the needed chapter semantics, and WebVTT chapters are a stable, low-risk export format. This plan is primarily about packaging our existing chapter model into an additional artifact.

## Requirements Trace

- R1. `chapters` / `chapters.json` must remain the canonical chapter artifact and existing contract.
- R2. `generateChapters(...)` must also write a second downloadable artifact under logical key `chapters-vtt` whenever `input.segments` is non-empty, `getLastTranscriptSecond(input.segments)` returns a bounded duration, and all normalized chapters have bounded `endSeconds`. In the current repo, video enrichment is the only caller that satisfies that invariant.
- R3. `chapters-vtt` must be generated from normalized chapter data, not from raw model output.
- R4. `chapters-vtt` cue ordering must match normalized chapter ordering.
- R5. `chapters-vtt` may only be emitted when every cue has an explicit start and end time. Concretely, that means `input.segments` is non-empty, the derived transcript duration is bounded, and every normalized chapter has non-null `endSeconds`.
- R6. Transcript-only callers of `generateChapters(...)` remain supported and unchanged; they continue to return only `chapters`.
- R7. The manager artifact surface must expose both `chapters` and `chapters-vtt` for completed timing-backed chapter steps, while older manifests with only `chapters` continue to render safely.
- R8. The manager download contract for the new artifact is `chapters-vtt.vtt`. This plan does not add a separate display filename or route remapping layer.
- R9. The implementation must follow red/green TDD.

## Scope Boundaries

In scope:

- adding a chapters-to-WebVTT formatter
- writing `chapters-vtt.vtt` alongside `chapters.json` for timing-backed enrichment runs
- updating artifact descriptors and chapter-step artifact mapping so both chapter artifacts appear through the existing job artifact surface
- additive test coverage for service, artifact routing, and workflow persistence

Out of scope:

- replacing `chapters.json`
- changing the chapter generation prompt or normalization logic
- changing transcript-only scene analysis to preserve VTT timing data
- changing subtitle artifacts
- building a player integration in the same change
- changing manager artifact routes so logical key and download filename can differ
- changing Mux sync behavior

## Proposed Solution

Keep the chapter generation pipeline exactly where it is today, but make the VTT export conditional on timing-backed input:

1. generate raw chapters from the transcript
2. normalize them into the canonical `Chapter[]` shape
3. write `chapters.json`
4. when `input.segments` is non-empty, the derived transcript duration is bounded, and every normalized chapter has a bounded `endSeconds`, derive `chapters-vtt.vtt` from the normalized `Chapter[]`
5. return `["chapters", "chapters-vtt"]` only for that timing-backed success path
6. keep transcript-only callers on `["chapters"]`

Desired manager artifact model after this change:

- `chapters` -> `chapters.json` — canonical structured artifact for internal workflows and richer transforms
- `chapters-vtt` -> `chapters-vtt.vtt` — downloadable WebVTT chapter-track export for timing-backed enrichment jobs

## Key Technical Decisions

### 1. JSON remains canonical

Do not invert the source of truth. `chapters-vtt` should be derived from normalized JSON data, not the other way around.

Why:

- JSON preserves `summary` and explicit structured fields
- JSON is easier for comparison, editing, and future transforms
- the current scene-analysis pipeline already consumes `Chapter[]`

### 2. Scope VTT writing to timing-backed enrichment runs

`generateChapters(...)` is shared by:

- the video enrichment workflow, which passes transcript segments with bounded timing
- the scene-analysis pipeline, which passes plain transcript text only

In the current repo, only the first path satisfies the `chapters-vtt` eligibility rule. Transcript-only callers remain JSON-only.

Why:

- the current normalization logic can leave the final chapter with `endSeconds: null` when no transcript segments are provided
- the enrichment workflow already provides the timing data needed for valid WebVTT cues
- keeping transcript-only callers unchanged is the smallest implementation-ready change

### 3. Derive VTT after normalization, not before

The VTT builder should run only after:

- invalid rows are dropped
- first chapter anchoring is applied
- duplicate timestamps are removed
- `endSeconds` is derived

That ensures the VTT export exactly matches the job’s final canonical chapter outline.

### 4. Use an additive artifact key and manager-native filename contract

Recommended logical key:

- `chapters-vtt`

Downloaded filename:

- `chapters-vtt.vtt`

Why this is preferred over overloading `chapters` or introducing a route change:

- avoids ambiguity about extension/content type
- matches the existing per-artifact-key manifest pattern
- keeps JSON and VTT independently addressable in job details
- matches the current route contract, which uses `logicalKey + "." + ext` for the filename

### 5. Final cue policy is strict: bounded end times only

Required policy:

- when a normalized chapter has a concrete `endSeconds`, use it
- when any normalized chapter has `endSeconds: null`, do not emit `chapters-vtt`
- do not omit cue end times
- do not invent a second fallback policy inside the VTT layer

This keeps the VTT formatter deterministic and makes the timing-backed scope explicit.

### 6. Reuse shared VTT time formatting, but keep chapter serialization lean

Chapter-track generation should reuse `formatVTTTime(...)` from [vtt.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/vtt.ts) rather than duplicating timestamp formatting logic.

Do not reuse `segmentsToVTT(...)` directly:

- subtitle VTT serialization is segment-oriented and adds subtitle-specific `NOTE` metadata
- chapter-track VTT only needs `WEBVTT`, timed cues, and chapter titles
- keeping chapter cue serialization local to [chapters.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.ts) keeps the change small while still sharing the core time formatter

### 7. Write order favors canonical JSON and accepts current job-failure behavior

Required write order:

1. serialize normalized chapters
2. write `chapters`
3. write `chapters-vtt` only if the timing-backed guard passes
4. return `chapters-vtt` in `artifactKeys` only after its write succeeds

If chapter extraction fails, neither artifact is written. If the VTT write fails after the JSON write succeeds, the chapters step should fail, the enrichment workflow should fail the overall job under current behavior, and no `chapters-vtt` manifest entry should be returned. This plan does not add storage rollback behavior for already-written objects or introduce JSON-only degradation for VTT write failures.

## SpecFlow Analysis

Important behavior branches:

1. **Timing-backed enrichment export**
   - multiple chapters
   - concrete `endSeconds`
   - `chapters` and `chapters-vtt` both write cleanly and appear in the job manifest

2. **Timing-backed single-chapter video**
   - still produces one valid VTT cue
   - no invalid zero-length cue

3. **Transcript-only caller**
   - normalized chapters still write to `chapters`
   - no `chapters-vtt` write is attempted
   - scene-analysis behavior remains unchanged

4. **Unbounded final chapter guard**
   - if normalization leaves any chapter with `endSeconds: null`
   - `chapters-vtt` is skipped for that call
   - the caller still gets canonical JSON output

5. **Failure path**
   - if chapter extraction fails, neither chapter artifact is written
   - if the VTT write fails after JSON succeeds, the step fails and no `chapters-vtt` key is persisted in the manifest

6. **Existing artifact listing**
   - completed enrichment chapter step shows both JSON and VTT links through the existing artifact table behavior
   - older jobs with only `chapters` still render safely

## Implementation Units

- [x] **Unit 1: Add a private pure chapters-to-VTT formatter**

  **Goal:** Create a deterministic formatter from canonical `Chapter[]` into WebVTT text.

  **Files:**
  - Modify: [chapters.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.ts)
  - Modify: [chapters.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.test.ts)

  **Red**
  - add failing tests for:
    - multi-chapter VTT generation
    - proper timestamp formatting
    - cue text using chapter title
    - refusal to emit VTT when any chapter end time is unbounded

  **Green**
  - implement the formatter
  - keep output valid `WEBVTT`
  - reuse `formatVTTTime(...)` from [vtt.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/vtt.ts)

  **Refactor**
  - keep chapter cue serialization as a private pure function in `chapters.ts` unless a second in-repo caller appears during implementation

- [x] **Unit 2: Emit `chapters-vtt` when timing invariants hold**

  **Goal:** Expand the shared chapter service so callers with non-empty bounded transcript segments emit both artifacts while transcript-only callers remain JSON-only.

  **Files:**
  - Modify: [chapters.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.ts)
  - Modify: [chapters.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.test.ts)

  **Red**
  - add failing tests proving:
    - timing-backed success writes both artifacts
    - returned `artifactKeys` include `chapters-vtt` only when `input.segments` is non-empty, duration is bounded, and normalized chapters are fully bounded
    - transcript-only callers still return only `chapters`
    - no VTT write happens when chapter extraction fails
    - no VTT write happens when normalized chapters are unbounded
    - no VTT write happens when `input.segments` is empty

  **Green**
  - write `chapters` first
  - write `chapters-vtt` only when the timing-backed guard passes
  - return the correct artifact keys for each caller path

  **Refactor**
  - avoid duplicating serialization logic inside the service body

- [x] **Unit 3: Register the new chapter artifact contract**

  **Goal:** Make the new artifact downloadable and visible through the existing artifact surface.

  **Files:**
  - Modify: [job-artifacts.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/job-artifacts.ts)
  - Modify: [job-artifacts.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/job-artifacts.test.ts)
  - Do not modify [live-job-steps-table.tsx](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx) unless failing tests or manual QA prove a rendering issue

  **Red**
  - add failing tests proving:
    - `chapters-vtt` resolves to `.vtt` and `text/vtt`
    - completed chapter step returns links for both chapter artifacts
    - older manifests with only `chapters` still behave

  **Green**
  - register the new artifact descriptor
  - update step artifact mapping

  **Refactor**
  - keep the artifact lookup logic additive and backward-compatible

- [x] **Unit 4: Verify workflow persistence stays additive**

  **Goal:** Ensure the enrichment workflow carries the new artifact through job state without requiring production workflow changes beyond the current failure policy.

  **Files:**
  - Modify: [videoEnrichment.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/workflows/videoEnrichment.test.ts)
  - Do not modify [videoEnrichment.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/workflows/videoEnrichment.ts) unless the tests prove the current artifact merge flow is insufficient

  **Red**
  - add failing workflow tests proving the timing-backed chapter step persists both artifact keys
  - add a failing workflow test proving a `chapters-vtt` write failure still fails the overall job under current workflow behavior

  **Green**
  - adjust only the expectations needed for the new manifest shape

  **Refactor**
  - keep workflow changes at zero if the service return contract is sufficient

## Acceptance Criteria

- [x] Chapter generation still produces `chapters` / `chapters.json` as the canonical artifact.
- [x] Calls that provide non-empty bounded transcript segments also write `chapters-vtt` / `chapters-vtt.vtt`. In the current repo, that means timing-backed enrichment runs.
- [x] `chapters-vtt` is derived from normalized chapter data, not raw LLM output.
- [x] Transcript-only callers remain JSON-only and continue working unchanged.
- [x] The chapter job step exposes downloadable links for both `chapters` and `chapters-vtt` through the existing artifact surface.
- [x] Existing jobs that only have `chapters` continue rendering without breakage.
- [x] If chapter extraction fails, neither chapter artifact is written. If the VTT write fails, the chapters step and current enrichment job fail, and no `chapters-vtt` manifest entry is returned.
- [x] All new behavior is covered with red/green tests before implementation.

## Risks & Mitigations

- **Risk:** artifact-name drift confuses logical keys, stored artifact types, and downloaded filenames.
  - **Mitigation:** standardize on `chapters` for JSON and `chapters-vtt` for WebVTT throughout the manager contract.

- **Risk:** transcript-only callers produce unbounded final chapters.
  - **Mitigation:** scope `chapters-vtt` to timing-backed enrichment runs and leave transcript-only callers JSON-only.

- **Risk:** `segments` is present but empty, which looks timing-backed at the workflow level but is still insufficient for bounded VTT cues.
  - **Mitigation:** define the guard in terms of non-empty `input.segments`, bounded derived duration, and fully bounded normalized chapters.

- **Risk:** future downstream consumers expect the filename `chapters.vtt`.
  - **Mitigation:** document that the current manager contract is `chapters-vtt.vtt`; any filename remapping belongs in a later route/consumer-specific change.

- **Risk:** VTT write failure leaves storage state ahead of manifest state.
  - **Mitigation:** write canonical JSON first, accept current job-failure behavior on VTT write failure, and rely on the artifact manifest as the user-visible source of truth.

## Verification

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `pnpm run format:check`

Manual QA:

1. Run a local enrich job that completes the chapters step.
2. Open the job page and confirm the chapters step renders two downloadable artifact links/icons instead of one.
3. Open `/api/jobs/<job-id>/artifacts/chapters-vtt` and confirm:
   - `Content-Type` is `text/vtt; charset=utf-8`
   - `Content-Disposition` uses `chapters-vtt.vtt`
   - the body begins with `WEBVTT`
4. Confirm cues are ordered and titled correctly.
5. Confirm an older job that only has `chapters` still renders normally.
6. Confirm the scene-analysis pipeline path remains unchanged in tests and still relies on JSON chapters only.
7. Confirm a simulated `chapters-vtt` write failure still fails the job in workflow tests, matching the documented current behavior.

## References

- [feat-031 AI Video Enrichment Pipeline](/Users/o/.codex/worktrees/6179/forge/docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- [chapters.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.ts)
- [chapters.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/services/chapters.test.ts)
- [job-artifacts.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/job-artifacts.ts)
- [job-artifacts.test.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/job-artifacts.test.ts)
- [vtt.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/lib/vtt.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [sceneAnalysisPipeline.ts](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/workflows/sceneAnalysisPipeline.ts)
- [artifacts route](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts)
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/6179/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [2026-04-02-fix-manager-job-artifact-links-plan.md](/Users/o/.codex/worktrees/6179/forge/docs/plans/2026-04-02-fix-manager-job-artifact-links-plan.md)
- [2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md](/Users/o/.codex/worktrees/6179/forge/docs/plans/2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md)
