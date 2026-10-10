---
title: Mux Player + custom React-rendered chrome (HeroPlayerControls pattern)
date: 2026-04-30
last_updated: 2026-07-14
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
  - sticky-positioning
  - react-portal
  - scroll-over-video
  - resize-observer
  - svh-units
applies_when:
  - You need to customize Mux Player chrome beyond what its CSS Custom Properties expose
  - You need a layout that media-chrome's slot system cannot express (e.g., play+timeline inline at 60% width with auto-hide)
  - You need first-party React state for the chrome (auto-hide timers, hover-pauses-timer logic, focus-within keyboard reveal)
  - You need agent-native test IDs / data attributes that you can't add to Mux's shadow DOM
  - You need iOS Safari fullscreen on the wrapper element (requires webkit-prefixed fallbacks)
  - You want a sticky-hero scroll-over layout where body content slides over the pinned video with a frosted-glass effect
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

Do **not** flip the chrome to `pointer-events-none` when auto-hiding. Doing so blocks agent `.click()` and keyboard interactions even though the user can still see roughly where the controls were. Keep `pointer-events: auto` always; toggle only `opacity` (and let the reveal listeners — see section 5 below for the dual-target binding rule once chrome is portaled — bring it back to opacity-100 on the next interaction).

### 5. Sticky-hero scroll-over-video layout (added 2026-05-01)

When the watch page wants the video to **pin** at the viewport while body content slides over it with a frosted-glass effect, four pieces are load-bearing. Skip any one and the layout breaks subtly.

#### 5a. Sticky positioning with measured height — `top: min(0px, calc(100svh - heroHeight))`

The hero `<MuxPlayer>` is taller than the viewport on desktop (1071px tall in a 783px viewport at 1920w). Naive `position: sticky; top: 0` pins the **top** edge immediately and the hero never scrolls — users never reach the bottom of the player. The desired contract is _let the hero scroll naturally until its bottom edge reaches the viewport bottom, then pin._ That requires a negative `top` value derived from the live measured height.

```tsx
// apps/web/src/components/watch/HeroPlayer.tsx
const [heroHeight, setHeroHeight] = useState<number | null>(null)

// Updated 2026-05-04: this is `useLayoutEffect`, not `useEffect`. Once
// `aspect-video` was added to the wrapper className (see below), the
// wrapper has a real layout-derived height before the first paint.
// `useEffect` runs after paint, so for one frame `heroHeight` would
// still be null and `top` would render as `0px` instead of the
// correct calc — visible on first load. `useLayoutEffect` runs after
// DOM mutation but before paint, eliminating the flash.
useLayoutEffect(() => {
  const el = wrapperRef.current
  if (!el) return
  const apply = (h: number) => {
    if (h > 0) setHeroHeight(h)
  }
  apply(el.getBoundingClientRect().height)
  if (typeof ResizeObserver === "undefined") return
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (entry) apply(entry.contentRect.height)
  })
  observer.observe(el)
  return () => observer.disconnect()
}, [])

// In JSX:
<div
  ref={wrapperRef}
  // Updated 2026-05-04: `aspect-video` locks the wrapper to 16:9 of
  // its width from the moment of mount. Without it, the wrapper has
  // no intrinsic height until Mux Player resolves the video's
  // dimensions — and Mux's element falls back to its built-in
  // ~200px min-height during the buffer phase, collapsing the hero
  // and stacking the title/Play-with-Sound pill on top of the
  // floating search bar. With `aspect-video`, the wrapper is
  // deterministic from the first paint and matches the eventual
  // loaded size on a 16:9 asset.
  className="sticky aspect-video w-full overflow-hidden bg-black"
  style={{
    top:
      heroHeight != null
        ? `min(0px, calc(100svh - ${heroHeight}px))`
        : "0px",
  }}
>
```

The formula `min(0px, calc(100svh - heroHeight))` has two cases:

