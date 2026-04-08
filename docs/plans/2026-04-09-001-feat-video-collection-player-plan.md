---
title: "feat: Video Collection Player Screen"
type: feat
status: completed
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-video-collection-player-requirements.md
---

# feat: Video Collection Player Screen

## Overview

Replace the hollow single-video detail screen for carousel items with a collection-aware player screen. The new screen shows a sticky 16:9 video player pinned at the top, the collection title/subtitle, and a vertical scrollable playlist below. Videos auto-advance on completion and loop back to the first item after the last. Navigation uses the carousel's `sectionKey` for data lookup — no schema changes needed.

## Problem Frame

Video carousel items on the home page navigate to a video detail screen that has little to show beyond the player. The items have a minimal schema (`streamingUrl`, `imageUrl`, `titleOverride`, `backgroundColor`, optional `video` relation), so the detail page feels empty. Watching multiple videos requires back-and-forth navigation, defeating the purpose of curating a video collection. (see origin: `docs/brainstorms/2026-04-09-video-collection-player-requirements.md`)

## Requirements Trace

- R1. Tapping a video carousel item navigates to a collection player screen
- R2. The screen receives the full `videoCarousel` section context (title, subtitle, description, all items)
- R3. The tapped video begins playing immediately upon screen entry
- R4. Auto-advance to next playable item on video end (skip items without `streamingUrl`)
- R5. Loop back to first playable item after last video ends
- R6. No video playback on the home page (hero excepted) — existing behavior, no change needed
- R7. Sticky 16:9 player pinned to top, content scrolls independently below
- R8. Collection title and subtitle displayed below the player
- R9. Vertical scrollable playlist with thumbnail, title, and now-playing indicator
- R10. Tap any playable row to switch video; non-playable items appear muted/disabled
- R11. Playlist auto-scrolls to keep active item visible on auto-advance
- R12. Only existing `videoCarousel` section data — no CMS changes
- R13. Works generically for any `videoCarousel` section

## Scope Boundaries

- No video playback on the home page (hero excepted)
- No CMS data model or GraphQL schema changes
- No new SDUI block types
- No custom player chrome — inherit existing `expo-video` native controls, fullscreen, PiP
- Items without `streamingUrl` are skipped during auto-advance and shown as disabled in the playlist

## Context & Research

### Relevant Code and Patterns

- `app/video/[sectionKey].tsx` — existing video detail screen; uses `useVideoPlayer`, `VideoView`, `useEvent` from expo-video. Does NOT handle `playToEnd` event. Single source, never swapped.
- `src/contexts/ExperienceProvider.tsx` — indexes sections by `sectionKey` or `id` in a `Map`. VideoCarousel blocks ARE indexed (by their own sectionKey); individual carousel items are NOT. `useSectionByKey(carouselSectionKey)` returns the full carousel block including `items[]`, `vcTitle`, `vcSubtitle`, `vcDescription`.
- `src/components/sections/VideoCarouselRenderer.tsx` — currently navigates via `router.push(/video/${encodeURIComponent(videoSlug)})` using individual item's `video.slug`. Will change to push to new collection route using the carousel's own `sectionKey`.
- `app/_layout.tsx` — root Stack navigator; register new route here as `Stack.Screen`.
- `src/lib/color.ts` — design tokens: `BG_COLOR`, `SURFACE_COLOR`, `TEXT_PRIMARY`, `TEXT_SECONDARY`, `TEXT_ON_OVERLAY`, `ACCENT`.
- `src/lib/types.ts` — shared `VideoRef` type.
- `src/lib/resolveImageUrl.ts` — thumbnail resolution with fallback chain.
- `src/lib/validateUrl.ts` — streaming URL validation.
- `src/hooks/useTypography.ts` — platform-aware font sizing.

### Institutional Learnings

