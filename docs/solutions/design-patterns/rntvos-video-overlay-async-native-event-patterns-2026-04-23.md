---
title: Async native events vs React state in react-native-tvos video overlays
date: 2026-04-23
last_updated: "2026-06-25"
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: high
related_components:
  - testing_framework
  - tooling
applies_when:
  - "`react-native-tvos` or `expo-video` project with a custom overlay state machine driven by both React state and native events"
  - "`Animated.timing` / `Animated.spring` with state changes in the completion callback"
  - "`useTVEventHandler` gates on `eventType`, or `TVFocusGuideView` + `hasTVPreferredFocus` focus routing"
  - "`AppState` / `BackHandler` / `AccessibilityInfo` handlers mutate overlay state"
  - "Native event callbacks may fire after `subscription.remove()` (late emission)"
tags:
  - react-native-tvos
  - expo-video
  - animated-api
  - tv-focus
  - stale-closure
  - ref-mirror
  - async-timing
  - apps-tv
---

# Async native events vs React state in react-native-tvos video overlays

## Context

React Native TV components that drive a custom overlay state machine from a mix of React state and **non-React event sources** hit a class of bugs that is invisible until the second state transition. The archetypal feature is a **video player chrome with auto-hide**: a state-gated inactivity timer, a fade animation whose completion mutates React state, `useTVEventHandler` emissions from the TV focus engine, `AppState` / `BackHandler` / `AccessibilityInfo` subscriptions, and `expo-video` listeners — all firing from outside React's reconciler and all needing to read or mutate the same overlay state.

A naïve implementation using only `useState` and render-closure reads:

1. Compiles and typechecks clean.
2. Passes manual QA on the first play cycle (the default-state path works because `useState(false)` matches the pre-transition value).
3. Breaks silently on the second transition (resume-from-pause, buffering-recovery, app foreground, accessibility toggle, etc.).