- When `heroHeight > 100svh`: the result is negative. The hero scrolls naturally until its bottom hits the viewport bottom, then pins.
- When `heroHeight <= 100svh`: the result is `0px` or positive; `min` clamps it to `0px`. The hero pins flush to the top from the start. (Equivalent to ordinary sticky-top-zero on small viewports.)

**Use `100svh`, not `100vh`.** On iOS Safari, `100vh` resolves to the _large_ viewport (URL bar hidden) regardless of whether the URL bar is currently showing. While the URL bar is up, `getBoundingClientRect` reflects the actual constrained height — so `100vh - heroHeight` may go slightly positive, `min(0px, +)` clamps to zero, and the hero pins immediately at the top. `100svh` (small viewport) is always ≤ the visible height, keeping the formula negative when the hero is taller than the current visible area.

The `if (h > 0)` guard prevents a brief flash where `getBoundingClientRect` returns zero before layout. The `typeof ResizeObserver === "undefined"` guard keeps the effect compatible with jsdom (the test environment ships without RO; the initial getBoundingClientRect read is enough for `top: 0px` fallback rendering).

#### 5b. Zero-height anchor in normal flow

Render a `<div className="relative z-10 h-0 w-full">` immediately after the sticky wrapper. The anchor is in normal flow (not sticky), so it scrolls with the document body. Anything absolutely-positioned to its `bottom-0` edge therefore travels upward as the user scrolls — exactly tracking the top of the body section.

```tsx
const [overlayAnchor, setOverlayAnchor] = useState<HTMLDivElement | null>(null)

return (
  <>
    <div ref={wrapperRef} className="sticky ...">
      {/* MuxPlayer + click surface + gradient */}
    </div>
    <div
      ref={setOverlayAnchor}
      data-testid="hero-player-overlay-anchor"
      className="relative z-10 h-0 w-full"
    >
      {!chromeRevealed ? (
        <div
          data-testid="hero-player-overlay"
          className="absolute right-6 bottom-0 left-10 pb-6 ..."
        >
          {/* SHORTFILM label, title, Play with Sound pill */}
        </div>
      ) : null}
    </div>
  </>
)
```

`h-0` is critical. The anchor takes up no vertical space in layout — it is purely a positioning origin. Two pieces attach to its `bottom-0`:

- The pre-reveal title/label/Play-with-Sound overlay renders as a direct child while `chromeRevealed === false`.
- The post-reveal chrome control bar from `<HeroPlayerControls>` is portaled into the same anchor while `chromeRevealed === true` (see 5c).

Both ride the body section's top edge during scroll instead of being trapped at the sticky hero's pinned bottom (where they would otherwise be covered by the sliding body).

#### 5c. Portal the chrome bar into the anchor

Inside `HeroPlayerControls`, the chrome bar JSX is portaled into the anchor passed in as a prop. The click-surface and bottom gradient stay inside the sticky wrapper (they need to cover/darken the player); only the chrome bar moves out.

```tsx
// apps/web/src/components/watch/HeroPlayerControls.tsx
import { createPortal } from "react-dom"

const chromeBar = (
  <div
    data-testid="hero-player-custom-chrome"
    className="absolute bottom-0 left-1/2 z-10 -translate-x-1/2 ..."
  >
    {/* Play / Timeline / Time / Mute / Fullscreen */}
  </div>
)

return (
  <>
    <button
      data-testid="hero-player-click-surface" /* inside wrapper, click-anywhere-to-pause */
    />
    <div /* gradient at bottom of wrapper */ />
    {overlayAnchor != null ? createPortal(chromeBar, overlayAnchor) : null}
  </>
)
```

The portal severs the React component tree from the DOM tree: `<HeroPlayerControls>` lives under `<HeroPlayer>` in React (receiving `player`, `playerRef`, `wrapperRef`, `overlayAnchor` props naturally), but its chrome-bar DOM is injected into the anchor that lives in normal flow. This is the only way to keep a single component reading wrapper/player refs while rendering chrome DOM at a different scroll-tracking position.

