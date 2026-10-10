---
title: "D-pad TV player chrome construction: focusable scrubber, memoized chrome components, subtitle lift, stacking context, listener hygiene"
date: 2026-06-11
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "Building or redesigning fullscreen video player chrome for react-native-tvos / expo-video with D-pad navigation"
  - "A focusable control (scrubber) must consume left/right presses as actions instead of focus moves"
  - "Chrome sub-components render inside a host that re-renders at 1Hz (timeUpdate) or faster"
  - "An overlay element (subtitle, toast) must reposition when the player chrome shows/hides"
  - "A veil/loading layer coexists with a layered content area in a flat RN sibling stack"
tags:
  - react-native-tvos
  - expo-video
  - dpad-navigation
  - animated-api
  - tvfocusguideview
  - player-chrome
  - subtitle
  - stacking-context
---

# D-pad TV player chrome construction: focusable scrubber, memoized chrome components, subtitle lift, stacking context, listener hygiene

## Context

PR #1210 (`feat/tv-player-interface-redesign`) rebuilt the `apps/tv` fullscreen player chrome to the "Forge TV Video Page" design handoff: glass Back pill, circular transport, a focusable scrubber, Language/Subtitles pills, a chrome-following `SubtitleOverlay`, and a loading veil. A 10-reviewer code review plus independent per-finding validators surfaced five construction patterns that are not obvious from the react-native-tvos docs. They are the **chrome construction layer** on top of the async-event/state discipline already documented in `rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` — that doc covers when state may be read; this one covers how the chrome is built.

The action-row design itself went through a split-then-reunited arc on the predecessor branches: a two-row layout needed `TVFocusGuideView destinations` bridging that never worked in all four directions, and `nextFocusUp`/`nextFocusDown` props don't exist on `Pressable` (`ViewProps` only) — the single left-aligned row from the design handoff dissolved the problem instead of solving it (session history).

## Guidance

### 1. Focusable scrubber: horizontal focus trap + TV-event routing + eager ref-clear

**Failure prevented:** a left/right press in the 150ms chrome-fade window seeking on invisibly-fading controls.

A full-width scrubber wants left/right to mean _seek_, not _move focus_. Wrap it in `TVFocusGuideView trapFocusLeft trapFocusRight` (focus has nowhere to go), then let the global `useTVEventHandler` translate left/right into seeks, gated on a focus-mirror ref:

```tsx
// VideoPlayer.tsx — onTVEvent, after the synthetic-event denylist
if (scrubFocusedRef.current) {
  if (type === "left" || type === "swipeLeft") {
    seekBackwardRef.current()
    scheduleHideRef.current()
    return
  }
  if (type === "right" || type === "swipeRight") {
    seekForwardRef.current()
    scheduleHideRef.current()
    return
  }
}
```

The ref MUST be cleared at the top of `hideControls()`, before `setControlsFocusable(false)`. The scrubber's `onBlur` lands a tick _after_ the focusable flip, and `controlsVisibleRef` only flips false when the fade _completes_ — so without the eager clear, a press inside the fade window passes both guards and seeks against controls the user can no longer see (validated race, ce-code-review run 20260611-133904):

```tsx
const hideControls = () => {
  scrubFocusedRef.current = false // eager-clear FIRST — onBlur is too late
  setControlsFocusable(false)
  // ... start fade
}
```

Same eager-ref-sync discipline as `isPausedRef` in the `playingChange` handler (see the async-event-patterns doc).

### 2. Module-level chrome components with memoized interpolations

**Failure prevented:** ~26 `Animated` interpolation allocations per second, every second of playback.

The player host re-renders at 1Hz (`timeUpdate` → `setCurrentTime`/`setBuffered`). Two rules for every chrome sub-component (`BackPill`, `CircleControl`, `PlayCircle`, `MenuPill`, `PlayerScrubber`):

- **Define at module level**, never inside the host render — an inline component remounts per render and drops tvOS focus.
- **`useMemo` every `progress.interpolate(...)` keyed on `[progress]`** — `React.memo` is silently defeated by the host's inline arrow props, so memoizing inside the component is the tool that actually works:

```tsx
function CircleControl({ ... }) {
  const { setFocused, progress } = useFocusAnimation()
  const circleStyle = useMemo(() => ({
    backgroundColor: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
    }),
    transform: focusTransform(progress),
  }), [progress]) // progress is a stable ref — built once per mount
  ...
}
```

Precedent: `DetailsActionRow`'s pills; `focusTransform`'s own doc comment ("memoize the result at the call site"). Note `useFocusAnimation` is deliberately JS-driver — colors/shadows can't run on the native driver (session history).

### 3. Chrome-following overlays: animated offset prop + reduce-motion as STATE

**Failures prevented:** captions buried under the bottom panel; an animated slide shown to reduce-motion users; a full-width caption backdrop for a two-word cue.

`SubtitleOverlay` takes a chrome-aware `bottomOffset` (resting 64 / lifted 272) plus an `animate` flag; the host flips the offset with `controlsVisible`. Three rules inside the overlay:

