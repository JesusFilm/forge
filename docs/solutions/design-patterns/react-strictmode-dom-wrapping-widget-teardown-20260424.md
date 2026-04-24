---
title: React StrictMode + DOM-wrapping widgets — capture-and-restore teardown
date: 2026-04-24
category: docs/solutions/design-patterns
module: apps/web, packages/video-player
problem_type: design_pattern
component: tooling
severity: medium
related_components:
  - apps/web
  - packages/video-player
  - apps/manager
tags:
  - react
  - strictmode
  - useeffect
  - videojs
  - dom-refs
  - third-party-widgets
  - teardown
applies_when:
  - Integrating a third-party widget that wraps or replaces the React-ref'd DOM element (video.js, Chart.js, Mapbox, jQuery plugins, classic CKEditor/TinyMCE)
  - The widget's dispose/destroy removes its wrapper from the DOM, detaching the original ref element
  - Running under React StrictMode (Next.js App Router default in dev) so effects fire setup → cleanup → setup on mount
  - The component sets up the widget inside a useEffect where `someRef.current` is the attach target
---

# React StrictMode + DOM-wrapping widgets — capture-and-restore teardown

## Context

React StrictMode intentionally double-invokes every `useEffect` on initial mount: **setup → cleanup → setup**. The purpose is to surface effects that aren't remount-safe. Third-party libraries that wrap or replace a React-owned DOM element break under this pattern because the library's constructor mutates the DOM around the element, and its destructor removes that mutation — including the element React still holds a ref to.

Concrete walk-through with `video.js`:

1. First setup fires: `videojs(videoRef.current, opts)` creates a new `<div class="video-js">` wrapper, moves the `<video>` into it.
2. Cleanup fires: `player.dispose()` removes the whole wrapper from its original parent. The `<video>` is still in memory — React's ref still points at it — but `videoRef.current.isConnected === false` because its ancestor chain now ends in an orphan wrapper.
3. Second setup fires: `videojs(videoRef.current, opts)` runs on a detached element. video.js logs `VIDEOJS: WARN: The element supplied is not included in the DOM`, wraps the detached node anyway, and the resulting player subtree never re-enters the document. The component renders black.

In this codebase the failure mode surfaced on `apps/web`'s `VideoHero` when the floating-search redesign moved `FloatingSearchProvider` into `RootLayout`. With the provider pinned above the route boundary, experience-page navigation became a **soft** navigation (same tree, new `src`) instead of the previous full unmount/remount — and the pre-existing StrictMode warning turned into a visible black hero on `/watch/easter` → search "Christmas" → click EXPERIENCE chip → `/watch/christmas`. (session history)

The same pattern had already been solved on April 12 by Vlad in `packages/video-player/src/useVideoPlayerCore.ts` (commit `0ceb71b`). The web `VideoHero.tsx` fix is a direct port of the pattern into a bespoke hook that couldn't use the shared one (VideoHero has scrollY-threshold hysteresis scroll-pause and first-click-unmute state that don't fit the shared hook's `autoplayOnViewport` model). (session history)

## Guidance

When wiring a third-party DOM-wrapping library into a React component with `useRef` + `useEffect`:

### 1. Capture the original position _before_ the library touches the element

```tsx
const videoEl = videoRef.current
if (!videoEl) return

// Capture BEFORE videojs() wraps the element — wrapping changes both
// parentNode (now the wrapper div) and nextSibling.
const videoParent = videoEl.parentNode
const videoNextSibling = videoEl.nextSibling

const player = videojs(videoEl, VIDEO_JS_OPTIONS)
```

### 2. In cleanup, tear down, then re-insert if actually detached

```tsx
return () => {
  // See rule 3 — null the ref BEFORE dispose.
  const disposingPlayer = playerRef.current
  playerRef.current = null
  disposingPlayer?.dispose()

  if (videoParent?.isConnected && !videoEl.isConnected) {
    if (videoNextSibling?.parentNode === videoParent) {
      videoParent.insertBefore(videoEl, videoNextSibling)
    } else {
      videoParent.appendChild(videoEl)
    }
  }
}
```

Two conditions gate the restore — both matter:

