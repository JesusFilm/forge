---
title: "Studio HLS cut buffering and player seek feedback"
date: "2026-09-23"
module: "Studio preview"
problem_type: runtime_error
component: frontend_stimulus
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - studio
  - remotion
  - hls
  - playback
---

# Studio HLS cut buffering and player seek feedback

Adjacent video sequences mounted only at their cut. The player advanced while the incoming HLS video had metadata or no decoded frame, producing black footage with text still visible. Paused seeks eventually looked correct. A separate player/session loop sent observed `frameupdate` positions back as `seekTo` commands; production also showed React #185 once, but that exact native crash frequency was not reproducible.

## Repair

`packages/shorts-compositions/src/studio/Composition.tsx` premounts nearby video sequences by one second. It attaches Hls in a layout effect and uses `useBufferState` to hold playback when the upcoming/current video is seeking or lacks playable data. Enable the gate just before the cut. Release the buffer token on readiness, error, and cleanup. Keep loading bounded by nearby sequences.

Do not combine this HLS attachment with Html5Video's built-in `pauseWhenBuffering`: its `.load()` recovery resets the attached MediaSource, causing native Code 4 unsupported-m3u8 errors in Chromium. The custom readiness gate avoids that recovery path.

`editor-session.ts` separates `reportPlaybackFrame` observations from `seekRequest` commands. `preview.tsx` reacts only to new seek requests, and resumes the current displayed frame when media is replaced. Idempotent observation updates prevent unnecessary external-store notifications.

## Related boundaries

- Timeline groups are presentation. Preserve persisted item/track order, which controls compositing. A legacy text item on a visual track must remain selectable in both timeline and track dropdown.
- A crossfade uses incoming source pre-roll without moving the authored cut or audio. Retain the expanded source range in Manager preview/render requests and Admin source validation. Disable ambiguous cuts and bound the handle by available source time.
- Fonts are dynamically loaded and gated in both preview and export; use frame-derived text motion so paused seeks and exported frames agree.
- Pointer capture alone did not sustain drag in the browser fixture. Scope window move/up/cancel and blur listeners to the active gesture; clamp coordinates using the scrolled content rectangle.

## Verification

See `docs/validation/studio-feedback/README.md` for the executable local HLS fixture and render case, and `results.md` beside it for baseline failures, current results, build/bundle measurements, and evidence limits. Decoded-readiness checks are distinct from exported pixel/black-detection checks. An author-intended fade-through-black is not a hard-cut playback defect.
