---
title: "Smart Crop real-video repair reliability"
type: feat
status: complete
date: 2026-06-17
---

# Smart Crop real-video repair reliability

## Summary

Prove and harden the Smart Crop repair loop against a short real Mux library
video, not only mocked artifacts. The workflow should reliably create durable
preview evidence for every attempt and produce a cropped 9:16 MP4 from the
selected/approved crop path.

---

## Problem Frame

The repair-attempt implementation adds attempt manifests, attempt-specific
previews, and a human review player, but the strongest current evidence is unit
coverage plus mock-mode browser smoke. The requested outcome is stricter: run a
short Mux source from the video library through the crop process and verify that
the process creates cropped videos while preserving every repair loop for human
review.

---

## Requirements

- R1. The verification path must use a real short library video with a public
  Mux playback URL, not a synthetic local video or a mocked playback id.
- R2. The test path must create or reuse real Smart Crop artifacts for the
  source asset: fingerprint, attempt plan, attempt preview MP4, preview frames,
  render report, QA report, and attempts manifest.
- R3. At least two attempts must be represented in the human review surface when
  a repair-triggering QA condition is present: the initial crop attempt and the
  repaired attempt.
- R4. The full 9:16 cropped MP4 must be rendered from the selected crop path,
  and its dimensions/duration must be probed after render.
- R5. The verification must fail with actionable diagnostics when FFmpeg,
  crop-worker, Mastra, Manager config, shared artifact storage, or Mux access is
  missing instead of silently falling back to mock-only proof.
- R6. The verification should be repeatable from the repo with bounded runtime
  on a short input video and should not require committing generated MP4/JPG
  artifacts.
- R7. Browser proof must cover attempt switching, original-video crop overlay,
  shot chapter controls, QA report visibility, and selected-attempt approval
  behavior for the real-video run or a locally seeded artifact-equivalent run.
- R8. Existing unit coverage must continue to protect the attempt manifest,
  repair decision taxonomy, attempt-specific worker outputs, Mastra repair
  response validation, and selected-attempt approval digest.

---

## Key Technical Decisions

- **Prefer a scriptable real-video smoke over manual dashboard clicking:**
  Manual browser smoke proves presentation, but the reliability requirement
  needs a repeatable command that can render and probe real MP4 outputs.
- **Use public Mux playback for byte work:** crop-worker can consume
  `https://stream.mux.com/{playbackId}.m3u8` directly. The smoke should avoid
  signed playback unless signing credentials are available.
- **Keep generated media outside git:** local artifact storage under
  `.tmp/artifacts/` is sufficient for proof and mirrors Manager/crop-worker
  local-dev behavior.
- **Make repair evidence observable at the artifact layer:** the smoke should
  assert attempt-specific artifact names and report metadata before relying on
  the UI.
- **Separate model uncertainty from renderer reliability:** if live Mastra QA
  cannot deterministically create a repair-triggering issue, the smoke may use a
  deterministic repair fixture to force attempt 1 while still rendering real
  Mux bytes through crop-worker.

---

## Implementation Units

### U1. Real short-video source discovery

- **Goal:** Identify a short public Mux playback id from the Manager library
  that can be used safely for repeatable local Smart Crop smoke tests.
- **Files:** `apps/manager/src/app/api/videos/route.ts`,
  `apps/manager/src/app/api/smart-crop/videos/[coreId]/route.ts`,
  `apps/manager/src/features/smart-crop/smart-crop-screen.tsx`,
  `apps/manager/src/cms/mock-seed.ts`.
- **Patterns:** Reuse the existing video library read model and Shorts/Smart
  Crop picker assumptions. Do not hardcode private credentials into source.
- **Test Scenarios:** Candidate playback URL returns a playable HLS manifest;
  the selected source is short enough for a bounded local render; missing or
  signed-only playback produces a clear skip/failure reason.

### U2. Scriptable crop-worker real-video smoke

- **Goal:** Add or use a repo-local smoke path that writes a minimal real crop
  plan, invokes crop-worker render jobs against a real Mux HLS source, and
  probes the output MP4.
- **Files:** `apps/crop-worker/src/render.ts`,
  `apps/crop-worker/src/routes/jobs.ts`, `apps/crop-worker/CLAUDE.md`,
  optional smoke scripts under `apps/crop-worker/scripts/` or
  `apps/manager/scripts/`.
