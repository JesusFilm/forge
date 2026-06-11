---
title: "TV VideoHeroRenderer showed blank/still image instead of inline autoplay video"
date: "2026-04-13"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "VideoHeroRenderer displayed blank fallback background instead of video or thumbnail"
  - "Homepage experience with empty CMS images array and null ogImage showed no visual content"
  - "Gradient overlays appeared as harsh rectangular color bands instead of smooth fades"
  - "Calling player.play() in useVideoPlayer setup callback had no effect on tvOS"
root_cause: wrong_api
resolution_type: code_fix
severity: high
last_updated: "2026-06-09"
tags:
  - expo-video
  - mux
  - gql-tada
  - video-hero
  - linear-gradient
  - tvos
  - pick-thumbnail-url
  - sdui
---

# TV VideoHeroRenderer showed blank/still image instead of inline autoplay video

## Problem

The TV app's VideoHeroRenderer and HomeHero displayed blank or static images instead of playing video inline. Multiple compounding issues: a gql.tada type shape mismatch on `video.images`, no fallback when CMS image data is absent, no inline video autoplay, and solid-color gradient overlays that obscured content.

## Symptoms

- Video hero area rendered as a solid dark surface (`#221F1D` fallback) with no image or video visible
- Easter homepage experience (marked `isHomepage: true`) had `images: []` and `ogImage: null` in CMS, leaving every fallback path empty
- Gradient overlays were two solid `View` elements with fixed opacity (0.3 and 0.85), creating visible rectangular bands
- On tvOS, `player.play()` called inside the `useVideoPlayer` setup callback was silently ignored
- Christmas experience showed a static thumbnail but no inline video playback

## What Didn't Work

- **Array indexing `images?.[0]?.videoStill`**: gql.tada infers `video.images` as a single object (not an array) for the VideoHero fragment shape. `[0]` on an object returns `undefined` silently — no TypeScript error, just a blank thumbnail. (session history)
- **Relying solely on CMS image fields**: Some experiences are seeded with `images: []` and no `ogImage`, so the entire image fallback chain returned null. (session history)
- **`player.play()` in `useVideoPlayer` setup callback**: Works on Android TV but is ignored on tvOS. The native player is not ready at callback time. (session history — this was independently rediscovered from the mobile-v2 playlist player learning)
- **Solid `View` elements with `opacity` for gradients**: At 0.85 opacity over a dark fallback background, the overlay made the entire hero indistinguishable from the page background — text was present but hidden. (session history)
- **`"transparent"` as a gradient stop**: Resolves to `rgba(0,0,0,0)` (transparent black), causing dark banding when interpolating with non-black colors on Android TV.

## Solution

### Fix 1 — Use `pickThumbnailUrl()` instead of manual array access

**Before:**

```ts
const videoStill = video?.images?.[0]?.videoStill ?? null
const ogImage = video?.images?.[0]?.url ?? null
const imageSource = resolveImageUrl(videoStill) ?? resolveImageUrl(ogImage)
```

**After:**

```ts
import { pickThumbnailUrl } from "../../lib/types"
const imageSource = resolveImageUrl(pickThumbnailUrl(video?.images))
```

`pickThumbnailUrl()` handles both array and single-object shapes via `Array.isArray()` and implements the priority chain: `mobileCinematicHigh` > `videoStill` > `url`.

### Fix 2 — `getMuxThumbnailUrl()` fallback

Added to `apps/tv/src/lib/resolveImageUrl.ts`:

```ts
export function getMuxThumbnailUrl(
  streamingUrl: string | null | undefined,
): string | null {
  if (!streamingUrl) return null
  try {
    const parsed = new URL(streamingUrl)
    if (parsed.hostname !== "stream.mux.com") return null
    const playbackId = parsed.pathname.replace(/^\//, "").replace(/\.m3u8$/, "")
    if (!playbackId || !/^[a-zA-Z0-9_-]+$/.test(playbackId)) return null
    return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=1920&height=1080&fit_mode=smartcrop`
  } catch {
    return null
  }
}
```

Image resolution chain: CMS video images > Mux thumbnail > ogImage.

### Fix 3 — Inline autoplay with `expo-video`

```ts
const player = useVideoPlayer(hasValidStream ? streamingUrl : null, (p) => {
  p.muted = true
  p.loop = true
  // Do NOT call p.play() here — ignored on tvOS
})

// Auto-play in separate useEffect (required for tvOS)
useEffect(() => {
  if (hasValidStream) {
    try {
      player.play()
    } catch {
      /* native player released */
    }
  }
}, [player, hasValidStream])