This doc extracts the four durable patterns that fix the class, from six bugs found in `apps/tv/src/components/VideoPlayer.tsx` during `/ce-code-review` (PR #830) after manual QA had already signed off. Session history shows this is the **third** time a variant of the same root-cause class has surfaced in this component: session `399dc1f3` (2026-04-13) patched `NativeSharedObjectNotFoundException` with a try/catch (Fix #24/#25); session `fc6228eb` (2026-04-21) corrected `TVMenuControl` → `TVEventControl` at plan-review time; this fix batch resolves the remaining cluster structurally.

## Guidance

### Pattern 1 — Ref-mirror + eager-sync for state-gated guards called from native callbacks

When a guard function is invoked **synchronously** from a native-emitter callback that has just queued a `setState`, the guard must read from a **ref that the callback eagerly synced before calling the guard** — not from the render closure's `useState` value. React has not committed yet; render-closure reads will see pre-transition state. A post-commit `useEffect` mirror is a useful fallback for other callers, but the transition-driving callback must sync the ref itself, on the line above the call.

**Before** — `scheduleHide` reads render-closure state; `playingChange` calls it before `setIsPaused(false)` commits → guard sees stale `isPaused === true` → bails → auto-hide never rearms after resume-from-pause:

```tsx
const scheduleHide = () => {
  if (inactivityTimerRef.current != null) {
    clearTimeout(inactivityTimerRef.current)
    inactivityTimerRef.current = null
  }
  if (
    isPaused || // ← stale render-closure read
    status === "loading" ||
    status === "error" ||
    hasError ||
    isScreenReaderEnabled
  )
    return
  inactivityTimerRef.current = setTimeout(hideControls, 3000)
}

player.addListener("playingChange", ({ isPlaying }) => {
  setIsPaused(!isPlaying) // queued, not committed
  if (isPlaying) {
    scheduleHideRef.current() // reads stale isPaused → bails
  }
})
```

**After** — mirror each gating input into a ref, have the guard read from refs, and sync the relevant ref **before** calling the guard:

```tsx
const isPausedRef = useRef(false)
const statusRef = useRef<VideoPlayerStatus>("idle")
const hasErrorRef = useRef(false)

// Post-commit mirrors (fallback for callers outside the transition path)
useEffect(() => {
  isPausedRef.current = isPaused
}, [isPaused])
useEffect(() => {
  statusRef.current = status
}, [status])
useEffect(() => {
  hasErrorRef.current = hasError
}, [hasError])

const scheduleHide = () => {
  if (inactivityTimerRef.current != null) {
    clearTimeout(inactivityTimerRef.current)
    inactivityTimerRef.current = null
  }
  if (
    isPausedRef.current ||
    statusRef.current === "loading" ||
    statusRef.current === "error" ||
    hasErrorRef.current ||
    isScreenReaderEnabledRef.current
  )
    return
  inactivityTimerRef.current = setTimeout(hideControls, 3000)
}

player.addListener("playingChange", ({ isPlaying }) => {
  // Sync the guard ref BEFORE calling scheduleHideRef.
  isPausedRef.current = !isPlaying
  setIsPaused(!isPlaying)
  if (isPlaying) {
    scheduleHideRef.current() // now reads post-transition ref
  }
})
```

The `useEffect` mirror and the eager sync are **both required**. The effect covers callers that observe state _after_ the next commit; the eager sync covers callers that fire within the same tick as the `setState` they triggered.

### Pattern 2 — Capture `Animated.CompositeAnimation` handles, guard completion with `if (finished)`, `.stop()` on every transition

When an `Animated` completion callback mutates React state (`setControlsVisible(false)`), any other code path that force-transitions the state (error path, reveal path, AppState resume, unmount) must be able to **cancel the in-flight animation**. Otherwise the stale completion callback lands _after_ the force-transition and silently clobbers it. `Animated.timing(...).start(cb)` provides no handle; you have to capture the `CompositeAnimation` returned by `Animated.timing(...)` **before** calling `.start()`, use `if (finished)` in the callback so a stopped animation does not execute the post-anim state update, and `.stop()` at every force-transition site.

**Before** — completion callback unconditionally writes state; no handle, no cancel path:

```tsx
const hideControls = () => {
  setControlsFocusable(false)
  Animated.timing(opacityAnim, { toValue: 0, duration: 150, ... })
    .start(() => setControlsVisible(false))   // ← clobbers force-reveals
}

const revealControls = () => {
  if (controlsVisibleRef.current) return
  setControlsVisible(true)                    // ← gets clobbered ~75ms later
  setControlsFocusable(true)
  // ...
}
```

**After** — capture the handle, `if (finished)` guard, `.stop()` at every force-transition site:

```tsx
const hideAnimRef = useRef<Animated.CompositeAnimation | null>(null)

const hideControls = () => {
  setControlsFocusable(false)
  if (isReduceMotionEnabled) {
    opacityAnim.setValue(0)
    setControlsVisible(false)
    return
  }
  hideAnimRef.current = Animated.timing(opacityAnim, {
    toValue: 0,
    duration: 150,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  })
  hideAnimRef.current.start(({ finished }) => {
    if (finished) setControlsVisible(false) // skip when stopped
    hideAnimRef.current = null
  })
}

const revealControls = () => {
  if (controlsVisibleRef.current) return
  if (hideAnimRef.current != null) {
    hideAnimRef.current.stop() // neutralise stale completion
    hideAnimRef.current = null
  }
  setControlsVisible(true)
  // ...
}

// Same .stop() at: error branch, AppState 'active', unmount cleanup.
useEffect(() => {
  return () => {
    isMountedRef.current = false
    if (hideAnimRef.current != null) {
      hideAnimRef.current.stop()
      hideAnimRef.current = null
    }
    if (inactivityTimerRef.current != null) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
  }
}, [])
```

The rule: **any state mutation inside an `Animated` completion callback implies handle capture + `finished` guard + `.stop()` at every site that force-transitions the state the callback writes.**

### Pattern 3 — Gate conditionally-mounted focus-trap targets on synchronous state (focusability), not animation-completion state (visibility)

On tvOS, `UIFocusEngine` silently drops D-pad input when there is no focusable element in the trap region. If you make the real controls non-focusable at the start of a fade and mount a fallback "catcher" at the end of the fade, the 150 ms fade window is a **focus dead-zone**: controls non-focusable, catcher not mounted, input discarded.

Mount the catcher on the **synchronous** flip (the focusability flag the native engine reacts to immediately), not the async-completion flip that lands one animation frame later. Keep the flags separate — **one state flag per native invariant**.

**Before** — catcher mounts only after `setControlsVisible(false)`, which runs in the animation completion:

```tsx
{!controlsVisible && !isScreenReaderEnabled && (
  <Pressable onPress={revealControls} hasTVPreferredFocus ... />
)}
```

**After** — gate on `!controlsFocusable`, which is flipped synchronously at the start of `hideControls`:

```tsx
{!controlsFocusable && !isScreenReaderEnabled && (
  <Pressable onPress={revealControls} hasTVPreferredFocus ... />
)}
```

The principle: `controlsFocusable` is what `UIFocusEngine` cares about; `controlsVisible` is what the renderer cares about. Don't conflate them, and gate fallback focus targets on the focus flag.

### Pattern 4 — On foreground resume, set a one-shot `hasTVPreferredFocus` flag yourself — don't rely on the focus engine's default restoration

[react-native-tvos #852](https://github.com/react-native-tvos/react-native-tvos/issues/852): after `AppState` foreground resume (and after back-navigation stack pops), `UIFocusEngine` can end up without a valid focused element even when focusable elements exist. The mitigation is a **one-shot `hasTVPreferredFocus` claim** on a specific `Pressable`, toggled by a React state flag that the `AppState 'active'` handler sets and the `Pressable`'s own `useEffect` clears.

> Scope: the one-shot flag restores **one fixed control**. To restore the _actual_ last-focused element across a screen with many focusables (rails, hero, tabs) after a back-navigation pop, use a screen-level focus memory (`requestTVFocus` on the remembered node) instead — see [`tv-back-nav-focus-restoration-screen-focus-memory.md`](./tv-back-nav-focus-restoration-screen-focus-memory.md). Foreground-resume restore (this pattern) and back-nav element restore (the focus memory) are complementary.

Critically, if the resume handler short-circuits any other code path that would have set the focus-pending flag (e.g., by directly flipping visibility rather than calling `revealControls`), it must set the correct focus-pending flag **itself** — and it must branch on the current error state so focus lands on the right control.

**Before** — AppState handler never sets a focus flag; catcher unmounts but `play/pause` has no `hasTVPreferredFocus` claim → focus orphans:

```tsx
useEffect(() => {
  const sub = AppState.addEventListener("change", (next) => {
    if (next !== "active") return
    setControlsVisible(true)
    setControlsFocusable(true)
    opacityAnim.setValue(1)
    if (!hasError) scheduleHideRef.current()
  })
  return () => sub.remove()
}, [opacityAnim, hasError])
```

**After** — stop any in-flight hide (Pattern 2), branch on `hasErrorRef` (Pattern 1), set the correct one-shot focus flag:

```tsx
useEffect(() => {
  const sub = AppState.addEventListener("change", (next) => {
    if (next !== "active") return
    if (hideAnimRef.current != null) {
      hideAnimRef.current.stop()
      hideAnimRef.current = null
    }
    setControlsVisible(true)
    setControlsFocusable(true)
    opacityAnim.setValue(1)
    if (hasErrorRef.current) {
      setErrorFocusPending(true) // back pill
    } else {
      setRevealFocusPending(true) // play/pause
      scheduleHideRef.current()
    }
  })
  return () => {
    try {
      sub.remove()
    } catch {}
  }
}, [opacityAnim]) // hasError removed from deps — read via ref now
```

When two force-reveal paths can race (e.g., an error landing the same tick as a user Select), set the losing flag to `false` explicitly so only one `hasTVPreferredFocus` claim is live in the render UIFocusEngine consumes:

```tsx
if (next === "error") {
  // ...force-reveal + errorFocusPending=true...
  setRevealFocusPending(false) // defensive exclusivity
  setErrorFocusPending(true)
}
```

> **Direction matters — `!== "active"` is correct here only because this is a _resume_ handler.** It acts on return to `"active"` and early-returns on everything else, so collapsing `"inactive"` and `"background"` into "not active" is harmless. A _teardown_-direction handler is the opposite shape — it acts _while the app is away_ (release a decode slot, stop audio) — and must branch on `"background"` specifically, never on `"!== active"`: tvOS routes transient in-foreground interruptions (Control Center, Siri, app-switcher peek) through `"inactive"`, so a `!== "active"` teardown flaps on every such blip. See [`tvos-appstate-inactive-vs-background-video-teardown.md`](../ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md).

### Pattern 5 — Denylist synthetic focus events in `useTVEventHandler`, not whitelist user inputs

`react-native-tvos`'s `useTVEventHandler` fires for both real user input **and synthetic focus-reassignment events** (`focus`, `blur`, `pan`, `panBegin`, `panEnd`) that the engine emits when it reassigns focus — including when a newly mounted `Pressable` with `hasTVPreferredFocus` claims focus.

A naïve "reveal on any event" causes a hide→reveal loop (the catcher mounts, claims focus, emits `focus`, handler reveals, timer rearms, auto-hide fades, catcher re-mounts, loop). The obvious fix — whitelist only known user-input event types — silently drops hardware media keys (`playPause`, `fastForward`, `rewind`) that some Android TV remotes and the Siri remote gen-1 emit.

The correct shape is a **denylist of the small, closed set of synthetic focus events** and trust everything else as user intent:

```tsx
const onTVEvent = useCallback(
  (evt: { eventType?: string } | null | undefined) => {
    if (evt == null) return
    const type = evt.eventType
    if (type == null) return
    const isSyntheticFocusEvent =
      type === "focus" ||
      type === "blur" ||
      type === "pan" ||
      type === "panBegin" ||
      type === "panEnd"
    if (isSyntheticFocusEvent) return

    if (!controlsVisibleRef.current && !isScreenReaderEnabledRef.current) {
      revealControlsRef.current()
      return
    }

    // Visible state: Siri-remote swipes and hardware media keys don't fire
    // Pressable.onFocus/onPress, so they need to reset the timer here.
    if (
      type.indexOf("swipe") === 0 ||
      type === "playPause" ||
      type === "fastForward" ||
      type === "rewind"
    ) {
      scheduleHideRef.current()
    }
  },
  [],
)
useTVEventHandler(onTVEvent)
```

### Pattern 6 — `isMountedRef` for late-emission native callbacks (pragmatic, not idiomatic)

React team guidance discourages `isMounted` checks. That guidance applies to **React-scheduled** work (effects, promises inside components) where the underlying fix is usually `AbortController` or effect cleanup. It does **not** apply to event sources outside React's model — specifically native emitters (`expo-video`, `AppState`, `BackHandler`) that may deliver queued events **after** `subscription.remove()` has run, and `setTimeout(fn, 0)` callbacks scheduled just before unmount.

A `try/catch` around the callback body does **not** cover this: `setState`-after-unmount does not throw in React 18+ — it logs a warning and no-ops on state but still executes any side effects in the callback (e.g., `onDismiss`, navigation). Session history on this codebase shows this was first patched as a narrow try/catch around `player.pause()` in 2026-04-13 (Fix #24/#25) — a surface-level mitigation for one call site that didn't generalise:

```tsx
const isMountedRef = useRef(true)

useEffect(() => {
  return () => {
    isMountedRef.current = false
    // ...other cleanup
  }
}, [])

player.addListener("statusChange", (payload) => {
  if (!isMountedRef.current) return // late-emission guard
  // ...
})

player.addListener("playingChange", ({ isPlaying }) => {
  if (!isMountedRef.current) return
  // ...
})

const doDismiss = () => {
  if (!isMountedRef.current) return
  try {
    onDismissRef.current()
  } catch (e) {
    /* ... */
  }
}

player.addListener("playToEnd", () => {
  if (!isMountedRef.current) return
  if (!controlsVisibleRef.current) {
    setControlsVisible(true)
    setControlsFocusable(true)
    setTimeout(doDismiss, 0)
    return
  }
  doDismiss()
})
```

Use this **only** for external-emitter callbacks and `setTimeout`-on-the-brink-of-unmount; not as a blanket tool to silence React's warnings in effects.

## Why This Matters

All six bugs share one root cause: **async native events firing into code that reads React render-closure state that has not yet committed**. React's batched update model assumes state reads happen _after_ the commit that enqueued them. Native emitters (expo-video's JSI callbacks, `Animated`'s native-driver completion callbacks, `useTVEventHandler`'s synthetic focus emissions, `AppState`) don't wait for the commit — they fire when the native side says so, often on the same tick as the `setState` they triggered.

**Ref-mirror + eager-sync is the specific mitigation** because refs are the only cross-tick, synchronously-updatable read channel React provides. `useState` reads are frozen to the render that captured them; `useSyncExternalStore` subscribes but still commits; `useReducer` is the same problem with extra steps. The ref itself has no render cost and no commit dependency — the value you write on line N is the value readable on line N+1 from any closure that was handed the ref.

Failure modes of common alternative "fixes":

- **`setTimeout(fn, 0)`** — _does_ let the commit land first on the happy path but (a) loses the causal link to the action (a subsequent event can fire in the gap and win), and (b) the setTimeout can itself fire post-unmount, reproducing Pattern 6.
- **`useReducer`** — reducers batch like `setState`. Dispatch still waits for commit. You'd replace six refs with one reducer and still read stale values from native callbacks.
- **`try/catch` around native callbacks** — `setState`-after-unmount doesn't throw in modern React; only a mounted check short-circuits the callback's side effects (navigation via `onDismiss`, etc.).

Pattern 2 (the `Animated.CompositeAnimation` handle) is the animation-layer expression of the same root cause: the native driver's completion callback is an async event that reads from and writes to React state, and every other code path mutating that state must be able to cancel it.

## When to Apply

Apply this guidance when **all** of the following hold:

- `react-native-tvos` (Apple TV / Android TV), OR any RN app driving a custom overlay from native event sources
- A component has a **state machine driven jointly by React state and native events** — `expo-video`, `AppState`, `BackHandler`, `useTVEventHandler`, `AccessibilityInfo`
- The component uses `Animated` with state changes inside `.start(cb)`'s completion callback
- Focus management relies on `TVFocusGuideView`, `hasTVPreferredFocus`, or conditionally-mounted focus-trap targets
- The component can unmount during native-event delivery (route changes, Expo Router stack pops, rapid back-and-reopen navigation)

Specific trigger signals during implementation or review:

- Any `useEffect` that calls `player.addListener(...)` and also calls `setState` inside the listener
- Any `Animated.timing(...).start(() => setState(...))`
- Any `useTVEventHandler` that gates on event type
- Any `AppState` handler that modifies overlay visibility but doesn't call the same `revealControls` code path a user gesture would
- Any `setTimeout` scheduled inside a native-event callback

## Examples

All examples are inline in the Guidance section above — each pattern includes a before/after from the actual fix commits (`58a570b`, `a289abb`, `2fd092c`) pulled from `apps/tv/src/components/VideoPlayer.tsx`. The file is the canonical reference.

## Related

- [`docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`](../best-practices/react-native-tvos-porting-pitfalls-20260414.md) — umbrella pitfalls; this learning closes a gap (state-machine stale closures + Animated handle lifecycle) not covered there. **Refresh candidate** — consider adding a pitfall entry that cross-links here.
- [`docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md`](../best-practices/playlist-video-player-sdui-mobile-20260409.md) — shares the `wasPlayingRef` AppState guard pattern and the `useRef`-over-state rule; Pattern 4 here extends to TV with the one-shot `hasTVPreferredFocus` flag. **Refresh candidate** — Section 5 could reference the TV-specific focus flag requirement.
- [`docs/solutions/ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md`](../ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md) — the teardown-direction counterpart to Pattern 4's resume handler: a lifecycle gate that releases a decode slot must branch on `"background"`, not `"!== active"` (transient `"inactive"` would flap it). Same `AppState` event source, opposite direction.
- [`docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md`](../best-practices/tv-focus-driven-hero-patterns-20260420.md) — sibling TV pattern doc; same debounced-timer-ref discipline applied to focus commits. **Refresh candidate** — Section 6 on `onFocus` leaf wiring could link to Pattern 5's denylist.
- [`docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md`](../ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md) — same component surface (`VideoPlayer.tsx`). Together with this doc they form the "things that broke `VideoPlayer` on tvOS" cluster.
- [`docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md`](../ui-bugs/tv-videoview-steals-dpad-focus-20260413.md) — prerequisite context: why `VideoPlayer` needs both a `TVFocusGuideView` focus trap and a catcher `Pressable`.
- [`docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md`](../mobile/full-bleed-video-hero-with-scroll-over-content.md) — same genre of "native driver runs ahead of JS state" on `Animated.Value.addListener` under `useNativeDriver: true`. Pattern 2 here is a different facet of the same class of bug.
- [react-native-tvos #852](https://github.com/react-native-tvos/react-native-tvos/issues/852) — focus loss on back-navigation; Pattern 4 is the overlay-state-machine workaround.
- PR [#830](https://github.com/JesusFilm/forge/pull/830) — the TV video-player auto-hide feature whose code review surfaced this cluster.
- Code-review run artifact: `.context/compound-engineering/ce-code-review/2026-04-23-115216-0ef2e72e/` — per-reviewer JSON (correctness, reliability, adversarial, julik-frontend-races, etc.).
