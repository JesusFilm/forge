---
title: "feat: Add derived WebVTT chapters artifact"
type: feat
status: active
date: 2026-04-09
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# feat: Add derived WebVTT chapters artifact

## Overview

Add a second chapters artifact, `chapters.vtt`, derived from the existing canonical `chapters.json` output.

The current chapter pipeline already produces structured chapter data with:

- `title`
- `startSeconds`
- `endSeconds`
- `summary`

That is enough to generate a standards-compatible WebVTT chapters track for:

- `video.js` chapter tracks
- native `<track kind="chapters">`
- simple exports to downstream players

The goal is to keep `chapters.json` as the canonical structured artifact while adding `chapters.vtt` as a portable playback artifact.

## Problem Statement / Motivation

Today manager stores chapters only as JSON:

- [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts) writes `chapters.json`
- [job-artifacts.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/job-artifacts.ts) treats chapters as a single downloadable JSON artifact
- job UI can download/view the chapter JSON, but playback-oriented consumers still need to transform it themselves

That is fine for internal workflow logic, but it leaves a gap for player interoperability:

- `Mux Player` wants an array shape such as `{ startTime, endTime?, value }`
- `video.js` and native HTML video chapter tracks typically want a WebVTT file with timed chapter cues

Because we already compute `endSeconds`, the missing piece is not semantics. It is just artifact packaging.

Adding a derived `chapters.vtt` artifact gives us:

- a stable playback export format
- parity with how subtitles are already stored as downloadable `.vtt`
- less repeated transformation work in future player integrations

## Found Brainstorm

No relevant recent brainstorm was found for this exact feature. Proceeding from current code and branch context.

## Context & Research

### Relevant current code

- [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts)
  - generates normalized chapters
  - already derives `endSeconds`
  - currently writes only `chapters.json`
- [job-artifacts.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/job-artifacts.ts)
  - controls logical artifact keys, file extensions, content types, and step artifact linking
- [storage.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/storage.ts)
  - already supports writing arbitrary artifact types with `.vtt`
- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)
  - merges artifact keys returned by `generateChapters(...)`
- [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)
  - already covers chapter normalization and artifact writing behavior
- [videoEnrichment.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.test.ts)
  - already covers chapter artifact manifest persistence

### Institutional learnings

- [2026-04-02-fix-manager-job-artifact-links-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-02-fix-manager-job-artifact-links-plan.md)
  - established the pattern that step services return `artifactKeys` and the workflow/job UI should rely on those keys rather than hardcoded assumptions
- [2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md)
  - intentionally kept the artifact contract at `chapters.json` during the chapter-quality work
  - this new plan deliberately expands that contract in a focused, additive way
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
  - confirms artifacts should remain portable across local `.tmp` storage and Railway S3 object storage

### External research decision

Skipped. The repo already contains the needed chapter semantics, and WebVTT chapters are a stable, low-risk export format. This plan is primarily about packaging our existing chapter model into an additional artifact.

## Requirements Trace

- R1. `chapters.json` must remain the canonical chapter artifact.
- R2. The chapters step must also write a derived `chapters.vtt` artifact.
- R3. The derived VTT must be generated from normalized chapter data, not from raw model output.
- R4. VTT cue ordering must match normalized chapter ordering.
- R5. VTT cue start/end times must be deterministic and valid even when the last chapter has `endSeconds: null`.
- R6. The job artifact manifest and job detail UI must expose both chapter artifacts.
- R7. Existing chapter consumers that rely on `chapters.json` must continue working unchanged.
- R8. The implementation must follow red/green TDD.

## Scope Boundaries

In scope:

- adding a chapters-to-WebVTT formatter
- writing `chapters.vtt` alongside `chapters.json`
- updating artifact descriptors and job-step links so both chapter artifacts appear in the UI
- additive test coverage for service, artifact routing, and workflow persistence

Out of scope:

- replacing `chapters.json`
- changing the chapter generation prompt or normalization logic
- changing subtitle artifacts
- building a player integration in the same change
- changing Mux sync behavior

## Proposed Solution

Keep the chapter generation pipeline exactly where it is today:

1. generate raw chapters from the transcript
2. normalize them into the canonical `Chapter[]` shape
3. write `chapters.json`
4. derive `chapters.vtt` from the normalized `Chapter[]`
5. return both artifact keys so the workflow and UI expose both

Desired artifact model after this change:

- `chapters.json` — canonical structured artifact for internal workflows and rich UI
- `chapters.vtt` — portable chapter track for playback and export

## Key Technical Decisions

### 1. JSON remains canonical

Do not invert the source of truth. `chapters.vtt` should be derived from normalized JSON data, not the other way around.

Why:

- JSON preserves `summary` and explicit structured fields
- JSON is easier for comparison, editing, and future transforms
- the current scene-analysis pipeline already consumes `Chapter[]`

### 2. Derive VTT after normalization, not before

The VTT builder should run only after:

- invalid rows are dropped
- first chapter anchoring is applied
- duplicate timestamps are removed
- `endSeconds` is derived

That ensures the VTT export exactly matches the job’s final canonical chapter outline.

### 3. Use an additive artifact key

Recommended logical key:

- `chapters-vtt`

Why this is preferred over overloading `chapters`:

