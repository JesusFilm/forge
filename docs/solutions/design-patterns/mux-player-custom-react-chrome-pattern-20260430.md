---
title: Mux Player + custom React-rendered chrome (HeroPlayerControls pattern)
date: 2026-04-30
category: docs/solutions/design-patterns
module: apps/web, packages/video-player
problem_type: design_pattern
component: tooling
severity: medium
related_components:
  - apps/web
  - packages/video-player
tags:
  - mux-player
  - react
  - video-chrome
  - shadow-dom
  - css-custom-properties
  - pointer-capture
  - auto-hide
  - keyboard-accessibility
  - lift-state
  - ios-fullscreen
applies_when:
  - You need to customize Mux Player chrome beyond what its CSS Custom Properties expose
  - You need a layout that media-chrome's slot system cannot express (e.g., play+timeline inline at 60% width with auto-hide)
  - You need first-party React state for the chrome (auto-hide timers, hover-pauses-timer logic, focus-within keyboard reveal)
  - You need agent-native test IDs / data attributes that you can't add to Mux's shadow DOM
  - You need iOS Safari fullscreen on the wrapper element (requires webkit-prefixed fallbacks)
  - You explicitly accept the trade — losing Mux's accessibility, captions, AirPlay, and quality-selector affordances and rebuilding only what you ship
---

# Mux Player + custom React-rendered chrome (HeroPlayerControls pattern)

## Context

