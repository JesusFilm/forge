---
id: "feat-473"
title: "tvOS native Swift scrub thumbnails"
owner: "ekkasit"
priority: "P0"
status: "complete"
start_date: "2026-09-01"
duration: 1
depends_on:
  - "feat-472"
blocks:
  - "feat-474"
tags:
  - "tv"
  - "tvos"
  - "video-player"
  - "swift"
  - "mux"
  - "scrubbing"
---

## Problem

The opt-in native Swift player shows AVKit's time scrubber but no visual frame
preview while the viewer moves through a long video. Mux HLS manifests do not
currently provide the I-frame playlists AVKit requires for automatic trick-play
previews, although the same assets expose Mux storyboard metadata and sprites.

## What To Build

1. Derive a validated Mux storyboard URL from the active playback URL in JavaScript.
2. Load and validate the storyboard metadata and sprite inside the displayed
   native player instance.
3. Show the matching cropped storyboard tile above AVKit's timeline while the
   viewer scrubs, without changing the committed playhead merely to render a preview.
4. Hide the preview after navigation settles, playback resumes, the source
   changes, or the native player is removed.
5. Keep non-Mux playback functional with no preview.

## Constraints

- Apple TV native Swift player only; do not change Android TV.
- Accept only HTTPS storyboard metadata and sprite URLs on `image.mux.com`.
- Cancel stale requests and never apply a prior dub's storyboard to a new source.
- Preserve subtitle rendering, language switching, Back dismissal, and native controls.

## Verification

- Native parser and crop-selection unit coverage.
- TV typecheck, lint, and full Jest suite.
- Signed Release build for the physical Apple TV.
- Physical Apple TV: play JESUS, reveal the timeline, scrub in both directions,
  confirm the thumbnail changes with the target position, and confirm playback
  resumes at the selected time.
