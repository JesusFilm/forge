---
title: "fix: Cleaned audio review blockers"
type: fix
status: complete
date: 2026-04-12
pr: 724
todos: ["001", "002", "003", "004", "005"]
---

# fix: Cleaned audio review blockers

## Overview

Review of PR #724 found one merge-blocking CMS contract issue and several important reliability/performance/readiness issues in the cleaned audio review feature. The next work stage should fix the contract drift first so enrichment jobs can be created, then harden audio cleanup so original and cleaned audio links remain available on useful failure paths without leaving jobs stuck or silently disabled in production.

## Problem Statement

The manager now writes an `audio_cleanup` workflow step and exposes original/cleaned audio artifacts, but the change is not fully integrated across every contract boundary:

- Strapi still rejects `audio_cleanup` as a job-step enum value.
- Coverage reporting keeps a stale local workflow step list.
- Audio cleanup sits behind `mux_upload`, so later Mux sync failures can prevent review artifacts from being created.
- Partial audio artifact persistence and `ffmpeg` extraction are not sufficiently bounded.
- Production enablement still needs an explicit `ELEVENLABS_API_KEY` check and deployed smoke.

## Proposed Solution

Fix the issues in dependency order:

1. Align the CMS `enrichment.job-step` enum and regenerate GraphQL contracts.
2. Share the canonical manager step inventory with coverage reporting.
3. Move audio cleanup into an earlier, error-isolated path and thread playback IDs through the workflow.
4. Add resource bounds for `ffmpeg` extraction and audio buffering.
5. Verify production readiness with a target-environment secret check and deployed smoke evidence.

## Technical Approach

### Phase 1: CMS schema and generated GraphQL contract

- Update `/Users/o/.codex/worktrees/3960/forge/apps/cms/src/components/enrichment/job-step.json` to include `audio_cleanup`.
- Regenerate CMS/GraphQL outputs instead of hand-editing generated files.
- Confirm `/Users/o/.codex/worktrees/3960/forge/apps/cms/schema.graphql` and `/Users/o/.codex/worktrees/3960/forge/packages/graphql/src/graphql-env.d.ts` include `audio_cleanup`.
- Add or adjust tests so manager job creation catches this contract path rather than relying only on mocked state.

### Phase 2: Coverage workflow-step inventory

- Export a canonical workflow step array from `/Users/o/.codex/worktrees/3960/forge/apps/manager/src/lib/workflow-steps.ts`, or create a deliberately named subset if coverage should not count all persisted steps.
- Replace the stale `FORGE_STEPS` in `/Users/o/.codex/worktrees/3960/forge/apps/manager/src/features/coverage/coverage-report-client.tsx`.
- Add coverage tests for step-completeness and classification with `audio_cleanup` present.

### Phase 3: Audio cleanup isolation

- Add `playbackId` to `VideoEnrichmentInput` and pass it from both manager job entry points.
- Use `getPlaybackUrl(playbackId)` to start cleanup without a second Mux asset lookup.
- Move cleanup before `mux_upload` or into an independent branch that is not blocked by later sync failures.
- Wrap partial artifact persistence inside the audio cleanup catch block with its own best-effort guard.
- Add tests for:
  - Mux sync failure after audio cleanup still preserving audio artifacts.
  - partial artifact persistence failure not failing the host job.
  - no extra Mux lookup when playback ID is already available.

### Phase 4: Resource bounds

- Add a timeout/kill path to the `ffmpeg` child process.
- Add a hard extracted-audio byte or duration cap before invoking ElevenLabs, unless a streaming implementation is chosen.
- Avoid the extra artifact response copy in the audio artifact route where possible.
- Add tests for stalled extraction and over-limit audio behavior.

### Phase 5: Deployment readiness

- Confirm `ELEVENLABS_API_KEY` exists in the intended target environment before expecting production audio cleanup.
- Run one deployed manager smoke that creates an enrichment job and verifies both audio artifact links return playable `audio/mpeg`.
- Keep the rollback path explicit: unset `ELEVENLABS_API_KEY` to disable cleanup quickly, or revert the PR if runtime provisioning is wrong.

## Red/Green TDD Plan

1. Write failing tests for the CMS/GraphQL contract or a manager integration boundary that demonstrates `audio_cleanup` must be accepted as a step name.
2. Write failing coverage tests for the step inventory drift.
3. Write failing workflow tests for Mux sync failure after successful audio cleanup and for partial persistence failure staying non-blocking.
4. Write failing service tests for `ffmpeg` timeout behavior and any chosen size/duration cap.
5. Implement the smallest fixes to turn the tests green.
6. Refactor only after all new tests pass.

