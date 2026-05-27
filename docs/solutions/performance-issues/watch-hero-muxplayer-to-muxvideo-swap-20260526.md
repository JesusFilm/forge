---
title: Watch-page hero — MuxPlayer → MuxVideo swap
date: 2026-05-26
category: docs/solutions/performance-issues
module: apps/web, packages/video-player
problem_type: performance
component: tooling
severity: medium
related_components:
  - apps/web
  - packages/video-player
tags:
  - mux-player
  - mux-video
  - hls
  - lcp
  - chunk-size
  - next-dynamic
  - dead-code-elimination
  - subpath-export
  - feature-flag
applies_when:
  - A custom React chrome layer is already replacing Mux Player's built-in chrome
  - The site renders Mux Player's underlying poster + HLS playback as the LCP element
  - Mobile-sim Lighthouse score is bottlenecked by the mux-player chunk download
  - Cast / AirPlay are already hidden via `--controls: none` CSS Custom Properties
---

# Watch-page hero — MuxPlayer → MuxVideo swap

## Context

`apps/web`'s watch route renders a sticky `<HeroPlayer>` that auto-plays a
muted preview loop, reveals chrome on user gesture, and pins to viewport
during scroll. The component originally rendered `<MuxPlayer>` from
`@mux/mux-player-react` with all built-in chrome hidden via the
`--controls`, `--top-controls`, `--center-controls`, `--bottom-controls`
CSS Custom Properties — the actual controls are React-rendered via
`<HeroPlayerControls />` (see `mux-player-custom-react-chrome-pattern-20260430.md`).

In that configuration `<MuxPlayer>` was loading:

- `@mux/mux-player-react` + `@mux/mux-player` + `media-chrome` (~360 KB raw)
- `hls.js` (~600 KB raw)
- `cast_sender.js` + `cast_framework.js` from `www.gstatic.com` (~83 KB external)

…all to render a `<video>` element underneath an opaque overlay and let
the user's React chrome talk to its `HTMLMediaElement` ref. The chrome,
captions menu, cast button, AirPlay button, settings cog — every UI
affordance Mux Player ships — was permanently hidden.

`<MuxVideo>` from `@mux/mux-video-react` is the same playback stack
(HLS.js + Mux Data) wrapped around a bare `<video>` element, without the
media-chrome shadow DOM, without cast support, ~250 KB raw / ~80 KB gzip.
Every prop the hero relied on (`_hlsConfig`, `envKey`, `metadata`,
`disableCookies`, `disableTracking`, `playbackId`, native HTMLMediaElement
events) is on the `MuxMediaProps` interface they share.

## Guidance

### 1. The dual-mount uses `next/dynamic` + a runtime `env.X` flag

The hero conditionally renders one backend or the other based on
`env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` (the t3-oss `env` wrapper).
Each backend is wrapped in `next/dynamic({ ssr: false })` so only the
rendered branch's chunk activates over the wire:

```tsx
const MuxPlayer = dynamic(
  () => import("@forge/video-player/mux-player"),
  { ssr: false },
) as typeof MuxPlayerType

const MuxVideo = dynamic(
  () => import("@forge/video-player/mux-video"),
  { ssr: false },
) as typeof MuxVideoType

// …in JSX:
{env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO ? <MuxVideo …/> : <MuxPlayer …/>}
```

A `process.env`-folded ternary at module top can produce stricter dead-
code elimination (the inactive chunk never lands on disk), but it
breaks runtime flag toggling in tests — vitest can't mutate
`process.env.NEXT_PUBLIC_*` after the module has been substituted. The
runtime `env.X` check keeps both chunks on disk but the browser only
fetches the active one, which is what the simulated-mobile waterfall
measures anyway.

### 2. Subpath exports are load-bearing

Reading `import("@forge/video-player").then(m => m.MuxPlayer)` inside a
`next/dynamic` factory ships _both_ Mux packages in the resulting chunk,
because Turbopack groups them through the package's barrel. The fix is
to expose subpath exports on the workspace package:

```jsonc
// packages/video-player/package.json
"exports": {
  ".": "./src/index.ts",
  "./mux-player": "./src/MuxPlayer.tsx",
  "./mux-video": "./src/MuxVideo.tsx"
}
```

