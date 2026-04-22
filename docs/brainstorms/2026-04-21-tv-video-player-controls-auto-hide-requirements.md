---
date: 2026-04-21
topic: tv-video-player-controls-auto-hide
status: ready-for-planning
owner: urim
app: apps/tv
---

# TV Video Player — Hide/Show Controls + Initial Focus

## Problem

The TV video player at `apps/tv/src/components/VideoPlayer.tsx` has two UX bugs that surface immediately when users open a video:

1. **Controls permanently cover the video.** A top "← Back" pill and a full-width bottom glass panel (title, rewind-10 / play-pause / forward-10, progress bar) are always rendered, occupying ~35–40% of the screen. There is no way to hide them to see the full picture.
2. **Initial focus lands on the wrong control.** The back button receives `hasTVPreferredFocus` on first mount, so the user must press D-pad DOWN to reach play/pause — the control they almost always want first.

This is a ten-foot UI regression against the design philosophy in `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` ("Video-first: on TV, video is the primary medium"). Users on a couch cannot enjoy the video when the chrome never retreats.

## Users

- Families watching faith-based video content on Apple TV / Android TV
- Low technical confidence with remote controls; forgiving defaults matter
- Parents handing the remote to kids — stray Back presses should not drop out of playback silently

## Goals

1. Controls auto-hide after a period of D-pad inactivity, so the video occupies the full screen during passive viewing.
2. Any D-pad input reveals controls again without requiring users to remember a special gesture.
3. Play/pause is the initial focus target on player open, matching what users reach for first.
4. No accidental exits from playback — Back when hidden reveals, not dismisses.

## Non-Goals

- Native `expo-video` controls (`nativeControls={true}`). We keep the custom overlay; this brainstorm is only about its visibility behavior.
- Scrub-bar navigation (D-pad left/right acting as seek instead of focus traversal). Skip buttons still handle seek.
- Long-press / hold-to-scrub gestures.
- Captions, audio-track, or quality selection UI.
- Any CMS schema, GraphQL query, or deployment change.
- Porting the pattern to `apps/mobile` (the mobile app uses a different player and has separate requirements).

## Decisions

The conversation resolved these product decisions. Planning should not revisit them without new input.

### D1 — Initial state on player mount
Controls **visible** when the player first mounts. Rationale: users need an affordance to discover the control set on the first video of a session. The initial auto-hide timer starts the moment the player is ready.

### D2 — Initial focus target
**Play / pause button** receives `hasTVPreferredFocus` on first mount (the current back-button focus is wrong). Keep the existing one-shot useEffect pattern (`shouldRequestFocus` set to `false` after first render) so later state updates don't re-steal focus — this is the documented workaround for react-native-tvos #839 and must be preserved.

### D3 — Auto-hide trigger
Controls hide after **5 seconds** of D-pad inactivity *while the video is playing*. If the video is paused, controls stay visible indefinitely — a paused player implies the user is still engaged and reading the chrome.

### D4 — Reveal trigger
**Any D-pad input** — arrows or select — reveals controls and resets the 5s inactivity timer.

### D5 — First-press-after-hidden semantics
When controls are hidden, the **first D-pad press reveals the controls and does not fire the action bound to the focused control.** The same press does not trigger play/pause toggling, seeking, or navigation. Focus restore still happens per I2 — the reveal lands focus on play/pause. Subsequent presses act normally on whatever is focused. This is the forgiving default that matches YouTube TV and prevents accidental seeks when a user simply wants to see where they are in the video.

### D6 — Back / Menu button behavior
When controls are **hidden**, Back reveals them (and resets the timer). When controls are **visible**, Back dismisses the player as today. This gives a two-step escape that is safer for families/kids.

### D7 — Fade scope
Both the **top back pill and the bottom controls panel** fade together. Rationale: maximizing visible video area is the whole point; the back button remains reachable via any D-pad press, so users don't lose the ability to exit.

### D8 — Visual transition
Controls fade in/out with a short opacity animation. **Hide:** 150 ms with `Easing.out(Easing.cubic)` — controls stay legible until near the end of the fade. **Reveal:** 100 ms with `Easing.in(Easing.cubic)` — controls appear quickly. Use `Animated.timing` with `useNativeDriver: true`. No slide / translate — a pure opacity fade reads cleanly on TV and avoids layout shifts. While faded out, controls must be **non-focusable and non-hit-testable** so D-pad / Select events land on an invisible catcher (see I1 below) instead of going through to controls that happen to be under the focus cursor.