## User Smoke Test

After implementation:

1. Run the manager locally or against a deployed review environment with `ELEVENLABS_API_KEY` configured.
2. Create an enrichment job with a known audio-bearing video.
3. Open the job detail page.
4. Verify the `Audio review` section shows both `Original audio` and `Cleaned audio`.
5. Open both links and confirm they return `audio/mpeg` and play.
6. Capture screenshot or equivalent validation output for the PR.

## Acceptance Criteria

- [x] P1 todo `/Users/o/.codex/worktrees/3960/forge/todos/001-complete-p1-audio-cleanup-step-schema-drift.md` is resolved.
- [x] P2 todo `/Users/o/.codex/worktrees/3960/forge/todos/002-complete-p2-coverage-step-inventory-drift.md` is resolved or intentionally narrowed.
- [x] P2 todo `/Users/o/.codex/worktrees/3960/forge/todos/003-complete-p2-audio-cleanup-failure-isolation.md` is resolved.
- [x] P2 todo `/Users/o/.codex/worktrees/3960/forge/todos/004-complete-p2-audio-cleanup-resource-bounds.md` is resolved or explicitly split if full streaming is deferred.
- [x] P2 todo `/Users/o/.codex/worktrees/3960/forge/todos/005-pending-p2-production-audio-cleanup-readiness.md` is called out as a deployment prerequisite.
- [x] `pnpm --filter @forge/manager test` passes.
- [x] `pnpm --filter @forge/manager lint` passes.
- [x] `pnpm --filter @forge/manager typecheck` passes.
- [x] CMS/package GraphQL checks required by schema regeneration pass.
- [x] User-like browser/deployed smoke is captured with screenshot or equivalent validation.

## Validation Results

- `pnpm --filter @forge/manager test` passed: 44 files, 268 tests.
- `pnpm --filter @forge/manager lint` passed.
- `pnpm --filter @forge/manager typecheck` passed.
- `pnpm --filter @forge/graphql generate` passed.
- `pnpm --filter @forge/graphql typecheck` passed.
- `pnpm --filter @forge/cms typecheck` passed.
- `git diff --check` passed.
- Browser smoke screenshot: `/tmp/audio-review-smoke-20260412.png`.
- Browser cleaned-audio link screenshot: `/tmp/audio-review-cleaned-audio-open-20260412.png`.
- Local smoke artifact headers:
  - original audio: `200`, `content-type: audio/mpeg`, `content-length: 15380`
  - cleaned audio: `200`, `content-type: audio/mpeg`, `content-length: 206933`
- Doppler secret check without printing secrets:
  - `forge-manager/dev`: `ELEVENLABS_API_KEY=present`
  - `forge-manager/prd`: `ELEVENLABS_API_KEY=missing`

## Dependencies & Risks

- Schema/codegen work requires a runnable CMS/codegen environment.
- Production readiness depends on access to the target Doppler/Railway environment.
- Moving audio cleanup earlier changes workflow timing; tests should prove job completion and step states remain intelligible.
- Streaming audio would be a larger storage/service boundary change; a cap plus timeout is an acceptable first hardening step if streaming is too large for this PR.

## References

- PR: https://github.com/JesusFilm/forge/pull/724
- Todo 001: `/Users/o/.codex/worktrees/3960/forge/todos/001-pending-p1-audio-cleanup-step-schema-drift.md`
- Todo 002: `/Users/o/.codex/worktrees/3960/forge/todos/002-pending-p2-coverage-step-inventory-drift.md`
- Todo 003: `/Users/o/.codex/worktrees/3960/forge/todos/003-pending-p2-audio-cleanup-failure-isolation.md`
- Todo 004: `/Users/o/.codex/worktrees/3960/forge/todos/004-pending-p2-audio-cleanup-resource-bounds.md`
- Todo 005: `/Users/o/.codex/worktrees/3960/forge/todos/005-pending-p2-production-audio-cleanup-readiness.md`
- Known pattern: `/Users/o/.codex/worktrees/3960/forge/docs/solutions/cms/strapi-enrichment-job-content-type.md`
- Known pattern: `/Users/o/.codex/worktrees/3960/forge/docs/solutions/platform/multimodal-scene-analysis-pipeline.md`
- Known pattern: `/Users/o/.codex/worktrees/3960/forge/docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md`
- Known pattern: `/Users/o/.codex/worktrees/3960/forge/docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
