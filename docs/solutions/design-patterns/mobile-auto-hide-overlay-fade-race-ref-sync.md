---
title: "Mobile auto-hide overlay fade-race: ref-sync, stop-on-reveal, and pure-reducer testability"
date: 2026-06-08
category: design-patterns
module: apps/mobile
problem_type: design_pattern
component: frontend_stimulus
severity: high
related_components:
  - apps/tv
applies_when:
  - "Porting a TV or web auto-hide overlay hook to expo-video on React Native / Fabric"
  - "A hook mirrors React state into a ref for native callbacks AND drives hide via a setTimeout path that calls the hide function directly"
  - "An Animated.timing fade-out whose completion callback is the authoritative mount/unmount trigger"
  - "A re-reveal path (tap, control press, buffering, foreground, accessibility) can race an in-flight hide"
  - "A child is conditionally mounted by the parent's animation lifecycle and owns UI state derived from a persistent native object"
tags:
  - mobile
  - expo-video
  - animated-api
  - auto-hide
  - ref-mirror
  - stale-closure
  - state-machine
  - pure-reducer
---

# Mobile auto-hide overlay fade-race: ref-sync, stop-on-reveal, and pure-reducer testability

## Context

`apps/mobile/src/hooks/useControlsVisibility.ts` is the auto-hiding video chrome — an overlay that fades out after 3s of idle, stays mounted through the ~150ms fade so it can still intercept the animation, and unmounts only when the fade completes (mount-after-fade). It was ported from `apps/tv/src/components/VideoPlayer.tsx`, carrying that overlay's correctness contract (ref-mirror, `Animated.CompositeAnimation` handle capture, `if (finished)` completion guard — see [rntvos-video-overlay-async-native-event-patterns](./rntvos-video-overlay-async-native-event-patterns-2026-04-23.md)).

After the port, a second class of bug appeared: the **fade-race**. A tap or control press landing during the ~150ms fade-out was silently eaten — tapping to bring the chrome back was a no-op (it hid anyway), and pressing a control as the fade started let the stale completion callback unmount the chrome you just touched. A related symptom: after a hide/show cycle the mute icon reset to "unmuted" even though audio stayed muted. These were invisible in normal use — they required either tapping inside a 150ms window or cycling visibility at least once.

This is the same family as the player-lifecycle bugs that preceded it on this screen. The language-switch work froze the `useVideoPlayer` source after discovering that mutating it tears down and recreates the native player mid-play (animations running against a released player is the adjacent failure mode); and `togglePlayPause` was fixed to read the live `player.playing` rather than a stale React `isPlaying` snapshot — the same "React state lags native truth" lesson the fade-race re-teaches at the visibility layer (session history).

Three structural gaps produced the race:

1. The timer-driven hide path (`setTimeout(hideNow, 3000)`) never flipped the ground-truth visibility ref until the fade's `finished` callback committed. During the fade, `controlsVisibleRef.current` still read `true`, so `revealIfHidden()` — guarded by `if (!controlsVisibleRef.current) reveal()` — was a no-op.
2. `noteInteraction()` (fired when any control was pressed) did not `.stop()` the in-flight hide animation, so its completion callback could still unmount the chrome.
3. The tap handler in `VideoPlayer.tsx` captured `wasVisible` from the lagging React state (`controls.controlsVisible`), so its single-tap timer hid a chrome that had just been revealed on press-in.

## Guidance

### 1. Flip the ground-truth ref at hide-START, not hide-END

The ref-mirror effect (`useEffect(() => { controlsVisibleRef.current = controlsVisible }, [controlsVisible])`) updates the ref _after_ React commits a state change. That is correct for post-commit callers but wrong for the timer-hide path, which calls `hideNow` directly without first setting React state — so the ref stays `true` through the whole fade. The two modes of the ref-mirror pattern: the post-commit `useEffect` mirror, **and** an eager sync for paths that drive native state directly. The timer-hide path needs the eager sync.

```ts
// hideNow(): hideStart — logically hidden NOW, before the fade resolves, so a
// mid-fade tap reads "hidden" and routes to reveal instead of completing a hide.
controlsVisibleRef.current = nextControlsState(
  { visible: controlsVisibleRef.current, mounted: true },
  "hideStart",
).visible
```

### 2. `.stop()` the in-flight hide at EVERY re-reveal site

The TV-port contract already `.stop()`-ed the animation inside `reveal()` and explicit `hide()`. `noteInteraction` — the path taken when a visible control is pressed — was missing it. The rule extends: **every** re-reveal site (`reveal`, `noteInteraction`, `AppState 'active'`, `statusChange → loading`, `screenReaderChanged → on`) must stop the captured handle.

```ts
const noteInteraction = useCallback(() => {
  // Stop any in-flight hide fade — a control pressed during the ~150ms fade
  // must keep chrome up, not let the hide's completion callback unmount it.
  if (hideAnimRef.current != null) {
    hideAnimRef.current.stop()
    hideAnimRef.current = null
  }
  const next = nextControlsState(
    { visible: controlsVisibleRef.current, mounted: true },
    "reveal",
  )
  controlsVisibleRef.current = next.visible
  setMounted(next.mounted)
  setControlsVisible(next.visible)
  opacityAnim.setValue(1)
  scheduleHide()
}, [opacityAnim, scheduleHide])
```