- **Patterns:** Use local artifact storage with
  `CROP_WORKER_LOCAL_ARTIFACTS_DIR` and avoid committing generated artifacts.
  Prefer existing crop-worker HTTP contracts over duplicating renderer logic.
- **Test Scenarios:** Preview render produces attempt 0 evidence; attempt 1
  render uses an attempt-specific plan artifact and suffix; full render writes
  `smart-crop-output-9x16.mp4`; `ffprobe` confirms 1080x1920 output.

### U3. Real-video attempt manifest and review proof

- **Goal:** Ensure every rendered repair loop is represented in the Manager job
  detail player with artifact-backed attempt data rather than mock-only state.
- **Files:** `apps/manager/src/features/smart-crop/smart-crop-plan-review-player.tsx`,
  `apps/manager/src/features/smart-crop/smart-crop-job-detail.tsx`,
  `apps/manager/src/cms/mock-seed.ts`, `apps/manager/src/lib/job-artifacts.ts`.
- **Patterns:** Reuse the attempt manifest as the UI source of truth. Keep
  legacy single-plan jobs rendering.
- **Test Scenarios:** Browser smoke shows at least two attempts, switching
  attempts changes the crop overlay, shot chapter buttons are present, QA issues
  are visible, and approve sends the selected attempt index plus digest.

### U4. Reliability diagnostics and docs

- **Goal:** Document the real-video smoke and make its failures useful for
  operators or agents running it later.
- **Files:** `docs/plans/2026-06-17-001-feat-smart-crop-real-video-reliability-plan.md`,
  `apps/crop-worker/CLAUDE.md`, `apps/manager/CLAUDE.md`,
  `docs/roadmap/media-generation/feat-173-smart-crop-video-reframing.md`.
- **Patterns:** Record commands and expected artifacts in package guides, not in
  fragile chat-only instructions.
- **Test Scenarios:** Missing FFmpeg, unreachable Mux URL, missing local shared
  artifact directory, worker queue failure, and output probe failure each surface
  a named reason.

---

## Acceptance Examples

- AE1. Given a short public Mux library source, when the smoke runs, then local
  artifact storage contains attempt 0 preview/report/frame artifacts, attempt 1
  preview/report/frame artifacts, an attempts manifest, and a full output MP4.
- AE2. Given a repair-triggering QA condition, when attempt 1 is rendered, then
  attempt 0 artifacts remain intact and the attempt manifest references both
  attempts.
- AE3. Given the selected repaired attempt, when the full render runs, then
  `ffprobe` reports a 1080x1920 cropped MP4 with non-zero duration.
- AE4. Given Manager loads the resulting job detail page, when a reviewer
  switches attempts, then the original-video crop overlay, shot chapter controls,
  preview video, and QA report update together.

---

## Verification

- `pnpm --filter @forge/manager exec tsc --noEmit --pretty false`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager test -- smartCrop.test.ts mastra-smart-crop.test.ts job-artifacts.test.ts smart-crop-plan-player.test.ts approve/route.test.ts mux.test.ts`
- `pnpm --filter @forge/crop-worker test -- render.test.ts routes/jobs.test.ts crop-plan.test.ts`
- `pnpm --filter @forge/crop-worker typecheck`
- `pnpm --filter @forge/crop-worker lint`
- `pnpm --filter @forge/mastra test -- smart-crop-repair.test.ts smart-crop-plan.test.ts smart-crop-qa.test.ts planner.test.ts`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- Real short-Mux smoke: render attempt 0 preview, render attempt 1 preview,
  render selected-attempt full output, and probe the full MP4 dimensions.
- Browser smoke: open the Smart Crop job detail page for the real-video smoke
  artifacts and capture visual proof of attempt switching, crop overlay, and
  shot chapters.

---

## Sources / Research

- `docs/plans/2026-06-16-003-feat-smart-crop-repair-loop-plan.md` defines the
  attempt manifest, repair decision table, and operator review contract.
- `docs/plans/2026-06-09-002-feat-smart-crop-plan.md` defines the original
  crop-worker, Manager, and Mastra Smart Crop contracts.
- `docs/roadmap/media-generation/feat-173-smart-crop-video-reframing.md`
  identifies the active Smart Crop entry points.
- `apps/crop-worker/CLAUDE.md` documents local shared artifact storage and the
  FFmpeg/Mux source protocol assumptions.
- `apps/manager/src/services/mux.ts` defines the public Mux playback URL
  pattern used by the smoke.