### D9 — Buffering / stalled playback
While the expo-video player reports a buffering or stalled status, the **auto-hide timer is suspended** and controls remain visible indefinitely. Playback resumption restarts the 5s timer from zero. A brief stall during seek re-buffering is not treated as an error — only the timer is affected, no error label is shown. Watch `statusChange` (or `playbackStatusUpdate`, whichever expo-video exposes) for the status transition; if the API doesn't cleanly expose buffering, infer it from a `timeUpdate` gap > 1s while `!isPaused`.

### D10 — Playback error / stream failure
If expo-video emits an error or the stream fails mid-playback, **clear the timer, force `controlsVisible = true` permanently** for this session, and show an inline error label inside the bottom controls panel (e.g. "Playback failed — press Back to exit"). No separate error layer. Focus lands on the back pill (which is again visible) since no play action can recover. The user's only option is Back → dismiss the player; optionally Select on the pill dismisses.

### D11 — Video end while controls hidden
When `playToEnd` fires while `controlsVisible === false`, **force `controlsVisible = true` for one render frame before calling `onDismiss`**. This provides visual continuity — a brief flash of chrome instead of a jarring cut from black-video-with-no-UI to the previous screen. Implementation: set `controlsVisible = true` synchronously, then dispatch the dismiss on the next microtask / `requestAnimationFrame`.

### D12 — App backgrounding / foreground resume
On React Native `AppState` transition to `'active'` (i.e. the app returns to the foreground), **force `controlsVisible = true` and restart the 5s timer from zero**. Do not attempt to resume the pre-backgrounded timer value. Rationale: a user returning to the TV after an indeterminate interruption should see the chrome immediately so they can orient, regardless of whether they were 2 seconds or 20 minutes away.

### D13 — Screen reader active (VoiceOver / TalkBack)
When `AccessibilityInfo.isScreenReaderEnabled()` returns true on mount, **auto-hide is disabled entirely**: `controlsVisible` stays true for the entire session, the invisible catcher is not rendered, and control Pressables remain focusable throughout. Subscribe to the `screenReaderChanged` event so mid-session screen-reader activation immediately re-shows controls and disables auto-hide. Controls that were hidden at the moment of screen-reader activation reveal without the first-press-only-reveals gate.

### D14 — Timer reset on every D-pad activity in visible state
**Every** D-pad event while controls are visible resets the 5s inactivity timer — arrow keys, Select on any control (rewind, play/pause, forward), and button activation included. Not just "reveal" presses. A user repeatedly pressing forward-10 should see controls stay visible for the duration of the scrub + 5s after the last press. The table below reflects this explicitly.

### D15 — Paused-state D-pad input is a no-op for the timer
While `isPaused === true`, the 5s timer is not running and D-pad input does not start it. Arrow keys still move focus between controls as normal; Select still activates the focused control. The timer only starts when playback resumes.

### D16 — Siri remote swipe surface (Apple TV)
Physical Siri-remote swipe events (on the touch surface) count as D-pad input for the purposes of this spec — they reveal controls when hidden and reset the timer when visible. Implementation note: react-native-tvos surfaces these through `useTVEventHandler` event types `swipeUp/Down/Left/Right`; treat them identically to the corresponding directional presses.

## Interaction Model — summary

| State | D-pad arrow | Select | Back / Menu |
|---|---|---|---|
| Controls visible — playing | Moves focus within controls; resets 5s timer | Activates focused control; resets timer | Dismiss player |
| Controls visible — paused | Moves focus within controls; no timer runs | Activates focused control; no timer runs | Dismiss player (same as playing) |
| Controls visible — buffering | Moves focus within controls; timer suspended | Activates focused control; timer suspended | Dismiss player |
| Controls visible — error | Moves focus within controls (only back pill is meaningful); no timer | Select on back pill dismisses; other controls are visually inert | Dismiss player |
| Controls hidden | Reveal only (no action fires); focus restored to play/pause; start 5s timer | Reveal only (no action fires); focus restored to play/pause; start timer | Reveal only (no dismiss); focus restored to play/pause; start timer |
| Screen reader active (D13) | Full navigation always; auto-hide disabled; no invisible catcher | Full activation always | Dismiss player |
| Foreground resume from backgrounded (D12) | — (state transitions to "Controls visible — playing/paused" with fresh 5s timer) | — | — |