- **`reduceMotion` is `useState`, not a ref.** `AccessibilityInfo.isReduceMotionEnabled()` resolves _async, after_ the offset effect's first run — a ref misses any offset change landing in that window and animates it anyway. State re-runs the effect when the seed settles.
- **Position via `translateY` from a `bottom: 0` anchor** (native driver), stopping the in-flight animation in the effect cleanup.
- **The cue Text hugs content**: bottom-anchored container with `alignItems: "center"`; never pin `left`+`right` on the Text itself (that paints the backdrop edge-to-edge).

```tsx
const [reduceMotion, setReduceMotion] = useState(false)
useEffect(() => {
  AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
  const sub = AccessibilityInfo.addEventListener(
    "reduceMotionChanged",
    setReduceMotion,
  )
  return () => {
    try {
      sub.remove()
    } catch {
      /* noop */
    }
  }
}, [])

useEffect(() => {
  if (!animate || reduceMotion) {
    translateY.setValue(-px(bottomOffset))
    return
  }
  const anim = Animated.timing(translateY, {
    toValue: -px(bottomOffset),
    duration: 200,
    useNativeDriver: true,
  })
  anim.start()
  return () => anim.stop()
}, [bottomOffset, animate, reduceMotion, translateY])
```

This mirrors `apps/mobile`'s SubtitleOverlay contract — keep the two in sync.

### 4. Stacking context: a sibling veil paints over a layered content area

**Failure prevented:** the loading veil dimming an open in-player menu.

In a flat RN sibling stack, a later sibling with `zIndex: 20` paints over an earlier `contentLayer` with `zIndex: 10` — **including everything inside it, regardless of internal zIndex**. The menu's `zIndex: 50` lives inside the contentLayer's stacking context and cannot escape it. Gate the veil's mount on the open-layer flag instead of fighting zIndex:

```tsx
{
  !hasStarted && !hasError && !menuOpen && <LoadingVeil />
}
```

### 5. Player listener hygiene: isMountedRef guards + per-source state reset

**Failures prevented:** setState on a dead tree from late native emissions; the scrubber's buffer hint painting the _previous_ source's buffered head after a `replaceAsync` dub switch.

Every `player.addListener` callback starts with the `isMountedRef` guard, and `sourceLoad` resets per-source UI state:

```tsx
player.addListener("sourceLoad", (payload) => {
  if (!isMountedRef.current) return
  setDuration(payload.duration) // update path; initializer seeds the first value
  setBuffered(0) // new source starts empty; the >= 0 filter in timeUpdate
  // would otherwise preserve the stale value through -1 emissions
})
```

Reset per-source state in `sourceLoad` (fires once per swap), not at the dub-switch call site — the listener is the single chokepoint every source change flows through.

## Why This Matters

| Pattern skipped         | What the user sees                                                 |
| ----------------------- | ------------------------------------------------------------------ |
| Eager ref-clear         | Video "skips by itself" — invisible seeks during the chrome fade   |
| Memoized interpolations | GC churn / dropped focus animations on constrained TV hardware     |
| reduce-motion as state  | Accessibility preference violated on the first chrome-hide cycle   |
| Content-hugging cue     | A black bar across the whole screen for a two-word caption         |
| Veil mount gate         | The audio/subtitle menu visibly dimmed behind "Starting playback…" |
| Listener hygiene        | Stale buffer fill after a language switch; dead-tree setState      |

## When to Apply

- Any D-pad control that consumes directional presses as actions (scrubbers, steppers): trap the axis, route via `useTVEventHandler`, eager-clear the focus mirror wherever focusability is revoked.
- Any component rendered by a 1Hz+ host: module-level definition + `useMemo([stableRef])` interpolations.
- Any overlay that follows chrome visibility (captions, toasts): animated offset prop, reduce-motion as state, content-hugging layout.
- Any veil/modal sibling next to a layered content area: gate the mount, don't escalate zIndex.
- Any `expo-video` surface with `replaceAsync` source swaps: per-source state reset in `sourceLoad`.

## Examples

Before/after for the most error-prone pattern — the eager ref-clear:

```tsx
// BEFORE: ref cleared only by the scrubber's onBlur
const hideControls = () => {
  setControlsFocusable(false) // focus engine releases the scrubber...
  // ...but onBlur lands a tick later; a left press in the 150ms fade
  // window passes scrubFocusedRef.current === true and seeks invisibly
}

// AFTER: eager-clear before revoking focusability
const hideControls = () => {
  scrubFocusedRef.current = false // guard closed before the window opens
  setControlsFocusable(false)
}
```

## Related

- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` — the state-machine discipline layer for the same component (ref-mirrors, captured animation handles, catcher gating); this doc is its construction-layer complement
- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — same branch: the concurrent-player decode-slot bug (unmount, don't pause) + the Fast-Refresh zombie dev-loop look-alike
- `docs/solutions/best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md` — the callback-stability side of the same 1Hz host-render cost (Section 5)
- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — TVFocusGuideView focus model on the same watch surface
- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — videoReady latch + manual replay on the page backdrop
- `apps/mobile/src/components/watch/SubtitleOverlay.tsx` — the mirrored caption contract (keep in sync)