Mux Player (`@mux/mux-player-react`) ships with built-in chrome via the [media-chrome](https://github.com/muxinc/media-chrome) primitives. Its theming surface is **CSS Custom Properties only** — useful for color tweaks, control visibility toggles, gradient backdrops — but it cannot express:

- Custom layouts (e.g., play button to the **left** of the timeline rather than stacked above it)
- Inline-row controls constrained to a centered fraction of the player width
- Auto-hide on inactivity with a focus/hover-aware cancel system
- Per-control accessibility hooks (`data-testid`, `aria-pressed`, `data-current-time`) for agent-driven E2E tests
- Pointer-capture-driven volume sliders that survive auto-hide mid-drag

Earlier in `feat-watch-page-mux-parity`, the team evaluated **Video.js v10** specifically _because_ its flagship feature is a JSX-composable, tree-shakeable skin model — exactly this paradigm out of the box (~25 KB gz). v10 was rejected because the beta lacks captions/audio-track menus, AirPlay, quality selector, and settings cog (epic #500 blocks all menu features), with the maintainers themselves saying "not yet" for major migrations. **Mux Player won, with the explicit acceptance that bespoke chrome would have to be built.** This pattern is the realization of that acceptance.

The original plan ([`docs/plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md`](../../plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md), R5/R6/U5) anticipated a **hide-then-reveal** model: hide Mux's chrome during the muted autoplay loop, then reveal Mux's native chrome after the user clicks "Play with Sound." This works but ties the team to Mux's chrome layout and leaves the agent-native, accessibility, and layout asks above unresolved. **The current pattern diverges to "always hidden + parallel React chrome"** — Mux's chrome is permanently disabled and `<HeroPlayerControls />` renders the entire control surface in plain React. (session history)

## Guidance

The pattern has four load-bearing pieces. Skip any one and the chrome breaks subtly.

### 1. Hide Mux's chrome unconditionally

Pass a constant `style` prop with the four chrome-region disabling CSS Custom Properties. Reference: <https://github.com/muxinc/elements/blob/main/packages/mux-player/REFERENCE.md>

```tsx
const CHROME_HIDE_STYLE: MuxCSSProperties = {
  "--controls": "none",
  "--top-controls": "none",
  "--center-controls": "none",
  "--bottom-controls": "none",
}

<MuxPlayer
  ref={setPlayerRef}
  style={CHROME_HIDE_STYLE}   // always — never toggle to undefined
  /* ...playbackId, autoPlay, etc... */
/>
```

This is per-instance. Hiding chrome via global CSS like `mux-player::part(...)` gets blocked by media-chrome's stacking and positioning of the slot containers — `display: flex` on the part disrupts the absolute-bottom anchor and the controls jump to the top of the player. Use the CSS Custom Properties path; do not try to layout-pierce the shadow DOM.

### 2. Lift the player ref to React state for re-bind on remount

This is the most subtle correctness requirement. The naive pattern uses `useRef<MuxPlayerRef | null>(null)` and reads `playerRef.current` inside the chrome's subscribe `useEffect` with deps `[playerRef]`. The deps watch the **ref object identity**, which never changes — so the effect runs once at mount and never re-binds if Mux remounts (language switch, `playbackId` change, suspense recovery, error retry). Symptom: chrome appears responsive but `play`, `mute`, `seek`, `volume`, fullscreen all silently no-op. No error, no log.

The fix is to lift the player to React state alongside the ref:

```tsx
// In the parent (HeroPlayer):
const playerRef = useRef<MuxPlayerRef | null>(null)
const [player, setPlayer] = useState<MuxPlayerRef | null>(null)
const setPlayerRef = useCallback((next: MuxPlayerRef | null) => {
  playerRef.current = next
  setPlayer(next)
  onPlayerReady?.(next)
}, [onPlayerReady])

return (
  <MuxPlayer ref={setPlayerRef} ... />
  {chromeRevealed && (
    <HeroPlayerControls
      player={player}              // state, drives effect re-runs
      playerRef={playerRef}        // ref, used inside callbacks
      wrapperRef={wrapperRef}
    />
  )}
)
```

Inside the chrome:

```tsx
useEffect(() => {
  if (!player || typeof player.addEventListener !== "function") return
  const sync = () => {
    /* read player.paused / .muted / .currentTime / .volume / .duration / .buffered */
  }
  sync()
  const events = [
    "timeupdate",
    "durationchange",
    "loadedmetadata",
    "play",
    "pause",
    "volumechange",
    "progress",
  ] as const
  events.forEach((e) => player.addEventListener(e, sync))
  return () => events.forEach((e) => player.removeEventListener(e, sync))
}, [player]) // <-- player state, NOT playerRef
```

This matches the [React StrictMode + DOM-wrapping widget teardown](./react-strictmode-dom-wrapping-widget-teardown-20260424.md) guidance: split widget-init from data effects, depend on the lifted state so React-driven re-bind boundaries align with the widget's lifecycle.

### 3. Subscribe to player events; never read live values during render

The `sync` function reads `player.paused`, `player.muted`, `player.volume`, `player.currentTime`, `player.duration`, and `player.buffered` and pushes them into local React state. The chrome reads only the React state — never `playerRef.current.x` during render. This keeps render pure, plays nicely with concurrent rendering, and gives Strict-Mode-stable behavior.

Two failure modes to guard:

- **`buffered.end(b.length-1)` can throw `InvalidStateError`** mid-seek. Wrap in try/catch:
  ```tsx
  try {
    const end = b.end(b.length - 1)
    setBufferedPct(Math.min(100, (end / d) * 100))
  } catch {
    // TimeRanges can throw mid-seek; ignore until next progress event.
  }
  ```
- **Clamp percentages to ≤100.** End-of-stream samples can produce `progressPct > 100`; Tailwind doesn't clamp `width: 105%` and the bar overflows.

### 4. Render the entire chrome in React with first-party state

Stack the chrome layers explicitly. Inside the player wrapper:

| Layer                                                | z-index | Pointer events | Purpose                                           |
| ---------------------------------------------------- | ------- | -------------- | ------------------------------------------------- |
| `<MuxPlayer>`                                        | (flow)  | auto           | The video                                         |
| Click surface (`<button aria-hidden tabIndex={-1}>`) | `z-0`   | auto           | Click anywhere → toggle play/pause; cursor source |
| Backdrop gradient (`<div aria-hidden>`)              | (no z)  | none           | Visual readability backdrop                       |
| Chrome (`<div data-visible={...}>`)                  | `z-10`  | auto (always)  | Play / timeline / time / volume / fullscreen      |

Do **not** flip the chrome to `pointer-events-none` when auto-hiding. Doing so blocks agent `.click()` and keyboard interactions even though the user can still see roughly where the controls were. Keep `pointer-events: auto` always; toggle only `opacity` (and let the wrapper-level reveal listeners bring it back to opacity-100 on the next interaction).

## Why This Matters

- **Total layout control.** Mux's slot system anchors regions; React composes them however you want. The watch page wanted `[play] [—— timeline ——] [time] [mute] [vol slider] [fullscreen]` at 60% width centered with a tall bottom-up gradient. CSS Custom Properties can't express this; React can.
- **Agent-native by construction.** Every interactive element is a real React DOM node with `data-testid`, `aria-label`, `role="slider"`, `aria-valuemin/max/now/valuetext`. Playwright/Stagehand can drive it without any shadow-DOM piercing. Mux's chrome is in shadow DOM; you can't add testids to it.
- **First-party state for delicate interactions.**
  - 3-second auto-hide timer that pauses while paused / hovering controls / dragging volume
  - Cursor hides with the chrome (`wrapper.style.cursor = "none"`) and restores on mousemove
  - Volume slider expands on hover **and on focus-within** (keyboard accessibility)
  - Volume drag uses `setPointerCapture` + `onLostPointerCapture` so capture release (page hidden, touch preempted, container collapses) doesn't leak `volumeDragging = true`
- **Preserves Mux Data attribution.** `MuxPlayer` is still mounted and its `metadata` prop is still wired (player_name, video_title, video_id, viewer_user_id via `useSyncExternalStore`). Hiding chrome does not affect analytics. (session history — viewer-id SSR snapshot pattern is load-bearing)
- **Survives the iOS user-activation gate.** The pre-reveal "Play with Sound" pill still calls `muted=false; currentTime=0; play()` synchronously inside the click task with **no `await` between** — that invariant from the prior session's U5 spike must be preserved when adding new chrome state. `setChromeRevealed(true)` only fires from the resolved `play()` promise. (session history — load-bearing iOS invariant)

## When to Apply

- You're customizing Mux Player chrome on a single, controlled surface (not a polymorphic Video block — for those, accept Mux's default chrome).
- You need any of: custom layout, agent-native testids, focus-within keyboard accessibility, auto-hide with hover/drag pauses, cursor auto-hide, or first-party React state for the controls.
- You accept the trade-off: **you ship every control yourself.** Mux's captions menu, audio-track picker, AirPlay button, quality selector, settings cog — all gone. Add only the controls your product needs (this watch page ships play, timeline, time, mute+volume slider, fullscreen).

Don't apply when:

- The Mux defaults are good enough — accept them.
- You can solve the issue with CSS Custom Properties alone (color, gradient backdrop, hide individual buttons via `--bottom-pip-button: none`, etc.).
- You need a polymorphic player surface where editors swap player implementations — the pattern assumes a single hard-wired player instance.
- The page is the standalone Mux embed route (`/watch/[c]/[v]/[l]/embed`) where Mux's default chrome is intentional. (session history — embed route is non-customized by design)

## Examples

### File layout

The pattern lives across three files in `apps/web/src/components/watch/`:

- **`HeroPlayer.tsx`** (~225 LOC) — orchestration. Owns `playerRef` + `player` state, `chromeRevealed` state, the pre-reveal "Play with Sound" pill, and the `<MuxPlayer>` mount.
- **`HeroPlayerControls.tsx`** (~530 LOC) — the custom chrome itself. Subscribes to player events, owns auto-hide / cursor / volume drag / fullscreen state, renders the entire control surface.
- **`ChromeButton.tsx`** (~30 LOC) — 44px round black/30 button primitive used by play, mute, fullscreen. Plus `formatTime(seconds)` helper.
- **`chrome-icons.tsx`** (~100 LOC) — 8 inline SVG icons (Play, Pause, ChromeVolume, ChromeMuted, EnterFullscreen, ExitFullscreen, MutedSpeaker, UnmutedSpeaker). The 6 chrome glyphs share a `ChromeGlyph` primitive parameterized by SVG path.

### Auto-hide timer with refs in commit-phase effects

The auto-hide timer reads `playing` and `hoveringControls` from refs (so the wrapper-level mousemove listener doesn't get re-subscribed on every render), but the ref **writes** happen in commit-phase `useEffect` blocks — never during render — so concurrent rendering replays don't leave the refs in interim states.

```tsx
const playingRef = useRef(false)
const hoveringControlsRef = useRef(false)
useEffect(() => {
  playingRef.current = playing
}, [playing])
useEffect(() => {
  hoveringControlsRef.current = hoveringControls
}, [hoveringControls])

const scheduleHide = useCallback(() => {
  if (hideTimerRef.current != null) {
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }
  if (
    !playingRef.current ||
    hoveringControlsRef.current ||
    volumeDraggingRef.current
  ) {
    return // paused / hovering / mid-drag — don't auto-hide
  }
  hideTimerRef.current = window.setTimeout(() => {
    setControlsVisible(false)
    hideTimerRef.current = null
  }, 3000)
}, [])
```

The wrapper-level reveal listener (`pointermove`, `touchmove`, `touchstart`, `click`, `keydown`) calls `showControls()` on every interaction; `showControls` calls `scheduleHide()` which always cancels-then-reschedules. The result is a self-resetting 3s countdown that respects every "don't hide" condition.

### iOS Safari fullscreen with webkit fallbacks

```tsx
const toggleFullscreen = useCallback(() => {
  const wrapper = wrapperRef.current
  if (!wrapper) return
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null
    webkitExitFullscreen?: () => Promise<void> | undefined
  }
  const wrapperEl = wrapper as HTMLDivElement & {
    webkitRequestFullscreen?: () => Promise<void> | undefined
  }
  const isFs = !!(document.fullscreenElement ?? doc.webkitFullscreenElement)
  if (isFs) {
    const exit = document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.()
    exit?.catch?.((err) =>
      console.warn("[HeroPlayer] exitFullscreen rejected", err),
    )
  } else {
    const req =
      wrapperEl.requestFullscreen?.() ?? wrapperEl.webkitRequestFullscreen?.()
    req?.catch?.((err) =>
      console.warn("[HeroPlayer] requestFullscreen rejected", err),
    )
  }
}, [wrapperRef])

// And the listener:
useEffect(() => {
  const handleFsChange = () => {
    const fsEl =
      document.fullscreenElement ??
      (document as Document & { webkitFullscreenElement?: Element | null })
        .webkitFullscreenElement
    setIsFullscreen(!!fsEl)
  }
  document.addEventListener("fullscreenchange", handleFsChange)
  document.addEventListener("webkitfullscreenchange", handleFsChange)
  return () => {
    document.removeEventListener("fullscreenchange", handleFsChange)
    document.removeEventListener("webkitfullscreenchange", handleFsChange)
  }
}, [])
```

iPhone Safari does **not** allow fullscreen on arbitrary elements like the wrapper `div` — only the inner `<video>` element via `videoEl.webkitEnterFullscreen()`. The webkit-prefixed fallbacks above cover desktop Safari and iPad, but iPhone-specific full-fullscreen still needs to delegate to the `<video>` element directly. **Verify on real device hardware** before claiming iPhone fullscreen works.

### Volume slider with pointer capture + lost-capture safety

```tsx
const handleVolumePointerDown = useCallback(
  (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setVolumeDragging(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer released early */
    }
    setPlayerVolume(computeVolumeFromClientX(e.clientX))
  },
  [computeVolumeFromClientX, setPlayerVolume],
)

const handleVolumePointerUp = useCallback(
  (e: React.PointerEvent<HTMLDivElement>) => {
    setVolumeDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  },
  [],
)

// Critical: the OS can revoke capture (page hidden, touch preempted, container animates closed)
// and the regular pointerup never fires. Without this handler, volumeDragging stays stuck true
// and the auto-hide guard never re-arms.
const handleVolumeLostPointerCapture = useCallback(() => {
  setVolumeDragging(false)
}, [])
```

### Pre-reveal pill iOS-safe sequence (preserve from prior session)

Do not perturb this sequence. Both the unmute branch and the tap-to-unmute (autoplay-blocked) branch must call `play()` synchronously inside the click handler with no `await` separating them. (session history — load-bearing invariant)

```tsx
const handleUnmuteClick = useCallback(() => {
  const player = playerRef.current
  if (!player) return

  if (pillState === "tap-to-unmute") {
    player.muted = false
    const tapResult = player.play() // MUST call play() — earlier code only set muted=false
    tapResult?.catch?.((err) =>
      console.warn("[HeroPlayer] tap-to-unmute play() rejected", err),
    )
    setChromeRevealed(true)
    return
  }

  player.muted = false
  player.currentTime = 0
  const result = player.play()
  if (result?.then) {
    result
      .then(() => {
        setChromeRevealed(true)
        setAutoplayBlocked(false)
      })
      .catch(() => {
        setPillState("tap-to-unmute")
      })
  } else {
    setChromeRevealed(true)
  }
}, [pillState])
```

### Don't rebuild what's already there

Before building the chrome from scratch, check `packages/video-player/src/useVideoPlayerCore.ts` — it already exposes `formatTime()`, `handlePlayPause`, `handleMuteToggle`, `handleSeek`, `handleFullscreen` for the legacy video.js 8 surface. Some of those primitives can be lifted directly (e.g., `formatTime`). The HeroPlayerControls implementation duplicated `formatTime` rather than importing it — a minor follow-up to consolidate. (session history — prior art exists; check before reimplementing)

### Test fixture pattern

The new `HeroPlayerControls` test suite lives in `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`. The Mux Player is mocked at the module boundary with a singleton mock player exposing `paused`, `muted`, `volume`, `currentTime`, `duration`, `buffered`, `play`, `pause`, `addEventListener`, `removeEventListener`. The `revealChrome()` helper renders `<HeroPlayer>`, clicks the pill, awaits the play promise — the chrome is now mounted and `mockPlayerRef.current` is the singleton. Tests then directly mutate the mock and dispatch `KeyboardEvent`s on `data-testid="hero-chrome-timeline"` etc.

**Limitation to be aware of:** the mock's `addEventListener` is `vi.fn()` — it doesn't actually invoke captured callbacks. So tests that need React state to _react_ to mock-state changes (e.g., "does not auto-hide while paused" needs `playingRef.current` to flip to `false`) currently fail and are marked `it.todo`. Upgrading the mock to capture and replay listeners would unlock those tests; tracked as a follow-up.

## Related

- [`docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md`](./react-strictmode-dom-wrapping-widget-teardown-20260424.md) — sibling pattern for the widget setup/teardown rules; the lift-to-state guidance here is the same principle applied to event subscription.
- [`docs/plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md`](../../plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md) — the plan that documented the Mux-vs-Video.js decision, the iOS-safe play() invariant (U5), and the original "hide-then-reveal" model that this pattern diverges from.
- `packages/video-player/src/useVideoPlayerCore.ts` — direct prior art for the timeline/slider/play-pause/fullscreen primitives on video.js 8; reference when extending the Mux chrome with new controls.
- `apps/tv/src/components/VideoPlayer.tsx` — TV-side parallel implementation (expo-video + D-pad). Different runtime but the timeline/scrubbing UX should converge with web. (session history)
- PR [#866](https://github.com/JesusFilm/forge/pull/866) — the implementation this pattern documents.
