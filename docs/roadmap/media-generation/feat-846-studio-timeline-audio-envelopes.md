---
id: "feat-846"
title: "Timeline audio volume and curved fades"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, audio]
---

## Scope

Direct audio clip controls for gain (-infinity through +30dB), fade-in/out lengths
and independently curved fades, including the linked source-audio projection.
Remove inspector volume controls. Persist optional audio envelope fields through
Studio's neutral composition contract and apply the same envelope to browser
preview and final rendering. Existing documents retain unity/no-fade defaults.

## Entry points

- `packages/studio-contracts/src/index.ts`, new `src/audio.ts`
- `packages/shorts-compositions/src/studio/Composition.tsx`
- `apps/manager/src/features/video-studio/timeline.tsx`, new audio controls
- `apps/manager/src/features/video-studio/inspector.tsx`, `studio.css`

## Plan

`docs/plans/2026-10-20-studio-audio-envelopes.md`

## Verification

Contract validation/envelope math, gesture persistence and undo, preview/export
wiring including amplification above unity, real playback/render audio probe,
loading/media identity checks and scope lint/typecheck/format.

## Result

Added `AudioClipControls` for linked video audio and standalone audio. Fade edge
handles change duration, circle handles bend each fade, and the volume line uses
+30 dB through -60 dB with exact silence at the bottom. Double-click resets;
keyboard arrows/Home/End are available. Pointer drafts commit one undo step and
cancel cleanly without moving/trimming the clip. Removed inspector levels.

- Contracts: 55 tests; compositions: 74 tests, including preview/render wiring.
- Manager: 16 gesture/session/numeric tests, 15 timeline/waveform/pause checks,
  7 preview-state checks. Admin: 5 operation/focus/property consumer checks.
  Admin's partial dependency installation required a temporary external Vitest
  config pointing to actual workspace sources; no repository config was changed.
- Manager, contracts and compositions typechecks and scoped lint pass; formatting
  and `git diff --check` pass.
- Browser: linked fade lengths/curves, +30 dB and exact mute preserve source
  identity/timing and leave standalone music unchanged. No additional metadata,
  thumbnail or waveform requests during envelope edits; fixture DOM/load timings
  were 268/270 ms, with no new initialization or media dependency.
- Quiet-tone playback measures the expected 31.6x gain for audio and HLS video.
  Actual Studio WAV exports measure 29.98 dB versus unity; linear fade midpoints
  are approximately half-level. Video export also preserves the fade envelope.
- Existing remote preview fonts return HTTP 200 and HMR connects.

Hosted persistence requires matching Admin and renderer contract revisions via
normal PR-to-main deployment; this task did not deploy production services.
Durable notes: `docs/solutions/runtime-errors/studio-audio-envelope-gain.md`.
