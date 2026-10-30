---
id: "feat-898"
title: "Mobile watch page counts the last video's playback as its own start"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-29"
duration: 3
depends_on: []
blocks: []
tags:
  - "mobile"
---

## Problem

When the viewer opens video B while video A plays in the floating window, the root player keeps playing A until B's source applies. B's watch page takes that playback as its own start: it hides the poster and the autostart veil and shows the `player-first-frame` marker at once. When the viewer leaves B's page within about 1.5 seconds, no mini player shows, because the host has not seen B start.

Found by the release check (feat-798): `open-video-a-then-b` failed 2 of 3 session tries on the iPhone SE simulator on 2026-10-28, and its "Video B plays" step passed in about 0.1 seconds every time.

A first fix (commit `ab743166d`, reverted in `c848b1ff5`) let the page start only when the player held B's source. It did not help on the device: right after B's source applies, iOS still reports `playing` from A, because the swap keeps the player's rate.

## Entry Points — Read These First

1. `apps/mobile/src/components/watch/VideoPlayer.tsx`: `hasStarted` (the `useState` seed from `adopted`, `started` and `player.playing`, and the effect that sets it from `isPlaying`).
2. `apps/mobile/src/components/watch/PlaybackHost.tsx`: `startedRef`, `appliedSourceUrlRef`, `onSourceApplied`, and `hasPlaybackStarted`, which admits a video to the window.
3. `apps/mobile/src/hooks/useManagedVideoPlayer.ts`: the `replaceAsync` swap and where `sourceLoad` fires.
4. `apps/mobile/release-check/journeys/open-video-a-then-b.yaml`: the journey that shows the defect.
5. The reverted commit `ab743166d`: its host test (`does not count the floating video's playback as the arriving video's start`) is a starting point.

## Grep These

```bash
rg -n "hasStarted|setHasStarted" apps/mobile/src/components/watch/VideoPlayer.tsx
rg -n "hasPlaybackStarted|startedRef|appliedSourceUrlRef" apps/mobile/src/components/watch/PlaybackHost.tsx
rg -n "sourceLoad|onSourceApplied" apps/mobile/src/hooks/useManagedVideoPlayer.ts
```

## What To Build

- The watch page counts as started only after its own source loaded (`sourceLoad` for this source) and the player plays after that load. The host's window admission uses the same rule, so a page and the window never disagree.
- Keep the seeds that are correct today: `adopted` (an expand onto the video that plays) and `started` (the reader cover's return).

## Constraints

- `hasStarted` never resets on a dub swap or a download swap of the same video; keep that.
- Do not break the expand adoption (R4), the reader cover (feat-553 KTD10), or the AE10 rule that a never-played video gets no window.
- Read `apps/mobile/CLAUDE.md`, "Mini player and the root-owned playback session", first.

## Verification

- A host test with the real `VideoPlayer`: with video A playing and floating, open video B; `player-first-frame` stays absent until B's own `sourceLoad` and playback.
- Device: `node apps/mobile/release-check/cli.mjs session try open-video-a-then-b` passes 5 of 5 on `iphone-se`, and "Video B plays" no longer passes in about 0.1 seconds.
- The full mobile jest suite passes.