- **Android decoder budget**: Mid-range Android devices have 3-5 hardware decoder slots. Use a single `useVideoPlayer` instance with `replaceAsync()` to swap sources — never multiple concurrent players. (from `docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md`)
- **expo-video `player.pause()` bug**: In v3.0.16, `pause()` does not visually stop the video. Full unmount is needed to stop rendering. For the collection player this is less relevant since we keep one player alive and swap sources. (same source)
- **Slash-in-route encoding**: Strapi sectionKeys contain `/`. Always use `encodeURIComponent` at navigation, `decodeURIComponent` with try-catch on the destination. (from `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md`)
- **Android VideoView z-order**: Native surface renders on top of all RN Views. The sticky-player-above-list layout avoids this since the player is not overlapped by scroll content. (from `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md`)
- **CMS empty string gotcha**: Strapi serializes optional fields as `""` not `null`. Validate with `field != null && field !== ""`. (from `docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md`)
- **SDUI type erasure**: `NormalizedBlock` uses `[key: string]: unknown`, requiring `as` casts in renderers. Follow the same pattern as existing renderers. (from `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`)

## Key Technical Decisions

- **New `/collection/[sectionKey]` route over enhancing `/video/[sectionKey]`**: The existing video route is used by `VideoCardRenderer`, `VideoHeroRenderer`, and `MediaCollectionRenderer` for single-video playback with sibling content. Adding collection logic there would create branching complexity. A dedicated route keeps concerns clean.
- **Carousel `sectionKey` as route key + `index` query param**: Follows the established pattern — pass only a string key via URL, look up full data from `ExperienceProvider` context. The `index` param tells the screen which item to start playing.
- **Single `useVideoPlayer` with `replaceAsync()`**: Avoids creating multiple native decoder instances. `replaceAsync` swaps the HLS source on the same player without unmount/remount, preventing flicker, audio overlap, and decoder slot exhaustion. Preferred over `replace()` on iOS to avoid UI thread blocking.
- **`playToEnd` event for auto-advance**: expo-video ~3.0.16 emits `playToEnd` when video reaches end. Currently unused in the codebase. Use `player.addListener('playToEnd', callback)` since `useEvent` expects a payload object and `playToEnd` has none.
- **FlatList for playlist (not FlashList)**: The playlist is a short, bounded list (typically 3-10 items). FlatList is simpler, avoids FlashList's required `estimatedItemSize`, and supports `scrollToIndex` for auto-scroll. FlashList's virtualization benefits don't apply at this scale.

## Open Questions

### Resolved During Planning

- **How to pass carousel data to the collection screen?** Use the carousel's `sectionKey` in the route URL. The collection screen calls `useSectionByKey(decodedKey)` which returns the full `videoCarousel` block including all `items[]`, `vcTitle`, `vcSubtitle`, `vcDescription`. No serialization needed.
- **How to detect video completion?** Use `player.addListener('playToEnd', callback)`. This event exists in expo-video ~3.0.16 but is currently unused in the app.
- **How to swap video sources?** Use `player.replaceAsync(newStreamingUrl)` on the existing player instance. This preserves the native decoder and avoids z-order/lifecycle issues.
- **What happens for items without `video` relation (no slug)?** No longer relevant — navigation uses the carousel's `sectionKey`, not individual item slugs. All items are accessible via the carousel block's `items[]` array regardless of whether they have a `video` relation.

### Deferred to Implementation

- **Exact auto-scroll animation timing**: `FlatList.scrollToIndex` behavior may need `viewPosition` tuning to center the active item vs. making it just visible.
- **Poster frame during source swap**: When `replaceAsync` is called, the player may briefly show the last frame of the previous video or a black frame. Whether to overlay the next item's thumbnail during transition depends on how `replaceAsync` actually looks in practice.
- **AppState pause/resume**: Replicate the existing pattern from `video/[sectionKey].tsx` — pause on background, resume on foreground. Exact implementation depends on cleanup timing.

## Implementation Units

- [ ] **Unit 1: Register collection route**

**Goal:** Create the route file and register it in the root layout so navigation works.