- avoids ambiguity about extension/content type
- matches the existing per-artifact-key manifest pattern
- keeps JSON and VTT independently addressable in job details

### 4. Last cue end-time policy must be deterministic

Recommended policy:

- when `endSeconds` is present, use it
- when `endSeconds` is `null`, omit the final cue end time only if the chosen VTT helper explicitly supports that
- otherwise require the builder to use the next known boundary or a final known duration from the normalized chapter data path

Because raw WebVTT cues normally require explicit start and end timing, the implementation should likely prefer emitting only cues with concrete end times. If the last normalized chapter has `endSeconds: null`, the builder should use the same bounded duration logic already used in normalization rather than inventing a new fallback in the VTT layer.

## SpecFlow Analysis

Important behavior branches:

1. **Normal chapter export**
   - multiple chapters
   - concrete `endSeconds`
   - VTT writes cleanly and appears in the job manifest

2. **Single-chapter video**
   - still produces one valid VTT cue
   - no invalid zero-length cue

3. **Last chapter duration edge case**
   - last chapter remains valid if normalization returns a bounded end
   - no malformed cue with a missing end

4. **Failure path**
   - if chapter extraction fails, neither `chapters.json` nor `chapters.vtt` should be written

5. **UI artifact listing**
   - completed chapter step shows both JSON and VTT links
   - older jobs with only `chapters` still render safely

## Implementation Units

- [ ] **Unit 1: Add a pure chapters-to-VTT formatter**

  **Goal:** Create a deterministic formatter from canonical `Chapter[]` into WebVTT text.

  **Files:**
  - Add or update chapter utility code under [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts) or a small adjacent helper
  - Modify: [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)

  **Red**
  - add failing tests for:
    - multi-chapter VTT generation
    - proper timestamp formatting
    - cue text using chapter title
    - final cue handling

  **Green**
  - implement the formatter
  - keep output valid `WEBVTT`

  **Refactor**
  - keep the formatter pure and reusable by future player integrations

- [ ] **Unit 2: Write `chapters.vtt` alongside `chapters.json`**

  **Goal:** Expand the chapter step to emit both artifacts from the same normalized data.

  **Files:**
  - Modify: [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts)
  - Modify: [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)

  **Red**
  - add failing tests proving:
    - both writes happen on success
    - returned `artifactKeys` include both chapter artifacts
    - no VTT write happens when chapter extraction fails

  **Green**
  - write `chapters.vtt`
  - return both artifact keys

  **Refactor**
  - avoid duplicating serialization logic inside the service body

- [ ] **Unit 3: Teach the artifact layer and job UI about the new chapter artifact**

  **Goal:** Make the new VTT downloadable and visible.

  **Files:**
  - Modify: [job-artifacts.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/job-artifacts.ts)
  - Modify: related tests
  - Optionally adjust [live-job-steps-table.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx) only if link ordering or labels need refinement

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

- [ ] **Unit 4: Verify workflow persistence stays correct**

  **Goal:** Ensure the enrichment workflow carries the new artifact through job state.

  **Files:**
  - Modify: [videoEnrichment.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.test.ts)

  **Red**
  - add failing workflow tests proving chapter step results persist both artifact keys

  **Green**
  - adjust any expectations needed for the new manifest shape

  **Refactor**
  - keep workflow changes minimal; the service return contract should do most of the work

## Acceptance Criteria

- [ ] Chapter generation still produces `chapters.json` as the canonical artifact.
- [ ] The chapter step also writes `chapters.vtt`.
- [ ] `chapters.vtt` is derived from normalized chapter data, not raw LLM output.
- [ ] The chapter job step exposes downloadable links for both JSON and VTT artifacts.
- [ ] Existing jobs that only have `chapters.json` continue rendering without breakage.
- [ ] Chapter extraction failures do not leave behind orphaned or partial `chapters.vtt` artifacts.
- [ ] All new behavior is covered with red/green tests before implementation.

## Risks & Mitigations

- **Risk:** artifact-key drift breaks existing assumptions that “chapters” is singular.
  - **Mitigation:** keep `chapters` unchanged and add a second explicit key rather than renaming the original artifact.

- **Risk:** malformed VTT if end times are not bounded correctly.
  - **Mitigation:** derive VTT only from normalized `Chapter[]` with tested timestamp formatting.

- **Risk:** future player integrations start depending on VTT and ignore the richer JSON source.
  - **Mitigation:** document that `chapters.json` remains canonical and `chapters.vtt` is an export artifact.

## Verification

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `pnpm run format:check`

Manual QA:

1. Run a local enrich job that completes the chapters step.
2. Open the job page and confirm the chapters step shows both:
   - `chapters`
   - `chapters-vtt`
3. Open the VTT artifact and confirm it begins with `WEBVTT`.
4. Confirm cues are ordered and titled correctly.
5. Confirm older jobs that only have `chapters` still render normally.

## References

- [feat-031 AI Video Enrichment Pipeline](/Users/o/.codex/worktrees/1ec2/forge/docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts)
- [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)
- [job-artifacts.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/job-artifacts.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [2026-04-02-fix-manager-job-artifact-links-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-02-fix-manager-job-artifact-links-plan.md)
- [2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-08-feat-improve-chapters-with-mux-ai-patterns-plan.md)
