---
title: "fix: Mobile video playback lifecycle bugs"
type: fix
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-mobile-video-playback-lifecycle-requirements.md
---

# fix: Mobile video playback lifecycle bugs

## Overview

The mobile app has several interrelated video playback bugs: the hero video plays immediately at mount (ignoring the `paused` prop), inline videos autoplay unmuted, and the mute button icon is stuck on "muted" and never toggles visually — even when tapped or when audio is audible. These issues undermine the viewport-gated lazy rendering system.

## Problem Statement

(see origin: `docs/brainstorms/2026-03-31-mobile-video-playback-lifecycle-requirements.md`)

Users hear audio from videos that should be muted or paused. The mute button shows "muted" while sound plays from a different video. The root causes are:

1. **`VideoHeroRenderer` calls `p.play()` in setup callback** (`VideoHeroRenderer.tsx:128`), bypassing the `paused` prop effect that runs after mount.
2. **`VideoRenderer` omits `p.muted = true`** (`VideoRenderer.tsx:40-42`), so inline videos autoplay with sound when they become visible.
3. **Mute button icon is stuck on "muted" and never toggles.** The button in `FixedHeroLayout.tsx:318-324` renders `{isMuted ? <VolumeOffIcon /> : <VolumeOnIcon />}` and the `onPress` calls `setIsMuted((prev) => !prev)`. The user reports the icon ALWAYS shows `VolumeOffIcon` regardless of tapping or audio state. Possible causes: (a) the `onPress` is not firing due to a touch event issue (ScrollView gesture preemption on Android), (b) a rapid re-render from scroll state updates (`setPaused`/`setBlurBracket`) is interfering with the state update, or (c) the button is only visible at the hero position before scrolling — once scrolled past, the user can no longer see or interact with it while hearing inline audio. Root cause must be investigated during implementation.

## Proposed Solution

Five targeted changes to the existing components, preserving the architecture. No new components or contexts needed.

### Fix 1: Remove `p.play()` from VideoHeroRenderer setup callback (R1)

**File:** `apps/mobile/src/components/sections/VideoHeroRenderer.tsx`

Remove `p.play()` from the `useVideoPlayer` setup callback (line 128). Add a new `useEffect` that handles initial playback, gated on visibility:

```tsx
// Setup: configure player but do NOT start playback
const player = useVideoPlayer(streamingUrl ?? null, (p) => {
  p.muted = true
  p.loop = true
  // Removed: p.play() — playback is gated on paused/visibility props
})
```

The existing `paused` effect (`VideoHeroRenderer.tsx:158-165`) already calls `player.play()` when `paused` is false and the app is active. However, this effect has a guard `if (paused == null) return` that skips when `paused` is undefined (uncontrolled mode). For uncontrolled mode, the existing `useScrollY`-based visibility detection (lines 172-191) already handles play/pause — but it only fires on scroll events.

**Additional change for uncontrolled mode:** Add an initial visibility check on mount so the video plays if it is already in the viewport without waiting for a scroll event:

```tsx
// Initial visibility check for uncontrolled mode (no paused prop).
// Without this, a video mounted in the viewport won't play until
// the next scroll event fires.
useEffect(() => {
  if (paused != null) return // Controlled mode — paused effect handles it
  containerRef.current?.measureInWindow((_x, windowY, _w, h) => {
    const visible = windowY + h > 0 && windowY < viewportHeight
    isVisibleRef.current = visible
    if (visible && appActiveRef.current) {
      player.play()
    }
  })
}, [player, viewportHeight, paused])
```