- `!videoEl.isConnected` — only re-insert when the teardown actually detached us. On teardowns that leave the element alone, this short-circuits.
- `videoParent?.isConnected` — on **true** component unmount (route change, conditional render flip) the captured parent is itself about to be removed. Re-inserting there is wasted work and keeps the element alive for one extra tick, which can trigger a spurious media fetch on a `<video>`.

### 3. Null refs to teardown targets _before_ calling teardown

`dispose()` is synchronous, but inside it the library fires its own events and teardown callbacks. Any handler still bound to the environment (e.g. a `window.scroll` listener that reads `playerRef.current?.pause()`) can fire during that window and reach a half-disposed player. Nulling the ref first means those handlers short-circuit through their own null guard:

```tsx
const disposingPlayer = playerRef.current
playerRef.current = null // scroll handler now sees null
disposingPlayer?.dispose() // ...even if an event fires mid-dispose
```

### 4. Keep per-render data out of the init effect's deps

A common mistake is putting the **data** (a `src`, a dataset, a config object) in the same effect that creates and destroys the widget. Every data change then triggers dispose + re-init, which both (a) slams the StrictMode detachment problem on every route change and (b) regresses perf by rebuilding a live player just to change its source. Split into two effects:

```tsx
// Init once per mount. Stable deps only.
useEffect(() => {
  /* videojs(), capture + restore, dispose */
}, [onMutedChange, onPlayerReady]) // stable useCallbacks

// Swap source in place via the library's own setter — no reinit.
useEffect(() => {
  if (!playerRef.current || !src) return
  void playerRef.current.src({ type: "application/x-mpegURL", src })
}, [src])
```

### 5. Consider a remount key as a simpler alternative

Giving the wrapped element a `key` that flips on meaningful transitions (e.g. route change, identity swap) forces React to create a fresh DOM node. The detached-element problem disappears because the re-ref'd node is genuinely new. Rejected for `VideoHero` because scroll-pause + first-click-unmute state must persist across source swaps, but it's the cleaner answer when component state is discardable.

## Why This Matters

StrictMode is enabled by default in the Next.js App Router development mode. An effect that isn't remount-safe will look fine in isolation — the warning is easy to dismiss as a library quirk — but the real consequences are:

- **Silent drift into production fragility.** Future concurrent features, React Compiler passes, or dev-mode variations can trigger real remounts in production. The test run will pass; the first real remount in prod will surface the same black-hero symptom.
- **Warnings hide the eventual failure.** Before the floating-search redesign, the `VIDEOJS: WARN: The element supplied is not included in the DOM` line had been in the console for months. No one acted on it because it came with no visible symptom — until routing changed the navigation model to soft transitions. (session history) The teardown-safety property should be enforced at code-review time regardless of whether a symptom is showing yet.
- **Data updates and widget lifecycle get tangled.** Conflating the two (putting `src` in the init-effect deps) causes dispose+reinit on every data change. That both thrashes performance and multiplies exposure to the StrictMode detachment problem.

## When to Apply

Apply this pattern for **any** third-party library whose initializer mutates the DOM around a React-owned element and whose destructor undoes the mutation. Candidates in this codebase and ecosystem:

- **video.js** (`videojs(el, options)` wraps in `vjs-tech` container; `dispose()` removes it) — `apps/web/src/components/sections/VideoHero.tsx`, `apps/web/src/components/sections/Video.tsx` (via shared hook), `apps/web/src/components/sections/CarouselVideo.tsx` (via shared hook), `apps/manager/src/features/jobs/review-player/review-player-card.tsx` (via shared hook), `apps/manager/src/app/dashboard/layout.tsx` (not yet audited).
- **Chart.js** (`new Chart(canvas)` injects legend/tooltip DOM; `chart.destroy()` cleans up).
- **Mapbox GL / Leaflet** (`new Map({ container })` replaces container contents; `map.remove()` detaches).
- **Classic jQuery plugins** that adorn inputs (Select2, Chosen, flatpickr pre-React-mode).
- **CKEditor / TinyMCE / CodeMirror** classic builds that hide the `<textarea>` and insert an editor shell.

Skip this pattern when:

