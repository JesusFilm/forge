---
title: "A system-cancelled drag is not the viewer's choice: ending a part on a responder terminate played the next video in the background"
date: "2026-10-14"
category: logic-errors
module: apps/mobile
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "The viewer drags the Daily Bible Pause timeline across a part's stop, then presses Home. The next part starts while the app is in the background"
  - "With expo-video background playback on, the next part plays where the viewer cannot see it, and on a device it is audible"
  - "Every jest test passed, because no test cancelled a drag that waited at the stop"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - panresponder
  - responder-terminate
  - touch-cancel
  - background-playback
  - expo-video
  - scrubber
  - daily-bible-pause
---

# A system-cancelled drag is not the viewer's choice: ending a part on a responder terminate played the next video in the background

## Problem

In the Daily Bible Pause, a video part that reaches its stop under a dragging finger waits there, and the release decides what happens. The first draft of this change, never committed, also ended the part when the system cancelled the drag (`onPanResponderTerminate`). Home, a lock, or a call cancels the touch. So the run moved on while the app left the screen, and the next part played in the background.

## Symptoms

- On the iPhone 17 simulator, a drag held across the film part's stop was cancelled by Home. The next part started 0.5 s after the cancel, with the app in the background.
- After 12 s away, the next part was at 13 s. `app.json` sets expo-video `supportsBackgroundPlayback: true` (line 67), so a device plays that sound from a locked phone or from behind another app.
- The jest suite stayed green. The only test of a cancel at the stop checked that the part ended, which was the defect.

## What Didn't Work

- **The rule "a cancelled drag ends the part".** It looked symmetrical with a release at the end of the bar. But a release is the viewer's choice, and a cancel is not.
- **The code review's prediction of the failure.** An adversarial reviewer flagged the rule and predicted a different outcome. It expected the next part's start backstop to fire after 8 s away and to show "Try again". On the simulator the next part did not wait: its player could play in the background, so it started at once. Only the simulator run showed the real outcome.

## Solution

The fix is in `apps/mobile/src/components/dailyPause/PartPlayer.tsx`, on the branch `Ur-imazing/pause-devo-feature-polish` (PR #2717 into `Ur-imazing/pause-devo-feature`, open at the time of writing). A cancel while the part waits at its stop holds the part, and the Resume cue shows:

```ts
// PartPlayer.tsx:494-499, in the drag-end handler
else if (parked) {
  // The system took the drag (Home, a lock, a call), so the part holds
  // at its stop. Nothing plays until the viewer taps (KTD9).
  held = true
  publish()
}
```

The tap on that held part ends it at once. It does not play from the stop, because that would let sound from past the stop through (KTD8):

```ts
// PartPlayer.tsx:436-442, in the tap handler
// A part held at its stop ends on the tap. A play from there would
// sound past the stop (KTD8).
if (parked) {
  parked = false
  stop()
  return
}
```

The bar sends `onScrubEnd(null)` for a terminate (`PartProgressBar.tsx:110-113`), so the part player is the one place that decides.

Simulator retest, with the same steps as the failure:

- Return after 12 s away: the film part waits at its stop (25 of 26 s) with the Resume cue, and it stays there.
- A tap: the film part ends, and the next part plays from its start.
- A normal drag across the stop, released inside the part: it seeks to that place and plays on.

## Why This Works

A terminate means that something else took the touch: the system, another responder, or the app leaving the foreground. On the simulator, the terminate arrived at the moment Home was pressed, before the app reached the background. Any media action in that handler therefore runs while the app goes away. With background playback on, a `play()` there keeps sounding.

The hold moves the decision back to the viewer. A held part sends no sound, and only a tap moves the run on.

## Prevention

- **Treat a terminate as "undo", never as a choice.** Restore what the screen shows, and do not seek, play, or advance. Explore's bar does this (`apps/mobile/src/components/explore/ClipProgressBar.tsx:210-215` shows the playing time again). The watch page's bar does too (`apps/mobile/src/components/watch/Scrubber.tsx:186-190` ends the scrub with no seek).
- **If a terminate leaves a state that needs a decision, hold and wait for a tap.** A held state is safe in the background. An advance is not.
- **Ask of every `play()` path: can it run while the app is in the background?** With `supportsBackgroundPlayback: true`, the answer decides whether a bug is silent or audible.
- **Test the cancel, not only the release.** The PanResponder harness in `PartPlayer.test.tsx` calls `onResponderTerminate` directly. The test at line 1234 checks a release at the end of the bar. The test at line 1246 checks a cancel: the part holds, and a tap ends it.
- **Reproduce on the simulator with a long drag and Home.** Start `idb ui swipe` with a long `--duration` in the background, then send `idb ui button HOME` during the drag. A temporary `console.log` in the `playingChange` listener shows the order of the events in the Metro log.

## Related Issues

- `docs/solutions/ui-bugs/panresponder-slider-in-ios-formsheet-loses-drifting-drags.md`: another cause of a terminate (a UIKit sheet or scroll gesture takes the touch).
- `docs/solutions/ui-bugs/nested-scrollview-in-panresponder-pager-slow-drag-moves-feed.md`: a nested responder and termination requests in the Explore pager.
- `docs/solutions/logic-errors/android-pip-appstate-latch-ordering-force-resume.md`: another case where a paused video starts after the app leaves the screen.
- `docs/solutions/integration-issues/expo-video-ios-playback-rate-write-starts-paused-player.md`: another way a paused Pause part could start by itself.