### 3. Read ground-truth (a ref getter), not lagging render state, for visibility decisions

Anywhere a decision depends on "is the chrome visible _right now_", read a ref getter, not React render state. The tap handler captures `wasVisible` at press-in to decide whether a single tap should hide; reading `controls.controlsVisible` sees the pre-fade value during the fade — the same lag that broke `revealIfHidden`. Expose `isVisibleNow()` on the hook's return.

```ts
const handleTapPressIn = useCallback(() => {
  // Read ground-truth visibility (the ref), NOT controls.controlsVisible — the
  // render state lags by one fade, so mid-auto-hide it still reads true and the
  // pending single-tap would hide the chrome this press just revealed.
  wasVisibleRef.current = controls.isVisibleNow()
  controls.revealIfHidden()
}, [controls])
```

### 4. Extract a pure transition reducer the hook USES — the testability technique

The load-bearing invariant is the `hideDone` stale-completion guard: if a `reveal` arrived while the fade was running, the completion must find `visible: true` and keep the chrome mounted. Testing it requires a tap landing inside a 150ms window — unreachable in CI. Externalize the `(visible, mounted)` table as a pure function the hook actually calls:

```ts
// apps/mobile/src/lib/controlsVisibility.ts
export type ControlsState = { visible: boolean; mounted: boolean }
export type ControlsEvent = "reveal" | "hideStart" | "hideDone"

export function nextControlsState(
  state: ControlsState,
  event: ControlsEvent,
): ControlsState {
  switch (event) {
    case "reveal":
      return { visible: true, mounted: true }
    case "hideStart":
      // Logically hidden immediately; stays mounted so the fade can play out.
      return { visible: false, mounted: true }
    case "hideDone":
      // Stale-completion guard: a reveal during the fade set visible=true, so
      // keep the chrome up; only a genuinely-still-hidden state unmounts.
      return state.visible
        ? { visible: true, mounted: true }
        : { visible: false, mounted: false }
  }
}
```

The race becomes a CI-catchable assertion:

```ts
it("reveal mid-fade then a stale hideDone leaves the chrome up (core invariant)", () => {
  const fading = nextControlsState(SHOWN, "hideStart") // hidden, still mounted
  const revealed = nextControlsState(fading, "reveal") // brought back mid-fade
  expect(nextControlsState(revealed, "hideDone")).toEqual(SHOWN)
})
```

**Critical:** the hook must call `nextControlsState` directly (it does — in `hideNow`, the fade-completion callback, `reveal`, and `noteInteraction`), not keep parallel booleans. Testing a parallel reimplementation gives the _appearance_ of coverage without testing the hook's logic — the mocked-shape-vs-real-contract trap. Apply the same shape to the tap disambiguation: pure `classifyTap`/`singleTapAction` in `apps/mobile/src/lib/tapSeek.ts` that the component uses.

### 5. Seed ALL remount-sensitive state from the live native object

`PlayerControls` unmounts when the chrome hides; on remount `useState(false)` for `isMuted` starts false regardless of the persistent player. Seed every derived field from the live object on mount — and don't let a guard for one field (HLS `duration` is `0`/`NaN` until `sourceLoad`) block reading unrelated fields that are available immediately.

```ts
useEffect(() => {
  setIsMuted(player.muted) // read unconditionally — has no duration guard
  const d = player.duration
  if (!Number.isFinite(d) || d <= 0) return
  const t = player.currentTime
  setCurrentTime(t)
  setDuration(d)
  setEnded(!player.playing && t >= d - 0.5)
}, [player])
```

## Why This Matters

The underlying mechanism is the recurring one for this screen: **React state lags native time.** The fade-race is its expression at the visibility layer — the ref-update path and the hide-animation path disagreed on which one signals "logically hidden." The mitigation (ref-mirror) has two modes, and the timer-driven hide path silently fell into the one that needs an eager sync.

What makes the race pernicious is that it is invisible to any timer-free test: no sequence of synchronous transitions places the hook in the "mid-fade" state without an actual `Animated.timing` in flight on a device. That is decisive in this repo, which **deliberately has no render-test infrastructure — `react-test-renderer@19` + jest + pnpm is unsupported here, and every test is a pure-function test under `src/lib/__tests__/` / `src/hooks/__tests__/`** (session history). So extracting the invariants into a pure reducer is not a nicety — it is the _only_ way to get the fade-race under CI. The pure reducer plus simulator verification (R19) is the testing contract for this whole class of hook.

