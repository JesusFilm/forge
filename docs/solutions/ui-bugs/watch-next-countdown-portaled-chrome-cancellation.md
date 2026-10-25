---
title: "Watch Next countdown must cancel through portaled player chrome"
date: "2026-07-03"
category: docs/solutions/ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "The Watch Next CTA could auto-advance after the user interacted with portaled player controls during the final five seconds"
  - "Seeking into the final five-second window could look like a countdown even though the user did not naturally cross the threshold"
  - "Cancelling one final-window pass could prevent a later natural threshold crossing from arming again"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - apps/web/src/components/watch/HeroPlayer.tsx
  - apps/web/src/components/watch/HeroPlayerControls.tsx
  - apps/web/src/lib/content.ts
  - apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx
  - apps/web/src/lib/__tests__/content-watch-merge.test.ts
tags:
  - watch-page
  - hero-player
  - watch-next
  - player-chrome
  - portal
  - mux
  - regression-test
---

# Watch Next countdown must cancel through portaled player chrome

## Problem

The Watch page needed a `Next Episode` CTA during the final five seconds of
chapter or episode playback. The CTA should auto-advance only when playback
naturally crosses into that final window, but any user interaction with the
player should cancel the current auto-advance pass and leave the CTA as a
manual action.

The tricky part is that Watch player controls do not all live inside the sticky
hero wrapper. `HeroPlayerControls` portals the custom chrome into the
`overlayAnchor`, so wrapper-only event capture misses interactions with the
actual play, timeline, mute, language, and fullscreen controls.

## Symptoms

- A wrapper-level `onPointerDownCapture` cancelled clicks on the video surface,
  but did not see pointer/key events from the portaled chrome bar.
- A user could pause or scrub via custom chrome in the final five seconds and
  still be navigated when `ended` fired.
- Seeking directly into the final window had to show a manual CTA, not arm the
  auto-advance countdown.
- After cancellation, moving back outside the final window and naturally
  crossing the threshold again had to re-arm auto-advance.

## What Didn't Work

- Treating `duration - currentTime <= 5` as the whole state machine was too
  broad. It cannot distinguish natural playback from a seek into the window.
- Cancelling auto-advance with a video-scoped `manual` flag was too sticky. It
  prevented a later legitimate threshold crossing on the same video from
  arming again.
- Listening only on the `HeroPlayer` wrapper repeated a known portal trap from
  the custom chrome implementation: portaled DOM is a sibling of the wrapper,
  not a descendant, so native events from the chrome do not bubble through the
  wrapper.

Session history search found no older repo-matching sessions beyond this PR's
review agents. The strongest prior context was the existing custom chrome
solution doc, which already documents the wrapper-versus-anchor portal trap.

## Solution

Model Watch Next as a per-pass state machine:

- `armed`: natural playback crossed from outside the final five-second window
  into it while the media was playing.
- `manual`: the current pass was cancelled by user interaction or by seeking
  into the final window.
- `null`: the playhead is outside the final window, so a future crossing can
  arm a fresh pass.

`HeroPlayer` tracks previous playback position and only arms on a forward
`timeupdate` crossing:

```ts
const crossingCountdownThreshold =
  eventName === "timeupdate" &&
  previous != null &&
  previous.duration > 0 &&
  previous.remainingSeconds > WATCH_NEXT_WINDOW_SECONDS &&
  remainingSeconds >= 0 &&
  remainingSeconds <= WATCH_NEXT_WINDOW_SECONDS &&
  currentTime >= previous.currentTime &&
  !player.paused &&
  !seekInProgressRef.current &&
  !suppressNextThresholdRef.current
```

When the playhead leaves the window, clear the mode so cancellation applies
only to the current pass:

```ts
if (currentModeApplies && outsideCountdownWindow) {
  watchNextModeRef.current = null
  setWatchNextModeState(null)
}
```

Thread the same cancellation callback into the portaled chrome:

```tsx
<HeroPlayerControls
  player={player}
  playerRef={playerRef}
  wrapperRef={wrapperRef}
  overlayAnchor={overlayAnchor}
  onWatchNextInteraction={cancelWatchNextAutoAdvance}
/>
```

Inside `HeroPlayerControls`, capture pointer and keyboard interaction on the
custom chrome bar:

```tsx
<div
  data-testid="hero-player-custom-chrome"
  onPointerDownCapture={onWatchNextInteraction}
  onKeyDownCapture={onWatchNextInteraction}
>
```

The CTA click itself remains exempt from wrapper cancellation so accepting the
next item still navigates.

## Why This Works

The threshold crossing check encodes the product distinction between playback
arriving at the final window and the user placing the playhead there. That
prevents scrubbing into the last five seconds from arming an automatic
navigation.

The mode reset on leaving the window makes cancellation local to the current
final-window pass. This matches video behavior: if the user backs up and then
lets playback naturally cross the threshold again, the countdown should be
eligible again.

The chrome callback fixes the portal boundary. React props still flow from
`HeroPlayer` to `HeroPlayerControls`, but DOM events from the portaled chrome
must be handled where that DOM actually lives.

## Prevention

- When adding player-level interaction semantics, audit both the sticky hero
  wrapper and `HeroPlayerControls`' portaled `overlayAnchor` DOM.
- Add regression coverage for wrapper surface interaction and portaled chrome
  interaction separately. A passing wrapper test does not prove the chrome
  path works.
- For video threshold features, store the previous playback sample and assert
  transition behavior, not just current position.
- Cover seek-in-window, cancel-and-rearm, natural end auto-advance, and manual
  button click paths in `HeroPlayer.test.tsx`.
- For auto-navigation targets, build the next item server-side from playable
  child snapshots and skip unplayable siblings.

## Related Issues

- [Mux Player + custom React-rendered chrome pattern](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) documents why portaled chrome requires listeners on both the wrapper and the overlay anchor.
- [PR #1457](https://github.com/JesusFilm/forge/pull/1457) adds the Watch Next countdown and regression coverage.