The parent always renders the anchor div before this component mounts (gated on `chromeRevealed`), so `overlayAnchor` is non-null by the time `HeroPlayerControls` renders. There is no need for an inline-render fallback — at first that path looked defensive, but it is unreachable in practice and adds confusion.

#### 5d. Reveal listeners on BOTH the wrapper AND the anchor

This is the gotcha that wasted real time. `HeroPlayerControls` attaches reveal listeners (`pointermove`, `touchmove`, `touchstart`, `click`, `keydown`) to a target element so `showControls()` re-runs on user interaction. The naive choice is `wrapperRef.current` — and that worked when the chrome bar was a child of the wrapper. **Once the chrome bar is portaled into the anchor**, the chrome bar lives in a DOM subtree that is a _sibling_ of the wrapper, not a descendant. Native event listeners only fire on events bubbling through their own DOM subtree. Wrapper-only binding silently misses every event on the portaled chrome bar — the auto-hide cycle becomes one-way: 3-second timer hides controls, hovering or keyboard-focusing the bar never re-reveals them.

Bind to **both** targets:

```tsx
useEffect(() => {
  const reveal = () => showControls()
  const targets = [wrapperRef.current, overlayAnchor].filter(
    (t): t is HTMLDivElement => t != null,
  )
  for (const target of targets) {
    target.addEventListener("pointermove", reveal)
    target.addEventListener("touchmove", reveal)
    target.addEventListener("touchstart", reveal)
    target.addEventListener("click", reveal)
    target.addEventListener("keydown", reveal)
  }
  return () => {
    for (const target of targets) {
      target.removeEventListener("pointermove", reveal)
      target.removeEventListener("touchmove", reveal)
      target.removeEventListener("touchstart", reveal)
      target.removeEventListener("click", reveal)
      target.removeEventListener("keydown", reveal)
    }
  }
}, [wrapperRef, overlayAnchor, showControls])
```

Pointermove on the chrome bar bubbles through chrome → anchor → reveal handler. Pointermove on the video itself bubbles through MuxPlayer → wrapper → reveal handler. Both paths covered.

**Verify by dispatching `new PointerEvent("pointermove", { bubbles: true })` on the chrome bar** after auto-hide and confirming `data-visible` flips back to `"true"`. This is the single behavior worth a Playwright assertion.

#### 5e. Frosted-glass body slides over the pinned hero

The body section sibling-rendered after the hero already had `bg-stone-800` overridden with `rgb(var(--color-section-default) / 0.35)` plus `backdrop-blur-2xl`. With sticky hero behind it in paint order and `backdrop-filter: blur(40px)` on the body, reliable browser compositors sample the playing video texture through the translucent body — the dark frosted-glass effect without JavaScript or canvas compositing.

**Firefox rendering caveat.** Firefox can retain the expected `backdrop-filter` computed style while dropping the painted blur as this sheet scrolls over the sticky video. Keep the structural pattern, but scope a Firefox-only near-opaque, neutral-dark fallback to the body backdrop hook; reliable browsers should retain the glass treatment. See [`firefox-backdrop-filter-sticky-hero-scroll-fallback.md`](../ui-bugs/firefox-backdrop-filter-sticky-hero-scroll-fallback.md) for the reproduction evidence, Mozilla bug reports, and current CSS workaround.

