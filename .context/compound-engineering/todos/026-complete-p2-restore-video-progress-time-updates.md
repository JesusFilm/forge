---
status: complete
priority: p2
issue_id: "026"
tags: [code-review, video-player, regression, ui]
dependencies: []
---

# Restore Video Progress Time Updates

## Problem Statement

The shared `useVideoPlayerCore` hook no longer updates the progress slider value or elapsed/duration text while playback is running. The previous web video components had a `requestAnimationFrame` loop that refreshed those controls, so moving playback logic into the shared hook regressed the visible player controls in both `apps/web` and the manager review player.

## Findings

- `packages/video-player/src/useVideoPlayerCore.ts:222` updates duration on `durationchange`, but there is no replacement for the old RAF loop that read `player.currentTime()` while playing.
- `apps/web/src/components/sections/Video.tsx` and `apps/web/src/components/sections/CarouselVideo.tsx` now delegate to the shared hook, so the regression applies to the public web players too.
- Existing hook tests cover source reuse, text tracks, and controls, but not time/progress advancement during playback.

## Proposed Solutions

### Option 1: Reintroduce the RAF Loop in the Shared Hook

**Approach:** Add an effect keyed by `isPlaying` that updates `sliderRef.current.value` and `timeRef.current.textContent` from `player.currentTime()` / `player.duration()`.

**Pros:**

- Restores existing behavior for both web and manager consumers.
- Keeps timing behavior centralized with the player state.

**Cons:**

- The hook continues to manipulate DOM refs directly.

**Effort:** 30-60 minutes

**Risk:** Low

### Option 2: Return Current Time State from the Hook

**Approach:** Track current time/duration in React state and let consumers render the slider and label.

**Pros:**

- More declarative.
- Easier to test at the component boundary.

**Cons:**

- Larger refactor across consumers.
- More React re-render pressure during playback.

**Effort:** 2-3 hours

**Risk:** Medium

## Recommended Action

Completed Option 1: restored the requestAnimationFrame playback UI sync loop in the shared hook and covered it with a regression test.

## Technical Details

**Affected files:**

- `packages/video-player/src/useVideoPlayerCore.ts`
- `packages/video-player/src/useVideoPlayerCore.test.tsx`
- `apps/web/src/components/sections/Video.tsx`
- `apps/web/src/components/sections/CarouselVideo.tsx`
- `apps/manager/src/features/jobs/review-player/review-player-card.tsx`

## Resources

- Review finding from workflows-review on 2026-04-12.

## Acceptance Criteria

- [x] Progress slider advances while a video is playing.
- [x] Time label updates while a video is playing.
- [x] Unit test covers current-time UI updates in `useVideoPlayerCore`.
- [x] Web and manager player smoke checks still pass.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Compared the previous web component RAF update loop with the new shared hook.
- Confirmed the shared hook only resets or sets duration; it does not poll current playback time.

**Learnings:**

- Shared UI hooks need regression tests for behavior inherited from each consumer, not just new behavior.

### 2026-04-12 - Review Fix

**By:** Codex

**Actions:**

- Added a regression test proving the slider and time label advance when the player clock moves during playback.
- Restored playback UI syncing through a requestAnimationFrame loop in `useVideoPlayerCore`.
- Verified with `pnpm --filter @forge/video-player test` and a manager browser smoke.

**Learnings:**

- The shared hook should own inherited player control behavior so both web and manager consumers stay in sync.
