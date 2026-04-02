---
date: 2026-03-31
topic: mobile-video-playback-lifecycle
---

# Mobile Video Playback Lifecycle Bugs

## Problem Frame

The video playback experience in the Expo mobile app has several interrelated bugs: videos play before they are visible, inline videos autoplay with sound, the mute button icon is desynced from actual audio state, and the hero video initializes playback immediately at mount rather than waiting for visibility. These issues undermine the viewport-gated lazy rendering system built in the prior lazy section work.

## Requirements

- R1. **Videos paused until visible.** No video (hero or inline) should play until its section is within the visible viewport. The hero video must respect the `paused` prop before its initial `play()` call.
- R2. **Autoplay muted.** When a video becomes visible and autoplays, it must start muted. This applies to both the hero `VideoHeroRenderer` and inline `VideoRenderer`.
- R3. **Mute toggle works correctly.** The mute button icon is currently stuck on "muted" and never toggles visually — even when tapped or when audio is audible from any video. Tapping the mute button must toggle the audio state AND update the icon to match (VolumeOffIcon when muted, VolumeOnIcon when unmuted).
- R4. **Delayed player destruction.** Video players should not be destroyed immediately when scrolling out of the viewport. The existing `LazySection` unmount buffer (1.5 VH) handles this — verify it is functioning and not too aggressive.

## Root Causes

- **R1 violation:** `VideoHeroRenderer` calls `p.play()` in the `useVideoPlayer` setup callback (line 128), bypassing the `paused` prop effect that runs after mount.
- **R2 violation:** `VideoRenderer` omits `p.muted = true` in the setup callback (line 40-42). Comment says this is for native controls, but it means inline videos autoplay unmuted.
- **R3 violation:** The mute button icon in `FixedHeroLayout` is stuck on `VolumeOffIcon` (muted) and never toggles visually when tapped. Root cause needs investigation: could be touch event preemption by ScrollView, a rendering issue with the icon components, or a state reset from scroll-driven re-renders.

## Success Criteria

- No audio plays from any video that is not visible in the viewport.
- All videos autoplay muted when they first enter the viewport.
- Tapping the mute button toggles audio and the icon reflects the current state.
- Scrolling past a video and back does not cause a jarring re-initialization within the mount buffer.

## Scope Boundaries

- **In scope:** `VideoHeroRenderer`, `VideoRenderer`, `FixedHeroLayout` mute state, `LazySection` visibility gating verification.
- **Out of scope:** Lazy section architecture changes, new UI for inline video mute controls, global audio session management.

## Next Steps

-> `/ce:plan` for structured implementation planning, or proceed directly to fix.