**For controlled mode:** Modify the `paused` effect to also handle the initial play on mount. Currently it only calls `player.play()` when `paused` transitions from `true` to `false`. On the initial render where `paused` starts as `false` (user hasn't scrolled yet), the effect should also call `player.play()`:

```tsx
useEffect(() => {
  if (paused == null) return
  if (paused) {
    player.pause()
  } else if (appActiveRef.current) {
    player.play()
  }
}, [paused, player])
```

This already works correctly because the effect runs on mount with the initial `paused` value. If `paused` is `false` (hero visible, no scroll yet), it calls `player.play()`. If `paused` is `true`, it calls `player.pause()`. The only change is removing `p.play()` from the setup callback.

**Trade-off:** 1-3 frame delay before initial hero playback (effect runs after first render). Acceptable — the thumbnail image covers this gap.

### Fix 2: Add `p.muted = true` to VideoRenderer setup callback (R2)

**File:** `apps/mobile/src/components/sections/VideoRenderer.tsx`

```tsx
const player = useVideoPlayer(streamingUrl, (p) => {
  p.muted = true // R2: autoplay muted
  p.loop = true
})
```

The existing comment says "Not setting p.muted here so native controls' mute/unmute button works." This is incorrect — `expo-video` native controls work fine with `muted = true` initially; the user can unmute via the native controls volume button. The comment should be removed.

**Mute state model decision:** Per-video mute. Each video starts muted and manages its own mute state independently. The hero mute button controls only the hero. Inline videos use native controls for mute toggling. This is the simplest model and matches the existing architecture (see origin: R3 root cause analysis).

### Fix 3: Fix mute button toggle (R3)

**File:** `apps/mobile/src/components/sections/FixedHeroLayout.tsx`

The mute button icon is stuck on `VolumeOffIcon` (muted) and never visually toggles when tapped. This needs investigation during implementation. Diagnostic steps:

1. **Verify `onPress` fires.** Add a `console.log` inside the handler to confirm the press registers. If it does not fire, the cause is touch event preemption by the ScrollView — revisit the `pointerEvents="box-none"` setup on the `overlaySpacerContainer` and ensure the Pressable has sufficient `hitSlop`.

2. **Verify `isMuted` state toggles.** Log `isMuted` in the render to confirm React state updates. If the state toggles but the icon doesn't change, this is a rendering issue (possibly the icon components are not re-rendering).

3. **Check for state reset.** Verify no effect or callback resets `isMuted` back to `true` after toggle. The `handleScroll` callback updates `paused` and `blurBracket` on every scroll event — confirm these state updates do not interfere with `isMuted`.

4. **Check icon component implementation.** Read `VolumeOffIcon` and `VolumeOnIcon` to confirm they render different visuals. If both render the same SVG, the toggle works but looks identical.

5. **Test both platforms.** The previous fix (#561) addressed Android ScrollView touch preemption. Verify the fix is still effective.

If investigation reveals the `onPress` never fires, the fix is to restructure the button placement or add explicit touch handling. If the state toggles correctly, the fix is in the icon components or rendering logic.

### Fix 4: Immediate visibility check after LazySection mount (SpecFlow Gap 4)

**File:** `apps/mobile/src/components/sections/LazySection.tsx`

When `isMounted` transitions from `false` to `true`, the `isVisible` state starts as `false` and only updates on the next scroll event. If the user has stopped scrolling, the video may never play. Add an immediate visibility computation when mounting:

```tsx
// Respond to forceMount changes AND perform immediate visibility check
// after mount transition to avoid videos stuck in paused state when
// no further scroll events arrive (e.g. scroll deceleration stops).
useEffect(() => {
  if (forceMount) {
    setIsMounted(true)
  }
  if (isMounted) {
    const scrollY = scrollOffsetRef.current
    const sectionY = contentOffsetY + layoutYRef.current - scrollY
    const sectionHeight =
      measuredHeightRef.current ??
      ESTIMATED_HEIGHTS[sectionKind] ??
      DEFAULT_ESTIMATED_HEIGHT
    const sectionBottom = sectionY + sectionHeight
    const nowVisible = sectionBottom > 0 && sectionY < viewportHeight
    setIsVisible((prev) => (prev === nowVisible ? prev : nowVisible))
  }
}, [
  isMounted,
  forceMount,
  sectionKind,
  viewportHeight,
  contentOffsetY,
  scrollOffsetRef,
])
```

### Fix 5: Verify LazySection unmount buffer (R4)

**File:** `apps/mobile/src/components/sections/LazySection.tsx`

The unmount buffer is currently 1.5 VH. This means a video player is destroyed when it is ~1.5 screen heights away from the viewport. Verify this is working by:

1. Adding a `__DEV__` console log on mount/unmount transitions to confirm lifecycle during manual testing.
2. Confirming the hysteresis gap (mount at 0.5 VH, unmount at 1.5 VH) prevents rapid cycling.

No code change expected unless testing reveals issues.

## System-Wide Impact

- **Interaction graph:** `FixedHeroLayout` scroll handler -> `LazySection` visibility -> `VideoRenderer` play/pause -> `expo-video` native player. Changes touch the middle of this chain.
- **Error propagation:** `player.pause()`/`player.play()` wrapped in try-catch at all call sites. No new error paths.
- **State lifecycle risks:** Removing `p.play()` from setup creates a brief window where the player exists but is not playing. The thumbnail covers this visually.
- **API surface parity:** Both `VideoHeroRenderer` (controlled and uncontrolled modes) and `VideoRenderer` need the R2 fix. Both paths are addressed.

## Acceptance Criteria

- [ ] **R1:** Hero video does not play until it is visible and `paused` is `false`
- [ ] **R1:** Inline videos do not play until `useSectionVisible()` returns `true`
- [ ] **R2:** All videos autoplay muted — hero starts `p.muted = true`, inline starts `p.muted = true`
- [ ] **R3:** Tapping the mute button toggles the icon between `VolumeOffIcon` (muted) and `VolumeOnIcon` (unmuted)
- [ ] **R3:** Tapping the mute button toggles the hero video's audio on/off
- [ ] **R3:** The icon always reflects the actual `player.muted` state of the hero video
- [ ] **R4:** Video players persist in the mount buffer (1.5 VH) and are not destroyed immediately on scroll-away
- [ ] **Gap 4:** A video that enters the viewport during scroll deceleration (no further scroll events) still begins playing
- [ ] Existing tests pass (`VideoHeroRenderer.test.tsx`, `VideoRenderer.test.tsx`, `FixedHeroLayout.test.tsx`)
- [ ] Test on both iOS and Android

## Test Scenarios

1. Load app -> hero video should NOT play audio; mute icon shows muted
2. Scroll down -> hero pauses; inline video autoplays **muted**
3. Scroll back up -> hero resumes; inline video pauses
4. Tap mute button -> icon changes to unmuted; hero audio plays; tap again -> icon changes to muted; hero audio stops
5. Scroll to inline video, stop mid-deceleration -> video starts playing (Gap 4 fix)
6. Fast fling through multiple video sections -> no crashes, no decoder slot exhaustion
7. Background app during video playback -> all videos pause; foreground -> visible videos resume
8. Two inline videos visible simultaneously -> both play muted; no overlapping audio unless user explicitly unmutes via native controls

## Dependencies & Risks

- **expo-video decoder slot release:** Defensive `player.pause()` in cleanup effects addresses expo-video regression (#33804). If slots still leak, a follow-up may need `player.replace(null)`.
- **Native controls + muted start:** Setting `p.muted = true` may affect native controls' initial icon state. Needs verification on both platforms.
- **Nested videos in SectionWrapper:** Known limitation — visibility is computed for the wrapper, not individual nested videos. Acceptable for v1; document for follow-up if needed.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-31-mobile-video-playback-lifecycle-requirements.md](docs/brainstorms/2026-03-31-mobile-video-playback-lifecycle-requirements.md) — Key decisions: per-video mute model, remove `p.play()` from setup, add `p.muted = true` to inline videos.

### Internal References

- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx:125-129` — hero player setup
- `apps/mobile/src/components/sections/VideoRenderer.tsx:40-42` — inline player setup
- `apps/mobile/src/components/sections/FixedHeroLayout.tsx:99,291,318-325` — mute state flow
- `apps/mobile/src/components/sections/LazySection.tsx:88-89,120-163` — mount/visibility gating
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — hero architecture learnings
- `docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md` — mute button pattern

### Known Limitations (deferred)

- Nested video visibility in tall SectionWrappers (SpecFlow Gap 16)
- Scroll offset adjustment when measured height differs from placeholder (SpecFlow Gap 14)
- Debounce on mount/unmount transitions during fast flings (SpecFlow Gap 11)