> **Superseded in part, 2026-08-18 (feat-367).** The "no render-test infrastructure" premise no longer holds for `apps/mobile`: a component-render harness now exists there with **no new dependency**, using jest-expo's own transitive `react-test-renderer` via a `react` re-point. See `apps/mobile/CLAUDE.md`, section "Component render tests", and `apps/mobile/src/test-utils/rnTestRenderer.ts`. The paragraph above is left as written because its **primary** claim still stands — a timer-free test still cannot reach the mid-fade state, so the pure reducer remains the right extraction. Only the "the _only_ way" framing is now too strong. This note does not extend to `apps/tv`, which stays on SDK 54 and still has no renderer.

## When to Apply

Apply all five techniques together whenever:

- A React Native component has a fade-in/out animation that drives a mount/unmount decision in its completion callback.
- A separate auto-hide timer fires the hide function directly (`setTimeout(hide)`), not via a state setter + `useEffect` — so the ref will not self-update.
- A re-reveal path (tap, control press, buffering, foreground resume, accessibility toggle) can race the fade.
- A child is conditionally mounted by the parent's animation lifecycle and owns UI state derived from a persistent native object that survives the child's unmount.

Code signals that the pattern is needed: `setTimeout(hideNow, DELAY)` firing into an imperative function; `anim.start(({ finished }) => { if (finished) setState(...) })`; a lone `controlsVisibleRef.current = controlsVisible` mirror with no eager sync in the hide path; a child `useState(false)` mirroring a persistent property (`player.muted`, `player.playing`).

## Examples

Key files in this codebase:

- `apps/mobile/src/lib/controlsVisibility.ts` — the pure three-event reducer with inline invariant comments.
- `apps/mobile/src/lib/__tests__/controlsVisibility.test.ts` — six named cases covering all three events and the two race paths (reveal-wins-race, second-cycle-ends-visible).
- `apps/mobile/src/hooks/useControlsVisibility.ts` — `hideNow` (eager ref flip + `nextControlsState("hideStart")`, completion via `nextControlsState("hideDone")`), `reveal`/`noteInteraction` (both `.stop()` the handle and call `nextControlsState("reveal")`), `isVisibleNow()` getter.
- `apps/mobile/src/components/watch/VideoPlayer.tsx` — `handleTapPressIn` reads `controls.isVisibleNow()`; chrome render gates on `controls.mounted`.
- `apps/mobile/src/components/watch/PlayerControls.tsx` — seed-on-mount reads `player.muted` unconditionally before the duration guard.
- `apps/mobile/src/lib/tapSeek.ts` — `classifyTap` / `singleTapAction`, the same pure-then-wire shape for tap disambiguation.

What the explicit table replaces conceptually:

```
Before (implicit, untestable):
  hide-start: visible=true still, mounted=true
  hide-done:  visible=false, mounted=false   ← unmounts even if revealed mid-fade

After (explicit, testable):
  hideStart → { visible: false, mounted: true }   // logical ground truth moves now
  hideDone  → keep current visible; unmount only if still hidden
  reveal    → { visible: true, mounted: true }      // cancels any pending stale done
```

## What Didn't Work

The TV→mobile port carried the correctness contract (ref-mirror, `if (finished)` guard, `.stop()` at force-reveal) but applied the ref-flip and `.stop()` only at the **explicit toggle/hide sites** — missing the timer-hide path and `noteInteraction`. The two gaps are symmetric (no eager ref-flip in `hideNow`; no `.stop()` in `noteInteraction`), and both needed a 150ms timing coincidence on a device to observe, which is why they survived the port and the first round of testing. Initial coverage was a pure `shouldArmHideTimer` gate test only — structurally incapable of reaching the race because it runs with no Animated timeline.

This mirrors the earlier player-lifecycle dead ends on the same screen (session history): three `replaceAsync` resume strategies all failed against a player that had already been silently recreated, and only instrumentation found the cause; the durable fix was to freeze the `useVideoPlayer` source. The shared lesson across both: when native objects (player, animation) outlive or race React's commit cycle, trust a ref or the live object, not React render state.

## Related

- [rntvos-video-overlay-async-native-event-patterns](./rntvos-video-overlay-async-native-event-patterns-2026-04-23.md) — the source overlay correctness contract (ref-mirror, `.stop()`-at-force-reveal, `finished` guard, `isMountedRef`). This doc refines it with the **timer-path eager-sync gap** and the **pure-reducer testability technique**, neither of which is in the tvOS doc.
- [mux-player-custom-react-chrome-pattern](./mux-player-custom-react-chrome-pattern-20260430.md) — web counterpart: opacity-only hide, never `pointerEvents:none`, clamp progress. "Flip ref at hide-START" + "`.stop()` at every re-reveal" is the mobile expression of the same contract.
- [mocked-shape-vs-real-contract-discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — the pure reducer must be the artifact the hook actually calls; a parallel reimplementation is the mocked-vs-real trap.
- [mobile-video-detail-page-patterns](../best-practices/mobile-video-detail-page-patterns-20260527.md) and [playlist-video-player-sdui-mobile](../best-practices/playlist-video-player-sdui-mobile-20260409.md) — the expo-video player lineage (frozen `useVideoPlayer` source, `replaceAsync` swap, live `player.playing` reads, `AppState` pause/resume) this overlay sits on top of.