**Requirements:** R1

**Dependencies:** None

**Files:**

- Create: `apps/mobile-v2/app/collection/[sectionKey].tsx` (new `app/collection/` directory required)
- Modify: `apps/mobile-v2/app/_layout.tsx`

**Approach:**

- Create `app/collection/[sectionKey].tsx` with a minimal scaffold: extract `sectionKey` from `useLocalSearchParams`, decode it with try-catch, call `useSectionByKey` to get the carousel block, extract `index` from search params for initial item
- In `app/_layout.tsx`, add a `Stack.Screen` for `collection/[sectionKey]` with `headerShown: true`, a back button, and transparent/dark header styling matching the existing video detail screen
- Validate the decoded key with the existing regex pattern (loosened for `/` and `%`)

**Patterns to follow:**

- `app/video/[sectionKey].tsx` — param extraction, `useSectionByKey`, decode pattern
- `app/_layout.tsx` — existing `Stack.Screen` registration for `video/[sectionKey]`

**Test scenarios:**

- Happy path: navigate to `/collection/[encoded-sectionKey-value]?index=0` — screen renders without crash, section data is available from context
- Edge case: sectionKey with slashes (e.g., `easter/carousel-1`) encodes and decodes correctly
- Edge case: invalid/malformed sectionKey — screen shows fallback state, does not crash
- Edge case: missing `index` param defaults to 0

**Verification:**

- Tapping any carousel item on the home page opens the collection screen (even if UI is still scaffold)
- Back button returns to the home page

---

- [ ] **Unit 2: Update VideoCarouselRenderer navigation**

**Goal:** Change carousel item taps to navigate to the collection route instead of the single-video route.

**Requirements:** R1, R2

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/mobile-v2/src/components/sections/VideoCarouselRenderer.tsx`

**Approach:**

- Replace `router.push(/video/${encodeURIComponent(videoSlug)})` with `router.push(/collection/${encodeURIComponent(carouselSectionKey)}?index=${index})`
- The carousel's `sectionKey` comes from `section.sectionKey` (passed as a prop via `VideoCarouselRendererProps`)
- The `index` is the item's position in the `items[]` array (available from `renderItem`'s `index` param)
- Remove the `if (videoSlug)` guard — navigation no longer depends on individual item slugs. Instead, guard on `carouselSectionKey` being present
- Items without `streamingUrl` should still be tappable from the carousel (the collection screen handles the muted/disabled state)

**Patterns to follow:**

- `src/components/sections/VideoCardRenderer.tsx` — `sectionKey` extraction from `section` prop
- Existing `encodeURIComponent` usage throughout renderers

**Test scenarios:**

- Happy path: tapping carousel item navigates to `/collection/[encoded-sectionKey]?index=N` where N matches the tapped item's position
- Happy path: carousel with 3 items — tapping item 0, 1, 2 produces `index=0`, `index=1`, `index=2`
- Edge case: carousel section without `sectionKey` — no navigation occurs (guard)
- Integration: tapping a carousel item on the home page opens the collection player, not the old video detail screen

**Verification:**

- All carousel item taps route to the collection screen with correct sectionKey and index
- Other video navigation paths (VideoCardRenderer, VideoHeroRenderer, MediaCollectionRenderer) still route to `/video/[sectionKey]` unchanged

---

- [ ] **Unit 3: Build collection player screen layout**

**Goal:** Implement the full collection player screen: sticky 16:9 player, collection header, and playlist with now-playing indicator.

**Requirements:** R2, R3, R7, R8, R9, R10, R12, R13

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/mobile-v2/app/collection/[sectionKey].tsx`

**Approach:**

