---
title: "VideoPlayer pointerEvents=none wrapper blocks AVPlayerLayer rendering on tvOS"
date: "2026-04-15"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Video player overlay opens with dark background and controls visible but video area is black"
  - "Player controls functional (play/pause, seek respond) but no video frame renders"
  - "Progress stays at 0:00 and duration shows --:--"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - tv
  - video
  - avplayerlayer
  - expo-video
  - react-native-tvos
  - pointer-events
  - focus
  - tvos
---

# VideoPlayer pointerEvents=none wrapper blocks AVPlayerLayer rendering on tvOS

## Problem

The `VideoPlayer` overlay component in `apps/tv` wrapped its `<VideoView>` in a `<View pointerEvents="none">` to prevent D-pad focus stealing. In the full-screen overlay context, this wrapper prevented the AVPlayerLayer from compositing within the React Native view hierarchy -- the native rendering layer was created but never became visible. Users saw a black screen with functional controls when playing any video from a card or carousel.

## Symptoms

- Clicking a video card opened the VideoPlayer overlay with dark background and controls visible
- Video area showed only black -- no frame ever rendered
- Player controls were functional (play/pause, seek responded)
- Progress bar showed 0:00; duration showed "--:--"
- Once fixed, a previously hidden full-screen dark scrim (`rgba(0,0,0,0.35)`) became visible, darkening the video

## What Didn't Work

- **Adding `focusable={false}` while keeping the wrapper** -- video still did not render. The wrapper's effect on AVPlayerLayer is independent of the `focusable` prop.
- **Adding `player.play()` retry with 300ms delay** -- addressed a tvOS autoplay race condition where the player isn't ready on mount, but did not fix the rendering issue. The player was playing (events fired) but the layer wasn't visible.
- **Restoring the wrapper after code review** -- a ce:review pass found the documented solution (`tv-videoview-steals-dpad-focus`) which states the wrapper is required. Restoring it re-broke video playback. The documented pattern is correct for inline VideoViews but wrong for overlay VideoViews. (session history)

## Solution

Remove the `<View pointerEvents="none">` wrapper entirely. Apply `focusable={false}` directly on the `VideoView`. Also remove the full-screen dark scrim that was only visible once video started rendering.

**Before (broken):**

```tsx
;<View style={StyleSheet.absoluteFill} pointerEvents="none">
  <VideoView
    style={StyleSheet.absoluteFill}
    player={player}
    nativeControls={false}
    contentFit="contain"
  />
</View>

{
  /* Dark scrim over video */
}
;<View style={styles.scrim} pointerEvents="none" />
```

**After (working):**

```tsx
{
  /* TVFocusGuideView with trapFocus* already contains D-pad navigation.
    focusable={false} prevents VideoView from becoming a focus target
    without blocking AVPlayerLayer rendering. */
}
;<VideoView
  style={StyleSheet.absoluteFill}
  player={player}
  nativeControls={false}
  contentFit="contain"
  focusable={false}
/>

{
  /* No scrim needed -- controls panel and back button have
    their own semi-transparent glass backgrounds. */
}
```

## Why This Works

`pointerEvents="none"` on a parent View propagates its pointer event policy to child native views. On tvOS, this interferes with AVPlayerLayer presentation -- the layer is created but never composited into the visible view hierarchy.

The overlay context is meaningfully different from inline VideoView usage:

| Context                             | Focus containment                                     | VideoView wrapper                              | Why                                                                                     |
| ----------------------------------- | ----------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Inline** (e.g. VideoHeroRenderer) | None -- VideoView is in the page scroll               | `<View pointerEvents="none">` required         | No TVFocusGuideView trap; VideoView can steal D-pad focus from surrounding content      |
| **Overlay** (e.g. VideoPlayer)      | `TVFocusGuideView` with `trapFocusUp/Down/Left/Right` | No wrapper -- use `focusable={false}` directly | trapFocus already contains all D-pad navigation; wrapper blocks AVPlayerLayer rendering |

The `VideoHeroRenderer` was the reference implementation that confirmed the pattern: it uses `focusable={false}` directly with no wrapper and renders video correctly.

## Prevention

- **Context matters for `pointerEvents="none"` on VideoView.** The wrapper pattern from `tv-videoview-steals-dpad-focus` applies to inline VideoViews without focus trapping. Full-screen overlay VideoViews with `TVFocusGuideView trapFocus` must NOT use the wrapper.
- After any modification to a VideoView wrapper pattern (adding, removing, or changing `pointerEvents` or `focusable`), always verify that video frames actually render on a tvOS device/simulator before merging. A black screen with functional controls is the failure signature.
- When code review finds a documented pattern that contradicts the working code, verify the pattern's context assumptions before applying it. Documented solutions encode the context in which they were discovered -- applying them in a different context can introduce regressions.

## Related Issues

- `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md` -- the original pattern doc. Correct for inline VideoViews but its Prevention section needs a caveat for overlay contexts. **Recommend updating** to add: "Exception: overlay VideoViews with TVFocusGuideView trapFocus must NOT use the wrapper."
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` -- VideoHeroRenderer patterns including gradient overlay and `hexToRgba` usage. The hero's VideoView approach (no wrapper, `focusable={false}`) is the reference for the overlay fix.
- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` -- comprehensive tvOS pitfall catalog. **Recommend adding Pitfall 5** for this issue.
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` -- TV platform setup patterns. **Recommend updating** Section 6 (Focus Management) with overlay VideoView guidance.
