---
id: "feat-474"
title: "tvOS UIKit Mux storyboard player chrome"
owner: "ekkasit"
priority: "P0"
status: "in-progress"
start_date: "2026-09-02"
duration: 2
depends_on:
  - "feat-473"
blocks: []
tags:
  - "tv"
  - "tvos"
  - "video-player"
  - "swift"
  - "uikit"
  - "mux"
  - "scrubbing"
---

## Problem

Review status (2026-09-10): repeated touchpad gestures now start from the current
candidate, and leaving the timeline cancels the preview. Regression guards and
tvOS SDK typechecking pass; physical Siri Remote verification remains pending
because Office Apple TV is unavailable.

AVKit owns a stable playback engine but does not expose the uncommitted candidate
time from its native timeline. The existing post-seek preview therefore cannot
follow the Siri Remote touch surface before playback commits to a new position.

## What To Build

1. Keep `AVPlayer` and `AVPlayerViewController` as the playback engine while
   hiding AVKit's visible playback controls.
2. Render native UIKit playback chrome with tvOS focus, blur, system fonts,
   symbols, accessibility, and auto-hide behavior.
3. Keep committed playback progress separate from an uncommitted candidate time.
4. Update the candidate thumb, time label, and Mux storyboard thumbnail during
   touch-surface movement without seeking the player.
5. Commit exactly one seek on Select and cancel back to the original position on
   Menu/Back.
6. Preserve source switching, Resume, separate Audio and Subtitle search menus,
   Explore, Up Next, errors, and player dismissal.

## Constraints

- The existing React Native player remains unchanged and is still the fallback.
- Apple TV only; Android TV remains on the existing player.
- Storyboard metadata and sprites remain restricted to HTTPS `image.mux.com`.
- The committed red progress bar and gray track do not move while previewing.
- Do not report continuous scrub success without physical Siri Remote evidence.

## Verification

- Guard tests for custom chrome ownership and candidate-versus-committed state.
- TV typecheck, lint, and focused/full Jest suites.
- Signed tvOS Release build on physical Apple TV.
- Physical Apple TV: swipe across the timeline, confirm thumbnails change while
  committed progress remains fixed, Select seeks once, and Back cancels.
- Physical Apple TV: verify Play/Pause focus, skip, Audio, Subtitles, Explore,
  source switching, Resume, Up Next, errors, auto-hide, and dismissal.

## Verification Results

- `pnpm --filter @forge/tv typecheck` and `pnpm --filter @forge/tv lint` pass.
- All 126 TV Jest suites pass with 1,868 tests.
- Signed Release build, including the production JavaScript bundle, installs and
  launches on the Office Apple TV 4K.
- Physical Siri Remote D-pad and touch-surface tests show the candidate thumb,
  time, and Mux thumbnail moving while the committed red progress stays fixed.
- Select commits the candidate once; Menu cancels the candidate and resumes from
  the committed position; a subsequent Menu press dismisses the player normally.
- Controls reveal with Play/Pause as the primary transport action, remain visible
  during an active scrub, and auto-hide after eight seconds during playback.
- Durations over one hour render as `hours:minutes:seconds`.