- **Layout structure**: `View` (flex: 1) containing: (1) fixed-height `VideoView` at 16:9 aspect ratio (width = screen width, height = width \* 9/16), (2) `FlatList` below filling remaining space with `ListHeaderComponent` for collection title/subtitle
- **Player**: single `useVideoPlayer` instance initialized with the `initialIndex` item's `streamingUrl`. The source passed to `useVideoPlayer` must be captured once (e.g., via `useRef` or a stable variable), NOT a state variable — changing the source argument causes the hook to destroy and recreate the native player. All subsequent source changes must go through `player.replaceAsync()` only. Use `nativeControls`, `allowsFullscreen`, `allowsPictureInPicture`, `contentFit="contain"` matching existing video detail screen
- **Collection header**: `vcTitle` and `vcSubtitle` from the carousel block, styled with existing typography tokens (`TEXT_PRIMARY`, `TEXT_SECONDARY`, `useTypography`)
- **Playlist rows**: each row shows a 16:9 thumbnail (via `expo-image` with `resolveImageUrl` fallback chain), title (`titleOverride ?? video?.title ?? "Untitled"`), and now-playing indicator (accent-colored bar or icon on active row)
- **Non-playable items**: rows without `streamingUrl` render with reduced opacity (0.4) and `disabled` on the Pressable. No `onPress` handler
- **Active item highlight**: the currently playing row gets the `ACCENT` color treatment — left border bar or play icon, title in `TEXT_PRIMARY` instead of `TEXT_SECONDARY`
- **Thumbnail fallback**: use `resolveImageUrl(item.imageUrl ?? item.video?.images?.mobileCinematicHigh ?? item.video?.images?.videoStill ?? item.video?.images?.url)`. If all null, show `backgroundColor ?? SURFACE_COLOR` fill
- **AppState handling**: replicate pause-on-background, resume-on-foreground pattern from existing video detail screen

**Patterns to follow:**

- `app/video/[sectionKey].tsx` — `useVideoPlayer`, `VideoView` props, AppState handling, cleanup effect
- `src/components/sections/VideoCarouselRenderer.tsx` — thumbnail resolution, title extraction, card styling
- `src/lib/color.ts` — all color tokens
- `src/hooks/useTypography.ts` — font sizing

**Test scenarios:**

- Happy path: screen renders with player at top showing the `initialIndex` video, collection title/subtitle below, and all items in the playlist
- Happy path: active item row is visually distinct from inactive rows
- Edge case: carousel with 1 item — playlist shows single row, player plays that item
- Edge case: item with no `imageUrl` and no `video` relation — row shows `backgroundColor` fill instead of thumbnail
- Edge case: item with `titleOverride` of `""` (Strapi empty string) — falls back to `video?.title`, then "Untitled"
- Edge case: non-playable item (no `streamingUrl`) renders muted at 0.4 opacity, is not tappable
- Error path: invalid `streamingUrl` (fails `validateStreamingUrl`) — treated as non-playable
- Integration: player displays native controls, supports fullscreen and PiP

**Verification:**

- The collection player screen shows a 16:9 video playing at the top with the correct initial item
- Collection title and subtitle appear below the player
- All carousel items appear in the playlist with thumbnails and titles
- Active item is visually highlighted; non-playable items are visually muted

---

- [ ] **Unit 4: Auto-advance, loop, and playlist interaction**

**Goal:** Wire up video completion detection, auto-advance to next playable item, loop behavior, tap-to-switch, and auto-scroll.

**Requirements:** R4, R5, R10, R11

**Dependencies:** Unit 3

**Files:**

- Modify: `apps/mobile-v2/app/collection/[sectionKey].tsx`

**Approach:**

