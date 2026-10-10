---
title: 'tvOS AppState teardown must branch on "background", not "!== active" — transient "inactive" flapped the sound hero'
date: 2026-07-13
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Holding the TV button (Control Center), invoking Siri, or peeking the app switcher cut the Experience hero's audio mid-scene"
  - "The hero VideoView unmounted and remounted on every foreground interruption — the HLS decode slot was released and re-initialized instead of held"
  - "Possible black frame / poster re-fade on return to the app even though it was never actually backgrounded"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "apps/tv/src/components/watch/VideoBackdrop.tsx"
  - "apps/tv/src/components/watch/videoBackdropGate.ts"
  - "apps/tv/src/components/watch/videoBackdropGate.test.ts"
tags:
  - "tv"
  - "tvos"
  - "appstate"
  - "expo-video"
  - "react-native-tvos"
  - "lifecycle"
  - "decode-slot"
  - "video-backdrop"
---

# tvOS AppState teardown must branch on "background", not "!== active" — transient "inactive" flapped the sound hero

_Shipping in PR #1531 (`feat(tv): restyle Experience Details page to WATCH_THEME`), unmerged as of writing._

## Problem

`apps/tv`'s Experience Details page renders an unmuted, autoplaying cinematic hero (`VideoBackdrop` with `muted={false}`), an Apple-TV-style divergence from the muted watch/Home/Search siblings. Because the unmuted hero emits sound and holds a scarce tvOS AVPlayer decode slot, it must release that slot and stop audio when — and only when — the app is genuinely backgrounded (requirement R15). The first version keyed "is the app in the foreground?" on `AppState.currentState === "active"`. On tvOS/iOS that is wrong: the OS routes in-foreground interruptions (Control Center, Siri, the app-switcher peek) through the transient `"inactive"` state, which `=== "active"` counts as "not foreground" and therefore as teardown. The hero flapped on every such interruption.

## Symptoms

- Hold the TV button (Control Center), trigger Siri, or peek the app switcher, and the hero's audio cut mid-scene.
- The hero `VideoView` unmounted (releasing + re-initializing the HLS decode slot) and remounted on return to `"active"` — not the intended "hold the slot through a foreground blip" behavior.
- Possible black frame / poster re-fade on foreground-return, since remounting the `VideoView` re-runs HLS init even though the app never truly suspended.
- Muted siblings were unaffected (they never subscribed to `AppState`), which is why this only showed on the sound hero.

## What Didn't Work

- **Keying foreground on `state === "active"` (equivalently, treating `state !== "active"` as backgrounded).** This is the naive form and the actual bug: it collapses two distinct OS states — `"inactive"` (a foreground blip) and `"background"` (real suspension) — into one "tear down" branch. Every transient `"inactive"` then triggers a decode-slot release + audio stop that R15 only wants on genuine suspension.
- **Note the deliberate asymmetry with the fullscreen player.** `apps/tv/src/components/VideoPlayer.tsx` also inspects `AppState` with `if (next !== "active") return`, but that is a foreground-_resume_ handler (on return to `"active"` it reveals controls and restores a one-shot focus claim; see its comment "Don't touch play/pause"). It early-returns on anything that is not `"active"` and performs no teardown, so its `!== "active"` test is correct for _its_ purpose. The backdrop's teardown gate is the opposite shape — it acts _while away_ — so it cannot reuse the same predicate. Do not "align" the two on the same string.

## Solution

Map foreground as "not `background`", extract that mapping to a pure exported helper, gate the `AppState` subscription so only the unmuted hero subscribes, and unit-test the `"inactive"` case directly.

