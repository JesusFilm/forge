---
id: "feat-900"
title: "Mobile mini player can float paused after a playing page closes"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-29"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
---

## Problem

In 2 release check session tries on the iPhone SE simulator on 2026-10-28, the viewer left a watch page while its video played, and the mini player showed with its play button (paused). It did not report playing within 15 to 20 seconds:

- `play-video`: a seek, then a tap on Play, then Go back.
- `open-video-a-then-b`: video A autostarted from a deep link, then Go back.

The full release run of 2026-10-27 (commit `87dd478d2`) never showed it. The build in those tries also held commit `ab743166d`, a watch page change that was reverted in `c848b1ff5`. So first check whether the defect exists without that change.

## Entry Points — Read These First

1. `apps/mobile/src/components/watch/PlaybackHost.tsx`: the detach path, window admission, and what happens to the player when the slot goes.
2. `apps/mobile/src/components/watch/MiniPlayerWindow.tsx`: the window's accessibility label ("Mini player, <title>, playing").
3. `apps/mobile/src/hooks/useManagedVideoPlayer.ts`: the pause paths (AppState, ownership changes).
4. `apps/mobile/release-check/journeys/play-video.yaml` and `open-video-a-then-b.yaml`.

## Grep These

```bash
rg -n "pause\(\)" apps/mobile/src/components/watch apps/mobile/src/hooks/useManagedVideoPlayer.ts
rg -n "Mini player" apps/mobile/src/components/watch apps/mobile/src/i18n
```

## What To Build

- Reproduce the defect on a build of `main`: try `play-video` and `open-video-a-then-b` 5 times each on `iphone-se` through `session try`.
- If it reproduces, find what pauses the player on the detach, or why the window reads a loading video as paused, and fix it.
- If it does not reproduce, close this ticket and name the reverted change as the cause.

## Constraints

- A video that has not started stays hidden and paused (AE10).
- Do not change the window's label text. The journeys and screen readers read it.

## Verification

- Device: 5 of 5 tries of each journey on `iphone-se` show "Mini player, ..., playing" after the page closes.
- The full mobile jest suite passes.