- The library integrates via a portal or renders into a React-owned container it does not mutate (pure `appendChild` then `removeChild` into an empty div is safe — React owns nothing inside it).
- You can remount-key the wrapping component and have no state worth preserving.
- The library provides an official React wrapper that already handles StrictMode (prefer those — many do).

## Examples

### Applied in `VideoHero.tsx` (commits 3f48b37 + d016ca6)

```tsx
// apps/web/src/components/sections/VideoHero.tsx:67-102
useEffect(() => {
  const videoEl = videoRef.current
  if (!videoEl) return

  const videoParent = videoEl.parentNode
  const videoNextSibling = videoEl.nextSibling

  const player = videojs(videoEl, VIDEO_JS_OPTIONS)
  playerRef.current = player
  onPlayerReady(player)

  player.on("volumechange", () => {
    onMutedChange(player.muted() ?? true)
  })

  return () => {
    const disposingPlayer = playerRef.current
    playerRef.current = null
    disposingPlayer?.dispose()

    if (videoParent?.isConnected && !videoEl.isConnected) {
      if (videoNextSibling?.parentNode === videoParent) {
        videoParent.insertBefore(videoEl, videoNextSibling)
      } else {
        videoParent.appendChild(videoEl)
      }
    }
  }
}, [onMutedChange, onPlayerReady])

useEffect(() => {
  if (!playerRef.current || !src) return
  void playerRef.current.src({ type: "application/x-mpegURL", src })
}, [src])
```

### Reference implementation — shared hook

`packages/video-player/src/useVideoPlayerCore.ts:233-294` — the same capture + restore + null-before-dispose shape, consumed by `Video.tsx`, `CarouselVideo.tsx`, and `apps/manager/.../review-player-card.tsx`. Authored 2026-04-12 (commit `0ceb71b`). (session history)

Follow-up tracked: extract a shared `reinsertOnCleanup(videoEl): () => void` helper in `packages/video-player/` so a future video.js upgrade touches one file instead of two.

### Rejected alternatives on this path

- **The effect-split fix alone (commit `c9337e7`).** Separating init and src into two effects was necessary — and is kept — but on its own did not address StrictMode detachment. The init effect still ran twice on mount; the warning still fired; only the navigation-triggered black-screen case was fixed.
- **Using `useVideoPlayerCore` wholesale in `VideoHero`.** The shared hook's `autoplayOnViewport` uses `getBoundingClientRect` intersection. The hero's UX is a `scrollY` threshold hysteresis (pause > 100, resume < 50). Adopting the hook wholesale would regress that behavior — so the pattern was copied, with a tracked follow-up to extract the DOM-restore primitive only.

### Prevention test pattern

`packages/video-player/src/useVideoPlayerCore.test.tsx:369-390` already asserts, under `<StrictMode>`, that:

- `videojsMock.mock.calls[0][0].isConnected === true`
- `videojsMock.mock.calls[1][0].isConnected === true`
- `console.warn` is never called with `/element supplied is not included in the DOM/`

Reverting the re-insertion block on the reference implementation makes that test fail. The same pattern should land for `VideoHero.tsx` once `apps/web/vitest.config.ts` is widened from `{ include: ['src/**/*.test.ts'], environment: 'node' }` to include `.tsx` globs under `jsdom` — tracked as follow-up from the code review (`.context/compound-engineering/ce-code-review/20260424-101947-d2a2bcd2/`).

## Related

- `packages/video-player/src/useVideoPlayerCore.ts:233-294` — reference implementation of the capture-and-restore pattern.
- `packages/video-player/src/useVideoPlayerCore.test.tsx:369-390` — regression test template.
- `docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md` — adjacent learning: third-party video-player lifecycle × React, mobile `expo-video`. Different library, shares the meta-lesson "hold the native player in a ref, not state."
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` — name-collides with "VideoHero" but is about tvOS `expo-video` setup-callback semantics, not web video.js or StrictMode. Cross-referenced here only for grep disambiguation.
- GitHub JesusFilm/forge#152 — the PR that introduced `apps/web/src/components/sections/VideoHero.tsx` (closed).
- Code-review artifact for this fix: `.context/compound-engineering/ce-code-review/20260424-101947-d2a2bcd2/metadata.json`.