// Pause when full-screen overlay opens
useEffect(() => {
  if (!hasValidStream) return
  try {
    playerState.isVisible ? player.pause() : player.play()
  } catch {
    /* native player released */
  }
}, [player, playerState.isVisible, hasValidStream])
```

Falls back to static `Image` when no valid stream, solid color when no image.

> **Looping caution (tvOS):** `p.loop = true` works but is not seamless on tvOS — the native loop re-buffers the HLS seek-to-start, and if the `VideoView` is gated on a readiness flag that resets on the loop seam's transient status blip, the hero re-inits and pauses on black before restarting. For a background that must loop seamlessly, drive the loop yourself (`p.loop = false` + a `playToEnd` listener calling `player.replay()`, with the readiness gate latched so a loop-seam blip never unmounts the player). See [`docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md`](../runtime-errors/expo-video-backdrop-seamless-loop-20260609.md).

### Fix 4 — `LinearGradient` with `hexToRgba`

**Before:**

```tsx
<View style={{ backgroundColor: "#161311", opacity: 0.85, ...absoluteFill }} />
```

**After:**

```tsx
import { LinearGradient } from "expo-linear-gradient"
import { COLORS, hexToRgba } from "../../lib/colors"
;<LinearGradient
  colors={[hexToRgba(COLORS.surface, 0), COLORS.surface]}
  locations={[0.4, 1]}
  style={StyleSheet.absoluteFill}
  pointerEvents="none"
/>
```

### Review-driven fixes

- Extracted `hexToRgba` and `COLORS` to shared `apps/tv/src/lib/colors.ts`
- Replaced `streamingUrl!` non-null assertions with `typeof streamingUrl === "string" && validateStreamingUrl(streamingUrl)` for proper TypeScript narrowing

## Why This Works

- **gql.tada type inference**: The GraphQL fragment infers `images` as a single object, not `images[]`. At runtime Strapi returns an array. `pickThumbnailUrl` normalizes both shapes with `Array.isArray()`, so renderers never need to know the actual runtime shape.
- **Mux deterministic image API**: Mux exposes thumbnails at `image.mux.com/{PLAYBACK_ID}/thumbnail.jpg` using the same playback ID embedded in the `.m3u8` streaming URL. This provides a zero-CMS-dependency fallback when image fields are empty.
- **tvOS native player lifecycle**: The `useVideoPlayer` setup callback fires before the native AVPlayer is fully initialized on tvOS. Deferring `play()` to a `useEffect` ensures the call reaches a ready player.
- **`hexToRgba(color, 0)` gradient stops**: Produces `rgba(R,G,B,0)` which interpolates cleanly to the target color. `"transparent"` resolves to `rgba(0,0,0,0)` — when the target is a warm color like `#161311`, intermediate tones pass through pure black, creating visible dark banding.

## Prevention

- **Use `pickThumbnailUrl()` for all video image access**: Never index `video.images` directly — gql.tada's inferred shape may not match the runtime array. The utility handles both.
- **Always provide a Mux thumbnail fallback**: Any renderer displaying video content should include `getMuxThumbnailUrl(streamingUrl)` in its image resolution chain. CMS image fields can be empty.
- **`expo-video` on tvOS**: Always call `player.play()` in a `useEffect`, never in the `useVideoPlayer` setup callback. Document this in `apps/tv/CLAUDE.md` under Common Pitfalls.
- **Gradient overlays must use `LinearGradient`**: Never use solid `View` + opacity for gradient effects. Use `hexToRgba(color, 0)` for transparent stops — never the string `"transparent"`.
- **Centralize design tokens**: Keep `COLORS` and `hexToRgba` in a single shared module (`apps/tv/src/lib/colors.ts`). Duplication across component files leads to silent drift.

## Source swap on focus change (added 2026-04-20)

This doc covers **initial autoplay** only. If the hero's `streamingUrl` changes at runtime — e.g., it tracks which Experience card is focused in the rail below — a naïve source swap produces a 200–800ms **black flash** while HLS loads the manifest and decodes the first frame. On Android TV the flash cannot be covered by an overlay because `VideoView` is a `SurfaceView`.

The pattern: poster-hold during HLS init. Always paint a base `<Image>` poster below the video, only mount the `<VideoView>` once `player.status === 'readyToPlay'`, then hold the poster for ~500ms before crossfading the video in. For full details (stacked-layer crossfade, `player.pause()` instead of unmount on the outgoing layer, `AVPlayer` instance-cap bounds), see [`docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md`](../best-practices/tv-focus-driven-hero-patterns-20260420.md).

## Related Issues

- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — extends this doc with the runtime source-swap poster-hold pattern and the focus model for a rail-driven hero
- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — why `p.loop = true` (Fix 3) is unreliable for seamless looping on tvOS, and the `playToEnd` -> `replay()` + latched-readiness fix for a backdrop that must loop without a black pause
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` — same `hexToRgba` pattern, now also applied in TV app
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — mobile-v2 hero pattern; TV simplifies by removing scroll layer
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — TV platform setup; should add tvOS autoplay pattern
- `docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md` — `useVideoPlayer` lifecycle patterns
- GitHub issue #306 — origin of mobile VideoHeroRenderer
- GitHub issue #89 — cross-platform watch app epic
