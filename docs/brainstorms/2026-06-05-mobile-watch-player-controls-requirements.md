---
date: "2026-06-05"
topic: "mobile-watch-player-controls"
title: "Mobile Watch Player — Auto-Hiding Chrome, Seek, and Real Fullscreen"
tags:
  - mobile
  - watch
  - video
---

## Summary

Overhaul the controls overlay ("Chrome") on the mobile watch player so it behaves like YouTube: it appears when playback starts, auto-hides after a few idle seconds, and reappears on tap. Add full seek control (drag the scrubber plus tap-to-skip forward/back). Replace the dead-end native fullscreen with an in-tree fullscreen that opens (and stays) in landscape, exposes an exit control, and renders subtitles. Every change is verified on the iOS simulator.

## Problem Frame

The watch player at `apps/mobile/app/watch/[slug].tsx` renders three layers — the `expo-video` `VideoView`, a custom `SubtitleOverlay`, and the custom `PlayerControls` Chrome (`apps/mobile/src/components/watch/VideoPlayer.tsx`). Today that Chrome is always on: `PlayerControls` is rendered unconditionally with no visibility state and no tap target on the video, so the play/pause button, scrubber, and time labels permanently cover the footage. There is no way to get an unobstructed view.

Fullscreen is a dead end for a deeper reason. The fullscreen button calls `expo-video`'s native `enterFullscreen()` (`VideoPlayer.tsx:174`) while `nativeControls={false}`. Native fullscreen presents its own layer that is detached from the app's React tree — so the custom Chrome (where an exit control would live) and the custom `SubtitleOverlay` (which renders the CMS WebVTT captions) are simply not present in fullscreen. That is why there is no way out of fullscreen and why subtitles vanish there even though they work inline.

The seek experience is also thin: the progress bar is display-only, computed from a 500ms poll (`PlayerControls.tsx:97`), with no way to scrub or jump.

## Key Decisions