**Stacking-context caveat.** The pattern depends on the sticky hero and the body section sharing a stacking context rooted at or near the page root. Any ancestor with `transform`, `filter`, `backdrop-filter`, `will-change`, `opacity < 1`, or `isolation: isolate` between page root and the hero will silently create a new stacking context and can flip paint order — breaking the glass effect or trapping the chrome bar under the body. Cross-reference [`docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md) §2 for the full list of stacking-context-creating CSS properties; portaling out of trapping subtrees is the same escape hatch used by the search overlay.

**Tab-order caveat.** The portaled chrome bar appears far below the sticky hero in DOM source order. Keyboard users tabbing through the page will reach the chrome at a point in the tab sequence that does not match its visual position. Consider `tabindex` management or a focus trap when the chrome is revealed if tab-order fidelity is important.

**Backdrop-blur compositor cost.** `backdrop-blur-2xl` (40px) repaints the blur over a moving Mux video texture every scroll frame. Flagship desktop and recent phones hold 60fps; midrange Android (~2–3 yr old Snapdragon) often drops to 30–45fps during scroll. Profile on a Pixel 6a / Galaxy A-series device before broad rollout. If frame drops are unacceptable, lower the blur radius (`backdrop-blur-xl` / `-lg`) on small viewports or fall back to a solid translucent color when `prefers-reduced-motion` is set. (session history — mobile counterpart pattern quantized scroll updates for the same reason; see Related)

### 5f. Loading spinner with `onCanPlay` + `onError` recovery + render-phase reset (added 2026-05-04)

Once `aspect-video` locks the wrapper at 16:9 (5a), the wrapper has a deterministic full-size box from mount — but Mux Player itself paints a black rectangle while the manifest fetches. On a search-result navigation that hits a cold Mux asset, that black rectangle can sit visible for 1-3 seconds before the muted-loop preview begins. A spinner overlay during that window gives the user feedback that the player is loading rather than broken.

The state machine has three load-bearing pieces. Skip any one and the spinner either flashes incorrectly, sticks forever, or fails to re-show on language switch.

```tsx
const [videoReady, setVideoReady] = useState(false)
const handleCanPlay = useCallback(() => {
  setVideoReady(true)
}, [])

const handlePlayerError = useCallback((event: CustomEvent) => {
  const code = (event?.detail as { code?: string } | undefined)?.code
  if (code === "autoplay-blocked") {
    setAutoplayBlocked(true)
  }
  // Any non-autoplay-blocked error (network, decode, manifest 404…)
  // means we will never fire onCanPlay, so videoReady would otherwise
  // stay false forever and the spinner would sit on a black box.
  // Reveal the player element so Mux Player can render its own
  // error UI.
  setVideoReady(true)
}, [])

// Reset the buffered/ready spinner when the playable identity changes
// (variant switch via the language picker, or new playback id).
// Render-phase setState — NOT useEffect — to avoid the React Compiler
// "cascading renders" lint rule. The new state is queued before commit.
const [prevVariantKey, setPrevVariantKey] = useState(variant.documentId)
if (prevVariantKey !== variant.documentId) {
  setPrevVariantKey(variant.documentId)
  setVideoReady(false)
}

// In JSX, layered inside the sticky wrapper from 5a:
;<MuxPlayer
  ref={setPlayerRef}
  playbackId={playbackId}
  onCanPlay={handleCanPlay}
  onError={handlePlayerError}
  /* ...rest of props... */
/>
{
  !videoReady ? (
    <div
      data-testid="hero-player-loading"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black"
    >
      <SpinnerIcon className="h-12 w-12 text-white/80" />
    </div>
  ) : null
}
```

The three load-bearing pieces:

1. **`onError` must call `setVideoReady(true)` for non-autoplay-blocked codes.** Without this, any hard Mux failure (network outage, 404 manifest, decode error, expired playback token) leaves `videoReady=false` permanently — the spinner overlays a black box forever with no recovery path. The spinner is only correct when there is a possibility of `onCanPlay` firing; if that possibility is gone, the spinner has to clear so Mux Player's own error UI becomes visible.
2. **State reset on prop change must be render-phase, not effect-phase.** The naive pattern is `useEffect(() => setVideoReady(false), [variant.documentId, playbackId])`. The React Compiler ESLint rule (`react-hooks-rule-react-compiler`) flags this as "Calling setState synchronously within an effect can trigger cascading renders" and fails CI at error level. The canonical pattern is "adjust state during render": track the previous variant key in state and reset inline when it changes. The new state is queued before commit, so no cascade.
3. **`pointer-events-none` on the spinner overlay.** The unmute pill below the wrapper has to remain clickable through the spinner; without `pointer-events-none`, the spinner intercepts the click and the pill never fires.

`onCanPlay` is the right event for "first frame ready to render," not `loadedmetadata` (fires too early — duration is known but no frame is buffered) or `playing` (fires too late — already played past the first frame). The muted-loop preview's `autoPlay="muted"` will trigger `canplay` once enough buffer is available; on hard failures, `error` fires instead and the recovery branch above clears the spinner.

**Stale-spinner-on-language-switch trap.** When the user opens the language picker and switches variants, `<HeroPlayer>` typically does not unmount — only `variant` changes. Without the render-phase reset above, `videoReady=true` from the previous variant suppresses the spinner during the new variant's buffer phase, and the user sees a frozen frame from the previous language while the new manifest loads. The render-phase reset on `variant.documentId` fixes this without remounting the component (which would lose `chromeRevealed`, autoplay state, current playhead, etc.).

**Test coverage requires invoking captured callbacks.** The existing `muxPlayerMock` in `HeroPlayer.test.tsx` captures `onCanPlay`, `onError`, etc. as props but never invokes them. To test the spinner state machine, upgrade the mock to expose helpers like `fireCanPlay()` / `fireError({ code })` and assert the spinner's presence/absence around them. PR #878 includes the mock upgrade and the corresponding lifecycle tests.

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

When adding that video-element fallback, branch on wrapper method availability
rather than the wrapper method's return value. Older WebKit fullscreen methods
can return `void`; a handler that falls through on an `undefined` return may
call both `wrapper.webkitRequestFullscreen()` and `video.webkitEnterFullscreen()`.

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

The load-bearing invariant is **"no `await` between the click gesture and `player.play()`"** — both branches must call `play()` synchronously in the same task as the click. (session history — iOS user-activation requirement)

**Updated 2026-05-01:** the `player.currentTime = 0` reset that originally appeared in the play-with-sound branch was removed. The muted-loop preview is already running by the time the user clicks Play with Sound (typically 2–8 seconds in); resetting to frame 0 on unmute sends a visual + auditory cue users read as "the video reloaded." Continuing from the current playhead is the correct affordance, and it does not perturb the iOS invariant — only the `await`-free contract between click and `play()` is load-bearing.

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

  // Continue from the current playhead — the muted-loop preview is already
  // running, so resetting currentTime would force a re-buffer and restart
  // from frame 0, which the user reads as "the video reloaded."
  player.muted = false
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

**Race window worth knowing about (not currently fixed).** `loop = !chromeRevealed` flips on the next render after `setChromeRevealed(true)`. There is a ~16ms window where the muted-loop preview is at `currentTime ≈ duration` and the user clicks Play with Sound: `play()` resolves, `setChromeRevealed(true)` is queued, but `ended` could fire while `loop` is still `true` — looping the preview to `0`, the very symptom the `currentTime = 0` removal was avoiding. Worst on short clips clicked within milliseconds of `duration`. Narrow window, low impact; flagged for future hardening if it turns into a reproducible regression.

### Don't rebuild what's already there

Before building the chrome from scratch, check `packages/video-player/src/useVideoPlayerCore.ts` — it already exposes `formatTime()`, `handlePlayPause`, `handleMuteToggle`, `handleSeek`, `handleFullscreen` for the legacy video.js 8 surface. Some of those primitives can be lifted directly (e.g., `formatTime`). The HeroPlayerControls implementation duplicated `formatTime` rather than importing it — a minor follow-up to consolidate. (session history — prior art exists; check before reimplementing)

### Test fixture pattern

The `HeroPlayerControls` test suite lives in `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`. The Mux Player is mocked at the module boundary with a singleton mock player exposing `paused`, `muted`, `volume`, `currentTime`, `duration`, `buffered`, `play`, `pause`, `addEventListener`, `removeEventListener`. The `revealChrome()` helper renders `<HeroPlayer>`, clicks the pill, awaits the play promise — the chrome is now mounted and `mockPlayerRef.current` is the singleton. Tests then directly mutate the mock and dispatch `KeyboardEvent`s on `data-testid="hero-chrome-timeline"` etc.

**Limitation to be aware of:** the mock's `addEventListener` is `vi.fn()` — it doesn't actually invoke captured callbacks. So tests that need React state to _react_ to mock-state changes (e.g., "does not auto-hide while paused" needs `playingRef.current` to flip to `false`) currently fail and are marked `it.todo`. Upgrading the mock to capture and replay listeners would unlock those tests; tracked as a follow-up.

**Coverage added 2026-05-01 for the sticky/portal layout.** Three tests cover the new layer:

1. **Portal placement** — asserts the chrome bar lives inside the overlay anchor, not the sticky hero wrapper. Required because both DOM positions resolve the same `[data-testid="hero-player-custom-chrome"]` selector (`container.querySelector` finds it whether portaled or rendered inline), so the assertions in the existing chrome-render tests pass for either branch. Without this test, the portal contract is unenforced.

   ```tsx
   it("portals the chrome bar into the overlay anchor, not the sticky hero wrapper", async () => {
     await revealChrome()
     const chrome = container.querySelector(
       '[data-testid="hero-player-custom-chrome"]',
     )
     const anchor = container.querySelector(
       '[data-testid="hero-player-overlay-anchor"]',
     )
     const wrapper = container.querySelector(
       '[data-testid="hero-player-wrapper"]',
     )
     expect(anchor!.contains(chrome!)).toBe(true)
     expect(wrapper!.contains(chrome!)).toBe(false)
   })
   ```

2. **Tap-to-unmute leaves currentTime alone** — the play-with-sound branch's no-restart contract is already covered by the iOS-safe click sequence test (event order `["muted=false", "play()"]` with no `currentTime=0`). The tap-to-unmute branch needs the same coverage. Phase 1: render, swap `mockPlayerRef.current.play` to reject so the pill flips into `data-state="tap-to-unmute"`. Phase 2: snapshot a non-zero playhead, swap `play` back to resolve, install an `Object.defineProperty` setter spy on `currentTime`, click. Assert no `currentTime` writes occurred.

3. **Sticky `top` from measured height** — JSDOM ships without `ResizeObserver`, so the component's RO branch is normally unreachable in tests. Stub it locally:

   ```tsx
   const callbacks: ResizeObserverCallback[] = []
   class MockResizeObserver {
     constructor(cb: ResizeObserverCallback) {
       callbacks.push(cb)
     }
     observe() {}
     disconnect() {}
     unobserve() {}
   }
   const originalRO = (globalThis as { ResizeObserver?: typeof ResizeObserver })
     .ResizeObserver
   ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
     MockResizeObserver as unknown as typeof ResizeObserver

   try {
     act(() => {
       root.render(<HeroPlayer block={makeBlock()} />)
     })
     // Trigger the captured RO callback with a measured height.
     await act(async () => {
       callbacks[0]?.(
         [
           { contentRect: { height: 1071 } } as ResizeObserverEntry,
         ] as ResizeObserverEntry[],
         {} as ResizeObserver,
       )
     })
     const wrapper = container.querySelector(
       '[data-testid="hero-player-wrapper"]',
     ) as HTMLDivElement
     // JSDOM's CSSOM normalizes whitespace inside min() inconsistently
     // across engines — check structure rather than exact format.
     expect(wrapper.style.top).toContain("calc(100svh - 1071px)")
   } finally {
     if (originalRO) {
       ;(
         globalThis as { ResizeObserver?: typeof ResizeObserver }
       ).ResizeObserver = originalRO
     } else {
       delete (globalThis as { ResizeObserver?: typeof ResizeObserver })
         .ResizeObserver
     }
   }
   ```

   The `finally` block restores the prior global unconditionally (in JSDOM, `originalRO` is `undefined`, so the block deletes the global rather than reassigning it) — preventing test pollution across the suite.

**Live verification before declaring done.** The dev server + browser-automation MCP catch the things JSDOM cannot. The minimum smoke after a sticky/portal change:

- `wrapper.getBoundingClientRect().height` matches the rendered video aspect (1071px on a 1920w window for 16:9).
- `getComputedStyle(wrapper).top` is negative (e.g., `-288.56px`) on a desktop viewport.
- After clicking Play with Sound: `anchor.contains(chrome) === true && wrapper.contains(chrome) === false`.
- After 3s auto-hide, dispatching `new PointerEvent("pointermove", { bubbles: true })` on the chrome bar flips `data-visible` from `"false"` back to `"true"`.

## Related

- [`docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md`](./react-strictmode-dom-wrapping-widget-teardown-20260424.md) — sibling pattern for the widget setup/teardown rules; the lift-to-state guidance here is the same principle applied to event subscription.
- [`docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md) — `createPortal` and the stacking-context trap. Same escape hatch (portal out of trapping subtrees) used by the search overlay; the load-bearing rule about ancestors that silently create stacking contexts (`transform`, `filter`, `backdrop-filter`, `will-change`, `opacity < 1`, `isolation`) applies equally here.
- [`docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md`](../mobile/full-bleed-video-hero-with-scroll-over-content.md) — the React Native counterpart of the same UX. Different runtime (RN absolute positioning + JS scroll callbacks vs. CSS sticky + portal), but the design decisions translate: render overlay content inside the scroll content (not the hero layer), quantize scroll updates to avoid 60fps re-renders, and avoid event-binding patterns whose silent failure mode hides controls forever.
- [`docs/plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md`](../../plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md) — the plan that documented the Mux-vs-Video.js decision, the iOS-safe play() invariant (U5), and the original "hide-then-reveal" model that this pattern diverges from.
- `packages/video-player/src/useVideoPlayerCore.ts` — direct prior art for the timeline/slider/play-pause/fullscreen primitives on video.js 8; reference when extending the Mux chrome with new controls.
- `apps/tv/src/components/VideoPlayer.tsx` — TV-side parallel implementation (expo-video + D-pad). Different runtime but the timeline/scrubbing UX should converge with web. (session history)
- PR [#866](https://github.com/JesusFilm/forge/pull/866) — the original implementation this pattern documents (chrome replacement and lift-to-state).
- The 2026-05-01 update layer (sections 5a–5e and the iOS-safe sequence patch) was developed against `main` directly without a separate PR; the working tree carries the change.
- [`docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md`](../logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md) — sibling fix from the same PR (#878). The `aspect-video` + `useLayoutEffect` + `onCanPlay`+`onError` combination in section 5a/5f was added as part of fixing the wrong-language-variant bug, because the original watch page used `useEffect` for the ResizeObserver and had no loading-state coverage at all. Read together for the full context of PR #878.
- PR [#878](https://github.com/JesusFilm/forge/pull/878) — `feat(web): fix English variant selection + redesign watch share modal + harden hero loading`. Source of the 2026-05-04 updates to sections 5a and 5f.
- [`docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`](./watch-language-player-chrome-layout-20260609.md) — current watch-page UX refinements layered on top of this pattern: language-picker icons/tooltips/I/O switch, 0.3 player/header opacity states, pointer lockout, and measured muted-preview episode-rail overlap. Read before changing the files touched in that branch.
- [`docs/solutions/ui-bugs/firefox-backdrop-filter-sticky-hero-scroll-fallback.md`](../ui-bugs/firefox-backdrop-filter-sticky-hero-scroll-fallback.md) — Firefox-specific rendering failure and neutral dark fallback for the frosted body sheet in section 5e.
