---
title: "Playlist-Style Video Player Screen in SDUI Mobile App"
date: 2026-04-09
category: best-practices
module: apps/mobile-v2
problem_type: best_practice
component: video-player
severity: medium
applies_when:
  - Building a sequential video playback screen with a playlist UI
  - Using expo-video useVideoPlayer with source swapping
  - Rendering a collection of videos from a single SDUI videoCarousel section
tags:
  - mobile
  - expo-video
  - sdui
  - react-native
  - playlist
  - expo-router
  - flatlist
  - android
  - video-player
---

# Playlist-Style Video Player Screen in SDUI Mobile App

## Context

Video carousel items on the home page navigated to a hollow video detail screen with just a player. Users had to navigate back and forth between screens to watch videos from a collection sequentially. The carousel items have a minimal schema (`streamingUrl`, `imageUrl`, `titleOverride`, `backgroundColor`, optional `video` relation), so the detail screen had little to show.

The solution: a dedicated collection player screen with a sticky 16:9 player, collection header, and a vertical scrollable playlist with auto-advance, loop, and tap-to-switch. Building this required solving several expo-video lifecycle, navigation, and SDUI data access challenges.

## Guidance

### 1. Stable `useVideoPlayer` source -- use `useRef`, not state

The `source` argument to `useVideoPlayer(source, setup)` triggers `useReleasingSharedObject([JSON.stringify(parsedSource)])` internally. Changing `source` destroys and recreates the native player.

```ts
// WRONG -- state change recreates the native player on every track switch
const [currentUrl, setCurrentUrl] = useState(initialUrl)
const player = useVideoPlayer(currentUrl, (p) => {
  p.muted = false
})

// CORRECT -- stable ref; all subsequent source changes via replaceAsync()
const initialUrlRef = useRef(initialUrl)
const player = useVideoPlayer(initialUrlRef.current, (p) => {
  p.muted = false
})
```

### 2. Single-player source swapping with `replaceAsync()`

Use `player.replaceAsync(newUrl)` to swap HLS sources on the same native player instance. This avoids creating multiple decoder instances (Android mid-range devices have 3-5 hardware decoder slots).

- Prefer `replaceAsync` over `replace()` on iOS -- `replace` blocks the UI thread.
- Catch errors from `replaceAsync` (network failure, decoder error) to avoid unhandled promise rejections.

### 3. `playToEnd` event for auto-advance

expo-video ~3.0.16 emits `playToEnd` when a video reaches the end. Use `player.addListener('playToEnd', callback)` -- not `useEvent`, which expects a payload object and `playToEnd` has none.

```ts
useEffect(() => {
  const subscription = player.addListener("playToEnd", () => {
    setCurrentIndex((prev) => {
      const pos = playableIndices.indexOf(prev)
      const next = (pos + 1) % playableIndices.length
      return playableIndices[next]
    })
  })
  return () => subscription.remove()
}, [player, playableIndices])
```

Clean up with `subscription.remove()` in effect cleanup. Re-register when `playableIndices` changes.

### 4. Stack screen blur listener for playback pause

React Navigation stack keeps screens mounted when navigating away. Audio continues playing without an explicit pause.

```ts
useEffect(() => {
  const unsub = navigation.addListener("blur", () => {
    try {
      player.pause()
    } catch {
      /* Released */
    }
  })
  return unsub
}, [navigation, player])
```

### 5. AppState resume guard with `wasPlayingRef`

Don't call `player.play()` unconditionally on foreground. The user may have manually paused.

Note the `else` branch pauses on **either** `"inactive"` or `"background"` — fine for a mobile touch player, but do NOT copy it verbatim to a tvOS always-on backdrop that must survive Control Center/Siri: there, teardown must branch on `"background"` alone (see [`tvos-appstate-inactive-vs-background-video-teardown.md`](../ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md)).

```ts
const wasPlayingRef = useRef(false)

useEffect(() => {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      if (wasPlayingRef.current) player.play()
    } else {
      wasPlayingRef.current = player.playing
      try {
        player.pause()
      } catch {
        /* Released */
      }
    }
  })
  return () => sub.remove()
}, [player])
```