- **In-tree fullscreen, not native.** Stop calling `expo-video`'s `enterFullscreen()`. Instead expand the existing player container (VideoView + SubtitleOverlay + PlayerControls) to fill the screen within the React tree. This is the single change that makes the exit control, auto-hide Chrome, drag/skip seeking, and subtitles all work identically inline and in fullscreen, because they are the same components in both modes.
- **Fullscreen locks landscape; the rest of the app stays portrait.** Entering fullscreen requests landscape and stays landscape (it does not follow the device back to portrait — see R12's revision note). Exiting re-locks to portrait. The app is portrait-locked today (`apps/mobile/app.json` → `orientation: "portrait"`), so this requires a new orientation capability and a broadening of the app's declared supported orientations — scoped so that only the fullscreen player ever rotates.
- **Auto-hide is play-state-aware.** Chrome auto-hides only while playing. While paused it stays visible (YouTube behavior). Captions remain visible even when Chrome fades, repositioning to use the freed space at the bottom.
- **Tap toggles.** A tap on the video shows Chrome if hidden (and restarts the idle timer) or hides it if visible. Interacting with a control resets the idle timer rather than hiding.
- **Skip is 10 seconds each way.** Symmetric −10s / +10s skip controls flank the center play/pause, matching YouTube's double-tap convention. (15s was floated; 10s chosen as the default.)
- **Double-tap-the-sides also seeks.** The signature YouTube double-tap gesture is included: double-tap the left/right half of the video to jump −10s/+10s. This requires single-vs-double-tap disambiguation, which adds a short (~250ms) delay to the single tap that toggles Chrome — an accepted trade-off. This is the most easily cut item if the delay proves objectionable.

## Requirements

### Auto-hiding Chrome

- R1. When playback starts, Chrome is visible, then auto-hides after a fixed idle period (≈3s) with no user interaction.
- R2. While the video is paused, Chrome stays visible and does not auto-hide.
- R3. A tap on the video toggles Chrome: if hidden, it reappears and the idle timer restarts; if visible, it hides immediately.
- R4. Tapping or dragging any control (play/pause, mute, skip, scrubber, fullscreen) resets the idle timer instead of hiding Chrome.
- R5. Chrome appears and disappears with a brief fade, not an instant cut.
- R6. Before first play (poster showing), the play affordance is visible so the user can start playback.

### Seek

- R7. The progress bar is draggable: dragging the playhead seeks the video to the corresponding position.
- R8. During a drag, the displayed position tracks the drag (the poll-driven progress does not fight the drag), and Chrome does not auto-hide mid-drag.
- R9. A −10s and a +10s skip control flank the center play/pause and jump the playback position by 10 seconds, clamped to the start and end of the video.
- R10. Double-tapping the left or right half of the video seeks −10s / +10s respectively.

### Fullscreen

- R11. Tapping the fullscreen control enters an in-tree fullscreen that fills the screen, opening in landscape.
- R12. Fullscreen is landscape-only: it opens in landscape and stays landscape (landscape-left or landscape-right as the device turns); it does not offer portrait fullscreen. _(Revised 2026-06-05 during implementation: the original "follow the device back to portrait" behavior was dropped. On iOS `unlockAsync()` immediately re-applies the device's current physical orientation, snapping a portrait-held phone straight back to portrait so the landscape nudge never takes. Locking to landscape is the robust, standard fullscreen behavior — see `apps/mobile/src/lib/orientation.ts`.)_
- R13. Fullscreen exposes an exit control (the fullscreen icon reflects the exit affordance) that returns to the inline layout and re-locks the app to portrait.
- R14. The Android hardware back gesture/button exits fullscreen rather than leaving the screen, when in fullscreen.
- R15. Entering fullscreen preserves playback state (a video playing inline keeps playing; position is unchanged); exiting likewise preserves state.
- R16. Only the fullscreen player rotates — every other screen in the app remains portrait-locked.

### Subtitles in fullscreen

- R17. When subtitles are enabled, the CMS WebVTT captions render in fullscreen, positioned legibly above the controls and clear of device safe-area insets (notch/home indicator) in landscape.
- R18. Captions remain visible in fullscreen even while Chrome is hidden.

### Verification

- R19. Each behavior above is verified on the iOS simulator before the work is reported complete (auto-hide timing, tap-toggle, paused-stays-visible, drag-seek, skip, double-tap seek, fullscreen enter/rotate/exit, captions in fullscreen).

## Key Flows

- F1. Start and idle-hide
  - **Trigger:** User taps play on the poster.
  - **Steps:** Playback starts → Chrome visible → no interaction for ≈3s → Chrome fades out → captions (if on) remain, shifted down.
  - **Covers:** R1, R5, R6, R18.

- F2. Reveal and re-hide
  - **Trigger:** Chrome is hidden during playback; user taps the video.
  - **Steps:** Chrome fades in, idle timer starts → user taps again → Chrome fades out immediately. (If user instead taps a control, timer resets and Chrome stays.)
  - **Covers:** R3, R4, R5.

- F3. Scrub and skip
  - **Trigger:** User drags the playhead, or taps a skip control, or double-taps a side.
  - **Steps:** Drag → position follows finger, Chrome stays up, release seeks. Skip control → jump ±10s clamped. Double-tap side → jump ∓/±10s.
  - **Covers:** R7, R8, R9, R10.

- F4. Enter / exit fullscreen
  - **Trigger:** User taps the fullscreen control.
  - **Steps:** Player expands in-tree to landscape fullscreen, playback continues and stays landscape → user taps exit (or Android back) → returns inline, app re-locks portrait.
  - **Covers:** R11, R12, R13, R14, R15, R16.

## Acceptance Examples

- AE1. Auto-hide only while playing.
  - **Given** the video is playing and Chrome is visible, **when** ≈3s pass with no interaction, **then** Chrome fades out. **But given** the video is paused, **when** ≈3s pass, **then** Chrome stays visible.
  - **Covers R1, R2.**

- AE2. Tap toggles, not just reveals.
  - **Given** Chrome is visible during playback, **when** the user taps the video (not a control), **then** Chrome hides immediately rather than resetting the timer.
  - **Covers R3.**

- AE3. Skip clamps at the boundaries.
  - **Given** the playhead is at 0:05, **when** the user taps −10s, **then** the position clamps to 0:00 (no negative seek). **Given** the playhead is 5s before the end, **when** the user taps +10s, **then** the position clamps to the end.
  - **Covers R9.**

- AE4. Subtitles survive the fullscreen transition.
  - **Given** subtitles are enabled and visible inline, **when** the user enters fullscreen, **then** the same captions render in fullscreen and stay clear of the landscape safe-area insets — and remain visible after Chrome fades.
  - **Covers R17, R18.**

- AE5. Exit always available.
  - **Given** the player is in fullscreen (always landscape), **when** the user taps the exit control or uses Android back, **then** the player returns to the inline layout and the app re-locks to portrait.
  - **Covers R13, R14, R16.**

## Scope Boundaries

- The legacy video-detail player at `apps/mobile/app/video/[sectionKey].tsx` (which uses `nativeControls`) is out of scope — this work targets the `/watch/[slug]` player only.
- Picture-in-picture behavior is unchanged.
- No visual redesign of the control layout beyond what the new controls (skip buttons, exit affordance, draggable thumb) require.
- Mux's auto-generated HLS subtitle tracks stay disabled (`VideoPlayer.tsx:104`); captions continue to come exclusively from the CMS WebVTT overlay.
- No new buffering, language-switch, or playback-lifecycle behavior — those paths (`replaceAsync` swap, AppState pause/resume) are preserved as-is.

## Dependencies / Assumptions

- **New dependency: `expo-screen-orientation`** (or equivalent) is required for the lock/unlock/rotate behavior. It is not currently installed.
- **`apps/mobile/app.json` orientation must broaden.** iOS only rotates to orientations declared supported in `Info.plist`; the app currently declares portrait only. Enabling landscape fullscreen means broadening the declared supported orientations while keeping every non-fullscreen screen portrait via a runtime lock. This is the main feasibility risk and must be validated early in planning.
- **Drag-to-seek needs a gesture mechanism.** Neither `react-native-gesture-handler` nor `react-native-reanimated` is installed. Assumption: the scrubber drag can use React Native's built-in `PanResponder` and the fade can use the built-in `Animated` API, adding no new gesture/animation dependency — to be confirmed in planning. (A simple fade is a single timing, not a loop, so it is unaffected by the known Fabric looped-`Animated` gotcha.)
- **`react-native-safe-area-context` is already installed** (`~5.6.0`) and is the source for landscape safe-area insets in fullscreen.
- Seeking via `expo-video` is assumed to be available by setting `player.currentTime` (used for both drag-seek and skip).

## Outstanding Questions

### Resolve during planning

- Validate the orientation approach on iOS specifically: confirm that broadening supported orientations plus a runtime portrait lock keeps non-fullscreen screens from rotating, and that fullscreen rotation is smooth on a real device/simulator.
- Confirm the gesture/animation approach (built-in `PanResponder` + `Animated`) is sufficient for a smooth draggable scrubber, or whether `react-native-gesture-handler` is warranted.

### Easily revisited

- The double-tap-to-seek gesture (R10) is the most cuttable requirement if its single-tap disambiguation delay degrades the tap-to-toggle feel. Skip buttons (R9) are the primary seek affordance regardless.
- Skip interval is set to 10s; trivially changed to 15s if preferred after feeling it in the simulator.