## Implementation Notes (informational — details belong in the plan)

Not prescribing file layout, but flagging constraints the plan must respect:

### I1 — Invisible D-pad catcher while hidden
Because `trapFocus*` keeps D-pad inside the overlay, something inside the overlay must remain focusable even when controls are invisible — otherwise tvOS's UIFocusEngine has no target and D-pad events become no-ops. The simplest pattern: a full-screen focusable `Pressable` (or `TVFocusGuideView` child) rendered while `controlsVisible === false`, whose only job is to receive the first D-pad / Select input, set `controlsVisible = true`, and then hand focus back to play/pause. This element must be the *only* focus target in the hidden state.

### I2 — Focus restore on reveal
When controls re-appear, focus should land on **play/pause** by default, not on whatever was last focused. Rationale: predictability. If the user was focused on the forward skip button when controls faded, they'll expect the same anchor on reveal as on initial open. Implementation must mirror the one-shot `hasTVPreferredFocus` pattern (set a flag on reveal, clear it after next render).

### I3 — Timer must be ref-based, not state-based
The inactivity countdown needs a `useRef` + `setTimeout` so timer resets from D-pad activity don't re-render the component. Cleanup on unmount is mandatory — orphaned timers on a released `VideoView` are a known crash source.

### I4 — Pause the timer when paused
The 5s timer must not run while `isPaused === true`. Start it on playing, clear it on pause, restart on play-resume.

### I4a — `playToEnd` is unconditional
The `playToEnd` listener must call `onDismissRef.current()` regardless of `controlsVisible`. The reveal-only / catcher logic must not intercept, delay, or gate the dismiss path. Video-end dismiss is independent of the visibility state.