- **Playable items computation**: derive `playableItems` (items with valid `streamingUrl`) and `playableIndices` (their indices in the full items array) once via `useMemo`. Use these for advance/loop logic
- **`playToEnd` listener**: `player.addListener('playToEnd', callback)`. On fire: find the next playable index after the current one. If none, wrap to the first playable index (loop). Call `player.replaceAsync(nextStreamingUrl)` and update `currentIndex` state
- **Tap-to-switch** (R10): on playlist row press, call `player.replaceAsync(tappedItem.streamingUrl)`, update `currentIndex`. The player continues with the new source — no unmount needed
- **Auto-scroll** (R11): when `currentIndex` changes (from auto-advance or tap), call `flatListRef.current?.scrollToIndex({ index: currentIndex, viewPosition: 0.5, animated: true })` to center the active item. Use `onScrollToIndexFailed` handler to scroll to nearest loaded index first
- **Listener cleanup**: return `subscription.remove()` from a `useEffect` cleanup to prevent memory leaks. Re-register the listener when `currentIndex` changes (it needs the current index in closure to compute next)
- **All-items-unplayable edge case**: if `playableItems.length === 0`, show the playlist with all items muted and no player (or a placeholder message in the player area)

**Patterns to follow:**

- `app/video/[sectionKey].tsx` — `useEvent` pattern (for reference, though `playToEnd` uses `addListener` directly)
- `src/contexts/ExperienceProvider.tsx` — `useMemo` for derived data

**Test scenarios:**

- Happy path: video plays to end → next playable item auto-starts, player source changes, playlist highlight moves
- Happy path: tap playlist row mid-video → player switches to tapped video immediately, highlight updates
- Happy path: last playable video ends → loops to first playable video, playlist scrolls back to top
- Edge case: collection with items [playable, non-playable, playable] — auto-advance skips index 1, goes from 0 to 2
- Edge case: collection with only 1 playable item — plays, ends, loops back to same item (replays)
- Edge case: 0 playable items — player area shows placeholder, no crash
- Edge case: rapid taps on different playlist rows — player settles on the last tapped item without audio overlap
- Integration: auto-scroll moves the playlist to show the newly active item centered in the visible area
- Integration: auto-advance listener is cleaned up on unmount (no orphaned listeners)

**Verification:**

- Watching a 3-video collection plays all three in sequence and loops back to the first
- Tapping any playlist row during playback switches immediately without flicker or audio overlap
- The playlist visually tracks the currently playing item at all times

## System-Wide Impact

- **Interaction graph:** `VideoCarouselRenderer` navigation target changes from `/video/slug` to `/collection/sectionKey`. All other renderers (`VideoCardRenderer`, `VideoHeroRenderer`, `MediaCollectionRenderer`) continue navigating to `/video/[sectionKey]` — no change.
- **Error propagation:** If `useSectionByKey` returns `undefined` (stale cache, invalid key), the collection screen shows a fallback state and does not crash. This mirrors the existing video detail screen's error handling.
- **State lifecycle risks:** `replaceAsync` on a single player instance avoids decoder slot leaks. Cleanup effect pauses on unmount. No shared mutable state between the home page and collection screen — data is read-only from ExperienceProvider context.
- **API surface parity:** No API or schema changes. The web app is unaffected.
- **Unchanged invariants:** The existing `/video/[sectionKey]` route and its behavior remain completely unchanged. VideoCardRenderer, VideoHeroRenderer, and MediaCollectionRenderer navigation is not modified.

## Risks & Dependencies

| Risk                                                     | Mitigation                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `replaceAsync` may cause brief visual gap between videos | Defer poster-frame overlay to implementation — test actual behavior first, add thumbnail overlay only if needed         |
| `playToEnd` event reliability across iOS/Android         | Test on both platforms during implementation. Fallback: poll `player.currentTime` against `player.duration` as a backup |
| Android VideoView z-order with sticky layout             | The player is above the list, not behind it — no overlap. Lower risk than the hero pattern but still test on Android    |
| Carousel blocks without `sectionKey`                     | Guard in VideoCarouselRenderer — skip navigation if `sectionKey` is absent. This would be a CMS data issue              |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-09-video-collection-player-requirements.md](docs/brainstorms/2026-04-09-video-collection-player-requirements.md)
- Related code: `app/video/[sectionKey].tsx`, `src/components/sections/VideoCarouselRenderer.tsx`, `src/contexts/ExperienceProvider.tsx`
- Learnings: `docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md`, `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md`, `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md`