Before (the first version's shape):

```ts
// foreground iff strictly "active" — transient "inactive" counts as backgrounded
const [appForeground, setAppForeground] = useState(
  AppState.currentState === "active",
)
useEffect(() => {
  if (muted) return
  const sub = AppState.addEventListener("change", (next) => {
    setAppForeground(next === "active")
  })
  return () => sub.remove()
}, [muted])
```

After — the pure helper (`apps/tv/src/components/watch/videoBackdropGate.ts`):

```ts
/**
 * True unless the app is genuinely backgrounded. Transient "inactive" (tvOS
 * Control Center, Siri, app-switcher peek) is NOT teardown — only "background"
 * releases the unmuted hero's decode slot + audio (R15).
 */
export function isAppStateForeground(state: AppStateStatus): boolean {
  return state !== "background"
}
```

After — the consumer (`apps/tv/src/components/watch/VideoBackdrop.tsx`), which seeds from the helper and subscribes only when unmuted:

```tsx
const [appForeground, setAppForeground] = useState(
  isAppStateForeground(AppState.currentState),
)
useEffect(() => {
  if (muted) return
  const sub = AppState.addEventListener("change", (next) => {
    setAppForeground(isAppStateForeground(next))
  })
  return () => sub.remove()
}, [muted])
```

`appForeground` then feeds the single play+mount gate. In `computeBackdropGate` muted siblings pin `appGate = true` (`const appGate = muted ? true : appForeground`), so the whole `AppState` mechanism is default-inert for them and the unmuted hero is the only consumer that acts on lifecycle:

```ts
const appGate = muted ? true : appForeground
return {
  shouldPlay: active && !overlayVisible && appGate,
  shouldMountVideo: !overlayVisible && appGate,
}
```

Because `apps/tv` has no render harness by convention, the pure extraction is what makes the fix testable. The `"inactive"` regression is pinned directly (`apps/tv/src/components/watch/videoBackdropGate.test.ts`):

```ts
describe("isAppStateForeground", () => {
  it("active is foreground", () => {
    expect(isAppStateForeground("active")).toBe(true)
  })

  it("background is NOT foreground — tears down the sound hero (R15)", () => {
    expect(isAppStateForeground("background")).toBe(false)
  })

  it("transient inactive stays foreground — Control Center/Siri is not teardown", () => {
    expect(isAppStateForeground("inactive")).toBe(true)
  })
})
```

The gate-composition tests in the same file also assert the sound hero unmounts + stops on `appForeground: false` (R15) while muted siblings ignore it entirely, so the two directions of the mapping are both covered.

## Why This Works

On tvOS/iOS, `"background"` is the only `AppStateStatus` that means the app is actually suspended. `"inactive"` is a foreground transition state the OS passes through for interruptions that never reach `"background"` — the app is still on screen and still owns its resources. Tearing down only when `state === "background"` (i.e. treating everything else as foreground) matches the exactly-one state that warrants releasing the decode slot and cutting audio, so a Control Center / Siri / app-switcher peek leaves the hero playing untouched, while a true background release still fires. Keeping the mapping a pure `AppStateStatus -> boolean` function makes the whole contract inspectable in jest without mounting React.

## Prevention

- **For ANY React Native video/audio lifecycle teardown keyed on `AppState`, branch on `"background"`, never on `"!== active"`.** `"active"` and `"background"` are not complementary — `"inactive"` sits between them as a foreground blip. Reserve teardown (decode-slot release, audio stop, unmount) for `state === "background"`; treat everything else as foreground. Resume-only handlers that fire _on return to active_ may legitimately test `next !== "active"` as an early-return guard (see `VideoPlayer.tsx`), but a gate that acts _while the app is away_ must key on `"background"`.
- **Keep the state->boolean mapping a pure, exported helper and unit-test the `"inactive"` case explicitly.** A test that only covers `"active"` and `"background"` passes for both the correct (`!== "background"`) and the buggy (`=== "active"`) implementations — only an assertion that `"inactive"` is foreground distinguishes them. In `apps/tv`, which has no render harness, extracting the predicate (as `isAppStateForeground`) is also the only way to test it at all:

  ```ts
  export function isAppStateForeground(state: AppStateStatus): boolean {
    return state !== "background"
  }

  // the discriminating test — fails the buggy `=== "active"` form:
  expect(isAppStateForeground("inactive")).toBe(true)
  ```

- **Subscribe to `AppState` only from the consumer that acts on it.** Gate the subscription (`if (muted) return`) and pin the gate input to a constant for everyone else (`appGate = muted ? true : appForeground`), so the lifecycle path is default-inert and the sound hero is the single place the behavior lives.
- **Re-read live `AppState` at the moment an async media action executes, not a value captured before an `await`. (session history)** A sibling mobile fix (`useManagedVideoPlayer`, 2026-07-12) hit the adjacent race: `resume()` after an `expo-video` `replaceAsync` swap trusted a `wasPlaying` snapshot taken _before_ the swap, so backgrounding mid-swap force-played audio in the background. This fix is naturally immune (the listener keeps `appForeground` live and `computeBackdropGate` reads it per render), but any deferred decode-slot re-acquire or resume across an `await` must re-check foreground at execution time, not trust a pre-gap snapshot.
- **Known caveat — the tvOS screensaver.** tvOS may leave the app in `"active"` when the screensaver takes over, so `isAppStateForeground` will report foreground and the hero keeps its slot. That is a separate best-effort gap, not covered by this fix; do not conflate it with the `"inactive"` mapping.

## Related Issues

- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — the unmount-not-pause law for the _overlay_ axis of the same decode slot: a paused-but-mounted `VideoView` still holds the tvOS decode slot, so the backdrop must UNMOUNT (not just `pause()`) on overlay-open. This AppState fix is the _lifecycle_ axis of the same slot; both now flow through the one `computeBackdropGate` mount gate.
- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — the same principle one level up, on a different event source: don't collapse a transient native-event value into a terminal one. There it was `idle` vs `error` at the loop seam (latch `videoReady`, don't unmount on a transient `idle`); here it is `inactive` vs `background` in `AppState`. Same file (`VideoBackdrop.tsx`), same "a blip is not a terminal state" shape.
- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` — the general async-native-events pattern doc. Its AppState pattern is the _resume_ direction (restore focus on `"active"`) and treats every non-`"active"` value as one bucket, which is correct for resume but is exactly the granularity this teardown-direction fix adds. Worth updating there (see refresh note below).
- `docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md` — the closest existing AppState+video pause/resume precedent (mobile), whose `wasPlayingRef` else-branch pauses on _either_ `inactive` or `background`. Fine for a mobile touch player; do NOT copy that non-distinguishing branch into a tvOS always-on backdrop.
- Auto-memory `tv_two_player_decoder_unmount_videoview` and `tv_fast_refresh_zombie_player` — a paused background `VideoView` holds a decode slot (unmount to free it), and hot-reloading player files wedges playback with the same black/0:00 signature (cold-relaunch before judging any tvOS player change).