### I5 — Preserve all existing fixes in `VideoPlayer.tsx`
The file has eight numbered fixes (Fix #4 seek guard, #5 one-shot focus, #6 duration seed, #8 seekForward clamp, #9 togglePlayPause from React state, #15 stable onDismiss ref, #24 dismiss try-catch, #25 playingChange guarded cleanup). None may regress. In particular:
- Fix #5's one-shot focus pattern now applies to the **play/pause** button (not back), but the mechanism is unchanged.
- Fix #9 (decide from `isPaused` React state, not `player.playing`) interacts with the "first press only reveals" rule — the reveal-only gate must short-circuit *before* the togglePlayPause handler runs, otherwise rapid presses could still race.

### I6 — Two distinct one-shot focus flags
The existing mount-time `shouldRequestFocus` ref (Fix #5) cannot double as the reveal-time focus flag — it is cleared after the first render and never set again. Use a second ref `revealFocusPending` that is set to `true` every time `controlsVisible` flips from `false` → `true`, and cleared after the next render. Both flags drive `hasTVPreferredFocus` on the play/pause button via an OR: `hasTVPreferredFocus={shouldRequestFocus || revealFocusPending}`. This pattern survives multiple hide/reveal cycles across a single player session.

### I7 — Fade ordering to prevent focus-ring orphan
Because the platform-rendered focus ring cannot be animated by `Animated.timing`, changing focusability and opacity must be serialized to avoid a frame where the ring is painted on a fading-out Pressable.

**On hide:**
1. Set `focusable={false}` on all control Pressables.
2. Mount the catcher with `focusable={true}`; let UIFocusEngine acquire it (one render commit).
3. Start the opacity animation (150 ms, ease-out).

**On reveal:**
1. Set `focusable={true}` on control Pressables; unmount the catcher.
2. Set `revealFocusPending = true` (I6).
3. Start the opacity animation (100 ms, ease-in).

### I8 — Event routing for Back/Menu and arrow keys while hidden
A `Pressable`'s `onPress` does not capture hardware Menu (tvOS) or arrow-key events — those arrive through `useTVEventHandler` (react-native-tvos). While `controlsVisible === false`, a component-level `useTVEventHandler` subscription handles:
- `menu` (tvOS hardware Menu / Siri remote back), Android `hardwareBackPress` — route to "reveal only" path (D6).
- `up / down / left / right` and the corresponding `swipe*` events — route to "reveal only" path (D16).
- `select` — handled by the catcher's `onPress`, which also routes to "reveal only".

When controls are visible, `useTVEventHandler` for menu/back must still intercept so the first explicit dismiss by hardware Menu behaves identically to pressing the visible back pill. On tvOS, call `TVMenuControl.enableTVMenuKey()` on mount to prevent Expo Router's Stack from auto-popping before our handler runs; call `disableTVMenuKey()` on unmount.

### I9 — Android TV z-order: catcher inside the TVFocusGuideView
Per `apps/tv/CLAUDE.md` common pitfall: Android TV VideoView renders on top of all RN Views. The catcher MUST render inside the existing `TVFocusGuideView` (the `contentLayer` style, already absolute-positioned above the VideoView), not as a sibling of the VideoView. This preserves the z-order that already works on Android TV for the visible controls.

### I10 — Screen reader a11y tree hygiene
The invisible catcher carries `accessibilityLabel="Show player controls"` and `accessibilityRole="button"` for normal use. When a screen reader is active (D13), the catcher is not rendered at all; in that case the real controls are the sole interactive targets and each already has its own accessible label on its inner `Text` / icon.

### I11 — Progress bar updates while hidden
The `timeUpdate` subscription and `currentTime` / `duration` state updates are NOT conditioned on `controlsVisible`. The bar keeps advancing internally so that on reveal it shows the true current position with no visible jump. Only the rendered element's opacity is animated.

## Constraints

- **No new dependencies.** React Native's `Animated` API or `useRef` + opacity style is sufficient.
- **Do not switch to `nativeControls={true}`.** Native tvOS controls don't match the Crimson Gallery / warm-salmon accent design and can't be styled.
- **Do not regress the `TVFocusGuideView` focus trap.** The overlay must still trap D-pad so focus can't escape to the underlying Stack screen (documented react-native-tvos quirk).
- **Must work on both Apple TV (tvOS) and Android TV.** Test on both before merge.

## Success Criteria

1. On opening any video, controls are visible for 5 seconds of inactivity, then fade out cleanly (150 ms ease-out). The video plays underneath without visual obstruction.
2. On opening any video, the focus ring lands on the **play/pause** button (visible as a crimson glow / 1.1x scale), not the back button.
3. With controls hidden, any D-pad arrow press restores controls (100 ms ease-in), restores focus to play/pause, does NOT move focus elsewhere, and does NOT trigger a seek. The second press moves focus normally. Timer restarts.
4. With controls hidden, pressing Select restores controls and does NOT toggle play/pause. The second Select press toggles as normal.
5. With controls hidden, pressing Back/Menu (hardware or Siri remote) restores controls and does NOT dismiss the player. The second Back press (now with controls visible) dismisses.
6. Pausing the video keeps controls visible indefinitely. Resuming restarts the 5s timer.
7. Video-end auto-dismiss (`playToEnd`) still fires correctly regardless of control visibility state. If the video ends while hidden, chrome appears for one frame before the dismiss is applied (no black-screen flash).
8. No focus-ring orphan: at no point during the hide animation is the crimson focus ring visible on a fading-out Pressable. Verify on device (not just simulator) for both platforms.
9. **Buffering**: If the stream stalls during playback, the auto-hide timer suspends; controls stay visible until playback resumes, then timer restarts.
10. **Playback error**: If the stream errors, controls stay visible permanently with an inline error label in the controls panel; Back dismisses, no other action is meaningful.
11. **Foreground resume**: Backgrounding the app then returning always restores controls + a fresh 5 s timer, regardless of how long the app was backgrounded.
12. **Screen reader (tvOS VoiceOver, Android TV TalkBack)**: with a screen reader active, auto-hide never triggers; the invisible catcher is not present in the accessibility tree. Each control Pressable is announced by its existing label.
13. **Siri remote swipe (Apple TV)**: swipe events on the touch surface behave identically to the corresponding D-pad arrow press — they reveal controls when hidden and reset the timer when visible.
14. No new console errors on Apple TV Simulator or Android TV emulator. No orphan-timer warnings on player unmount (cleanup must clear the inactivity timer AND unsubscribe `useTVEventHandler` AND release `TVMenuControl`).
15. All eight existing numbered fixes in `VideoPlayer.tsx` still hold. Regression probes during manual QA: rapid Select mashing on play/pause from the visible state (Fix #9 — state is monotonic, no double-toggle), and Back-press dismiss from mid-video (Fix #15/#24 — no crash, dismiss is stable).

## Verification

Manual on Apple TV Simulator (tvOS):
- `cd apps/tv && EXPO_TV=1 npx expo prebuild --clean && EXPO_TV=1 npx expo run:ios --device "Apple TV"` (or the project's current invocation)
- Open any video from a card. Confirm focus ring is on play/pause, not back.
- Let video play 5s untouched. Confirm both the back pill and the bottom panel fade to 0 opacity.
- Press D-pad right. Confirm controls reveal; focus is on play/pause (not on the forward skip button). Confirm no seek fired.
- Press Select. Confirm it does NOT pause the video on first press (first press was the reveal). Press Select again. Confirm it now pauses.
- While paused, wait 10s. Confirm controls do NOT hide.
- Resume playback. Confirm 5s timer starts again and controls hide.
- While hidden, press Back. Confirm controls reveal and player does NOT dismiss. Press Back again. Confirm player dismisses.
- Let a short video play to end. Confirm `playToEnd` auto-dismiss still works.

Manual on Android TV:
- Repeat all of the above using `EXPO_TV=1 npx expo run:android` with a connected Android TV emulator or device.
- Additionally verify the catcher z-order: while controls are hidden, press D-pad. Confirm controls reveal (if the catcher were below the VideoView, D-pad would be silently dropped).

Edge-case probes:
- **Buffering**: throttle the network while a video is playing; confirm the auto-hide timer suspends and controls stay visible until the stream resumes.
- **Playback error**: point the player at an unreachable URL (or revoke the stream mid-playback via a proxy); confirm controls stay visible with the error label and no auto-hide.
- **App backgrounding**: while playing with controls hidden, press the home button; return to the app. Confirm controls are visible + timer has restarted.
- **Siri remote swipe (Apple TV only)**: swipe on the Siri remote's touch surface while controls are hidden. Confirm the swipe reveals controls identically to an arrow press.
- **Screen reader**: on tvOS, enable VoiceOver (Accessibility → VoiceOver); on Android TV, enable TalkBack. Reopen the player. Confirm controls stay visible indefinitely and the invisible catcher is not announced.
- **Video end while hidden**: play a 10s test video; let controls fade; wait for playToEnd. Confirm chrome briefly flashes before dismiss (no jarring cut).

Regression probes:
- Rapid Select mashing on play/pause (from visible state): confirm Fix #9 still holds — no double-toggles, state is monotonic.
- Dismiss mid-video via Back (from visible state): confirm no crash from Fix #15/#24.
- Multiple hide/reveal cycles in one session: confirm play/pause focus is restored on every reveal (I6's `revealFocusPending` ref is working, not just the mount-time flag).

## Open Questions (non-blocking for planning)

None product-side. All behavior above is decided.

Planning-phase technical questions the implementer may need to verify against the device:
- Current hardware Menu / Back handling in the existing player — does Expo Router's Stack auto-pop on Menu today, or does the Pressable's `onPress` fire? Determines whether `TVMenuControl.enableTVMenuKey()` is strictly required (I8) or merely safety-belt. Verify on tvOS before implementing D6.
- expo-video buffering event surface — which event name the SDK exposes (`statusChange`, `playbackStatusUpdate`, `bufferingChange`, or infer from `timeUpdate` gaps). I9 gives both paths; implementer picks the cleanest.
- `useNativeDriver: true` on opacity animation under react-native-tvos 0.81 — generally supported, but verify no warnings/frame drops on Apple TV hardware for a full-screen overlay fade.

## Handoff

Ready for `/ce-plan`. Suggested plan scope:

> "Implement auto-hide controls + play/pause initial focus in `apps/tv/src/components/VideoPlayer.tsx` per `docs/brainstorms/2026-04-21-tv-video-player-controls-auto-hide-requirements.md`. No changes outside this file."