Dynamic-importing via `@forge/video-player/mux-player` and
`@forge/video-player/mux-video` resolves to distinct module specifiers,
so Turbopack emits one chunk per backend.

### 3. Autoplay-blocked detection moves to `play()` Promise rejection

`<MuxPlayer>` emits a `CustomEvent` with `detail.code === "autoplay-blocked"`
when the browser refuses autoplay. `<MuxVideo>` (bare `<video>`) emits
nothing — the rejection arrives via the `play()` Promise as
`DOMException("NotAllowedError")`. Unify the two signals at the catch
sites:

```ts
function isAutoplayBlockedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  return (err as { name?: unknown }).name === "NotAllowedError"
}

player.play().catch((err) => {
  if (isAutoplayBlockedError(err)) setAutoplayBlocked(true)
})
```

Keep the `handlePlayerError` event handler tolerant of both shapes (cast
to `CustomEvent` and read `detail?.code` with optional chaining; under
MuxVideo the chain narrows to `undefined` cleanly).

### 4. Subtitle injection needs the bare-`<video>` fallback

The custom subtitle override in `HeroPlayer.tsx` does
`el.shadowRoot?.querySelector("mux-video")?.shadowRoot?.querySelector("video")`
to inject a `<track>` element directly into the underlying `<video>`.
Under `<MuxVideo>`, `el` _is_ the `HTMLVideoElement` (no shadow root),
so the chain returns `null` and the injection silently fails. Append:

```ts
return (
  muxVideo?.shadowRoot?.querySelector("video") ??
  (el as unknown as HTMLElement).shadowRoot?.querySelector("video") ??
  (el instanceof HTMLVideoElement ? el : null)
)
```

### 5. Mux Data attribution requires an explicit `disableTracking={false}`

The `@forge/video-player` wrapper defaults `disableTracking={true}` to
keep section players out of Mux Data billing (a per-view cost). The
hero _needs_ attribution (`player_name = "forge-web-watch"` plus
`video_id` / `viewer_user_id`), so override at the callsite:

```tsx
<MuxVideo
  envKey={env.NEXT_PUBLIC_MUX_DATA_ENV_KEY}
  disableTracking={false}
  metadata={{ player_name: "forge-web-watch", ... }}
/>
```

### 6. CSS Custom Properties on `<MuxVideo>` are no-ops

`--controls: none` etc. are interpreted by media-chrome, which the bare
`<video>` element doesn't host. Drop them from the inline `style` prop
under MuxVideo and use a plain `CSSProperties` object for object-fit
(`{ objectFit: "cover" }` / `{ objectFit: "contain" }`).

## What this delivers

Numbers measured on `/watch/11-has-the-universe-always-existed/hindi`
under Lighthouse mobile-sim (5-run median, simulated 1.6 Mbps + 4× CPU):

| Metric                     | flag-off              | flag-on | Δ                               |
| -------------------------- | --------------------- | ------- | ------------------------------- |
| Performance score          | 60                    | 65      | +5                              |
| LCP (simulated)            | 11.5 s                | 11.1 s  | −400 ms                         |
| Total script transfer      | 1010 KB               | 922 KB  | −88 KB                          |
| `www.gstatic.com` requests | 1 (47 KB cast_sender) | 0       | −1 + −47 KB external            |
| Initial HLS segments       | 5                     | 5       | 0 (HLS buffer config preserved) |

The simulated-mobile LCP plateau remains network-bound (mux + hls + shared
chunks dominate the critical chain). Real-world (desktop unthrottled)
LCP is well under the "good" threshold on both branches.

Bigger wins remain locked behind a follow-up: the section players
(`VideoHero`, `Video`, `CarouselVideo`) still import `@forge/video-player`
via the package barrel, pulling `@mux/mux-player-react`'s shared
transitive deps into their chunks even on the hero MuxVideo path.
Switching those callsites to the new subpath exports would shrink the
section chunks too.

## Related solutions

- [Mux Player + custom React-rendered chrome (HeroPlayerControls pattern)](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md)
- [React-compiler ref-and-setState patterns](../design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md)

## Originating plan

[`docs/plans/2026-05-26-005-refactor-watch-hero-muxplayer-to-muxvideo-beta-plan.md`](../../plans/2026-05-26-005-refactor-watch-hero-muxplayer-to-muxvideo-beta-plan.md)
