---
id: "feat-472"
title: "tvOS native Swift player experiment"
owner: "ekkasit"
priority: "P0"
status: "in-progress"
start_date: "2026-08-28"
duration: 3
depends_on: []
blocks:
  - "feat-473"
tags:
  - "tv"
  - "tvos"
  - "video-player"
  - "swift"
  - "experiment"
---

## Problem

The React Native player has real-device-only tvOS focus and remote interaction
failures that the simulator does not reproduce. We need a native AVKit path to
compare without removing or destabilizing the existing player.

## What To Build

1. Keep the current React Native player as the default and unchanged fallback.
2. Add an Apple-only native Swift player backed by `AVPlayerViewController`.
3. Add a persisted Settings toggle that selects the player for new playback.
4. Preserve playback URL, Resume, progress saving, meaningful-watch capture,
   language switching, external subtitles, Explore scenes/questions, Up Next,
   completion, errors, and Back dismissal.
5. Keep Android TV on the existing player.

## Constraints

- No replacement or removal of `VideoPlayer.tsx`.
- No Expo SDK upgrade.
- CMS URLs must still pass the existing JavaScript validation boundary.
- The experiment remains opt-in until physical Apple TV parity is proven.

## Verification

- Unit tests for preference parsing and player selection.
- TV typecheck, lint, and full Jest suite.
- Signed tvOS simulator and physical Apple TV builds.
- Physical device comparison of Resume focus, scrubbing, language, subtitles,
  Explore, progress persistence, Up Next, and Back.

## Review follow-up (2026-09-10)

PR #2222 review fixes cover full-workspace TV type resolution, batched initial
resume props, obsolete item/subtitle callbacks, dub watch-credit baselines, and
Apple-only Settings visibility. Local checks do not complete the physical QA
above: Office Apple TV is unavailable, so this ticket remains in progress.
