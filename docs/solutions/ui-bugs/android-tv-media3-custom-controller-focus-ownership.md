---
title: "Android TV Media3 custom controller focus ownership"
date: "2026-09-02"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: native_android_player
symptoms:
  - "Media3 stock controls trap D-pad focus on the Settings gear and cannot reach app-owned Audio, Subtitles, or Explore controls"
  - "A custom native overlay added as a second ExpoView child receives zero width"
  - "Select on a custom transport button both seeks and toggles playback"
  - "Seeking moves focus away from the scrubber while Media3 buffers"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - android-tv
  - chromecast
  - media3
  - exoplayer
  - dpad-navigation
  - focus
  - native-view
---

# Android TV Media3 custom controller focus ownership

## Problem

`PlayerView`'s stock controller is designed around a touch-sized Media3 layout,
not the app's TV focus graph. Its spatial navigation moved Up from Play/Pause to
the stock Settings gear and then stayed trapped there. The duration was also
clipped for hour-long media.

Moving app-owned controls into a custom overlay exposed three less obvious
native composition failures:

1. `ExpoView` laid out its first native child full-screen but placed a second
   unmanaged child at zero width.
2. Nesting custom buttons inside `PlayerView` let `PlayerView.dispatchKeyEvent`
   intercept Select before the focused button, so one press could both seek and
   toggle playback.
3. `Player.isPlaying` becomes false during an ordinary seek while
   `playWhenReady` remains true. Treating `isPlaying == false` as Pause stole
   focus from the scrubber on every buffer transition.
4. A React Native details control can reclaim focus after a session/source
   refresh even while the native player still covers the screen. The chrome is
   visible, but remote events go to the hidden React surface behind it.

## Solution

Use one full-screen `FrameLayout` as the only direct child of the Expo module
view. Add `PlayerView` first and the custom controller overlay second as sibling
children of that frame. Keep `PlayerView` non-focusable and give the module root
focus only while the overlay is hidden.

The custom controller owns an explicit focus graph:

- Transport Left/Right moves between −10, Play/Pause, and +10.
- Transport Right continues into Start Over, Explore, Language, and Subtitles.
- Transport Up moves to the top-left Back pill.
- Transport Down moves to the progress bar.
- The focused progress bar consumes Left/Right as preview adjustments instead of
  focus moves; Select commits once, while Back or Up cancels the candidate.

For React-player parity, use the scrubber as the default target whenever hidden
chrome is revealed. The first hidden Select, direction, or Back press reveals
chrome without performing its action; the next press acts. Keep the same
3.5-second timer, 100/150 ms reveal-hide timing, elapsed/remaining labels,
circular transport controls, bottom three-column layout, and centered dark
option sheets with white-fill rows and a focusable Close action.

Use direct focus checks for the hidden controller surface. `hasFocus()` on a
parent is also true when any descendant has focus; `isFocused` distinguishes the
module root from a focused child control.

Use `playWhenReady` to distinguish Pause from buffering. Buffering keeps the
current focus and cancels the hide timer; actual Pause reveals the controls.
When asynchronously supplied actions become hidden, move focus to Play/Pause so
Android never retains focus on a zero-size hidden button.

Register a global focus-change listener while the native view is attached. If
focus leaves the native player while its window is active and no native dialog
is open, restore the last visible control or the hidden-controller root. Remove
the listener on detach/release so normal route dismissal can hand focus back to
React Native. Treat a focus target as usable only when it is shown and has
non-zero width and height; dynamic actions can briefly be visible before their
TV layout has measurable bounds.

## Follow-up: native layout, captions, and asset lifetimes

Inflate the Media3 `PlayerView` with `surface_type="texture_view"`. The default
SurfaceView produced advancing audio with a black picture in the Expo-hosted
Chromecast view. Set `shouldUseAndroidLayout = true` on the ExpoView: otherwise
dynamic native captions can remain zero-sized despite valid text. Keep focusable
ancestors unclipped so the 1.07x focus scale is not cropped.

Load and parse VTT separately from the video item. Match `parseVtt.ts` broadcast
offset normalization and cue-setting handling, and update captions against the
actual native playhead. Selecting subtitles no longer re-prepares HLS. Clear old
cues immediately, cancel the prior request, and discard late generations.

Scrubbing owns candidate state separately from ExoPlayer. The candidate changes
the thumb, timestamp, and cached Mux tile, never playback reporting or committed
progress. Cancel restores playback intent without a seek. Guard source switches,
Home/background, and media keys against leaving a candidate active.

Native dimensions use the 1920-wide reference rather than Android density alone.
Round menu width upward: flooring fractional measured text at 720p caused complete
labels such as Language and Subtitles to be unnecessarily ellipsized.

Bind session menus by explicit video identity when available. A seed URL can be
playing before stored language preferences resolve, so matching only the active
dub URL can leave all session menus hidden. Identity-free playback retains the
original source-match boundary to exclude stale sessions.

Do not diagnose missing captions at an arbitrary paused timestamp. In the JESUS
Afrikaans VTT, 29:01 falls between 28:57.010 and 29:02.350; the cue at
20.000–22.540 seconds is an actual rendering fixture.

## Physical checks

On physical Chromecast `sabrina`, inspect `dumpsys activity top` after every
D-pad move. The view flags expose native focus even when a screenshot's focus
ring is ambiguous. Verify that:

- hidden chrome focuses the module root;
- Up/Down/Left/Right reaches each visible control;
- +10 and −10 keep playback intent unchanged;
- seeking keeps the progress bar focused through buffering;
- Audio and Subtitles dialogs open from one Select and Back restores focus;
- a subtitle source change preserves position;
- Back dismisses the player to details.