**On TV, additionally**: the foreground branch must set a **one-shot `hasTVPreferredFocus` flag** on the control you want focused after resume. Touch UX auto-restores focus; tvOS `UIFocusEngine` does not ([react-native-tvos#852](https://github.com/react-native-tvos/react-native-tvos/issues/852)) — without an explicit flag, focus is orphaned. See [`docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md`](../design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md#pattern-4--on-foreground-resume-set-a-one-shot-hastvpreferredfocus-flag-yourself--dont-rely-on-the-focus-engines-default-restoration) (Pattern 4) for the state-flag + clearing-`useEffect` shape on TV.

### 6. `FlatList.scrollToIndex` requires `getItemLayout`

`scrollToIndex` silently fails without `getItemLayout`. For fixed-height playlist rows:

```ts
<FlatList
  getItemLayout={(_data, index) => ({
    length: ROW_HEIGHT,
    offset: ROW_HEIGHT * index,
    index,
  })}
/>
```

### 7. SDUI carousel data access pattern

Individual carousel items are NOT indexed in ExperienceProvider. Navigate using the parent carousel's `sectionKey` with an `index` query param:

```ts
// Navigation (from home carousel)
router.push(`/collection/${encodeURIComponent(sectionKey)}?index=${index}`)

// Collection screen
const decodedKey = parseSectionKey(sectionKey) // shared util: decode + validate
const section = useSectionByKey(decodedKey ?? "")
const items = (section.items as VideoCarouselItem[]) ?? []
```

### 8. Shared utilities

- `parseSectionKey(raw)` in `src/lib/parseSectionKey.ts` -- decodes and validates URL-encoded sectionKeys. Used by both `/video/[sectionKey]` and `/collection/[sectionKey]`.
- `VideoCarouselItem` type exported from `VideoCarouselRenderer.tsx` -- reused by the collection screen.

## Why This Matters

| Constraint                               | Mechanism                                                    |
| ---------------------------------------- | ------------------------------------------------------------ |
| Android decoder budget (3-5 slots)       | Single `useVideoPlayer` + `replaceAsync()` reuses one slot   |
| iOS UI thread blocking                   | `replaceAsync` is async; `replace` blocks                    |
| Native player recreated on source change | Stable `useRef` source; never pass state to `useVideoPlayer` |
| Audio after navigation                   | `navigation.addListener("blur")` pause                       |
| `playToEnd` not firing via `useEvent`    | `player.addListener("playToEnd", cb)` imperative API         |
| `scrollToIndex` silently failing         | `getItemLayout` with fixed row height                        |
| Unwanted resume after backgrounding      | `wasPlayingRef` guard                                        |

Ignoring these patterns leads to decoder slot exhaustion (OOM on Android), audio leaks after navigation, broken auto-scroll, and poor user experience with unconditional playback resume.

## When to Apply

- Building any sequential video playback screen (playlist, collection, course viewer)
- Using expo-video `useVideoPlayer` with dynamic source changes
- Adding video playback to a screen within a React Navigation stack
- Implementing auto-advance or programmatic video switching
- Using `FlatList.scrollToIndex` driven by player state (not user gesture)

## Examples

The complete implementation lives in:

- `apps/mobile-v2/app/collection/[sectionKey].tsx` -- collection player screen
- `apps/mobile-v2/src/components/sections/VideoCarouselRenderer.tsx` -- carousel navigation
- `apps/mobile-v2/src/lib/parseSectionKey.ts` -- shared sectionKey utility

## Related

- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` -- TV companion: the same `useRef`-over-state discipline and `subscription.remove()` cleanup pattern, extended with the stale-closure ref-mirror rule and `Animated.CompositeAnimation` handle capture specific to TV overlay state machines. Pattern 4 is the TV extension of Section 5's `wasPlayingRef`.
- `docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md` -- Android decoder budget, visibility-gated playback
- `docs/solutions/mobile/video-detail-audit-ui-polish-fixes.md` -- Stack screen blur listener origin
- `docs/solutions/mobile/sdui-experience-provider-block-index-parent-child-loss.md` -- ExperienceProvider indexing architecture
- `docs/solutions/mobile/audit-driven-video-detail-refactor.md` -- FlatList migration, shared types
- `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md` -- sectionKey encoding (origin of `parseSectionKey`)
- GitHub #313 -- MediaCollectionRenderer (predecessor in mobile v1)
- GitHub #89 -- Cross-platform watch app epic
