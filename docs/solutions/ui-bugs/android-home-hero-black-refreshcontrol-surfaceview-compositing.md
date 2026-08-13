---
title: "Android home hero rendered black under RN 0.86: opaque RefreshControl host + default expo-video SurfaceView"
date: "2026-08-13"
category: "ui-bugs"
module: "apps/mobile"
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "Home screen hero (HomeHeroPager, z-index-0 layer behind the FlashList feed) rendered solid black on Android after the Expo SDK 57 / RN 0.86 (Fabric) upgrade"
  - "ExoPlayer was actively decoding the whole time (logcat MediaSessionService position advancing for minutes, no player error) while nothing painted"
  - "iOS was unaffected; only Android showed the black hero"
  - "The bug required TWO independent fixes together; neither alone restored the hero"
  - "A long-lived emulator session (~6h gfxstream uptime) reproduces an identical black hero even with both fixes applied; a cold emulator boot resolves it"
root_cause: config_error
resolution_type: code_fix
related_components:
  - "expo-video"
  - "react-native RefreshControl"
  - "@shopify/flash-list"
tags:
  - android
  - rn-fabric
  - expo-video
  - surfaceview
  - textureview
  - refreshcontrol
  - hero
  - compositing
---

# Android home hero renders black on Expo SDK 57 / RN 0.86 Fabric

## Problem

The mobile app's Home tab hero video renders solid black on Android after the
Expo SDK 54→57 / React Native 0.86 Fabric upgrade (PR #1926, open branch
`chore/mobile-expo-sdk-57-upgrade`). ExoPlayer decodes the stream correctly the
whole time. iOS does not show this bug. The watch-page player is also
unaffected, because it already sets `surfaceType="textureView"` on Android
(`apps/mobile/src/components/watch/VideoPlayer.tsx:408`).

The Home tab uses the Three-Layer Hero pattern (defined in CONCEPTS.md) and stacks three layers
(`apps/mobile/src/components/home/HomeScreen.tsx:433-493`):

1. `heroLayer` — `position: "absolute"`, `zIndex: 0` (line 584-590), hosts
   `HomeHeroPager`.
2. `FlashList` — the scrollable feed, painted on top of the hero.
3. `heroInteractiveLayer` — `zIndex: 2`, `pointerEvents="box-none"`, hosts the
   Watch Now / mute chrome.

The hero is visually BEHIND the list. The list's `contentContainerStyle`
padding (`paddingTop: heroHeight`, line 383) is what lets the hero show
through where the feed has no content yet. Any opaque layer inside the list's
subtree — including the padding region's native host — hides the hero.

## Symptoms

- Home tab hero is solid black on Android emulators and hardware.
- Logcat shows `MediaSessionService` in state `PLAYING`, playback position
  advancing every second, `error=null`, sustained for minutes. This is the
  key discriminator: the stream is decoding, not failing. A stream-failure
  bug would show a decoder error, a stalled position, or a `statusChange`
  event with `status: "error"` in `HomeHeroPager.tsx`'s own listener
  (`HomeHeroPager.tsx:189`) — none of that fires here.
- iOS renders the same hero correctly with no code difference on that
  platform.
- The watch-page player (`VideoPlayer.tsx`) never reproduces this — it
  already used `textureView` before the upgrade.

## What Didn't Work

Two assumptions delayed the fix, and are worth naming so a future
regression skips them:

- **Assuming the stream had failed.** The video decodes the whole time
  (advancing position, `error=null`). Any fix aimed at the network layer,
  the Mux URL, or `useHeroStream` would not touch a compositing bug.
- **Assuming a single cause.** Two independent Android-only regressions
  stack in this layout. Applying only the `textureView` fix leaves the hero
  black, because `RefreshControl` still occludes it. Applying only the
  `RefreshControl` fix also leaves the hero black, because the default
  `SurfaceView` still fails to composite. The bisection sequence below is
  what proves there are two causes, not one.
- **Trusting a long-running emulator during verification.** An emulator with
  roughly 6 hours of `gfxstream` uptime reproduces an identical black hero
  even WITH both fixes applied, while the watch page keeps rendering fine on
  the same emulator. `gfxstream` had logged `DisplaySurfaceGl: Failed to
restore previous context` earlier the same day. A cold emulator boot
  restores correct rendering. This is a known triage note on GitHub issue
  #1928, not a regression in the fix — do not chase it as one.

## Solution

### Diagnostic method: layer-by-layer bisection

Each step is a Fast Refresh probe plus an emulator screenshot. This is the
reusable part — apply it to any "something renders behind other content"
bug on Android Fabric.

1. Give the hero page container a solid red background. It stays invisible.
   This rules out a video-only failure — the whole hero layer is occluded
   from above.
2. Give the `heroLayer` wrapper a solid lime background. It stays invisible.
   The occlusion covers the whole layer, not just the video page.
3. Stop rendering the `FlashList` entirely. The hero video paints. The
   occluder lives inside the list's subtree.
4. Restore the `FlashList`, but remove `RefreshControl`. The hero paints.
   The occluder is `RefreshControl`'s native host (`SwipeRefreshLayout` on
   Android).
5. Restore `RefreshControl` with an explicit transparent background. The
   hero paints. This confirms cause (a) below and its fix.
6. Revert the hero `VideoView` to the default `SurfaceView` (keep
   `RefreshControl` transparent). The hero goes black again, while ExoPlayer
   keeps decoding. This is a second, independent cause — cause (b) below.

### Cause (a): `RefreshControl` paints an opaque native host

On RN 0.86 Android, `RefreshControl`'s `SwipeRefreshLayout` host paints
opaque by default. It sits inside the `FlashList` subtree above the z-0
hero layer, so it hides the hero even where the list has no content of its
own. Fix — give it an explicit transparent background
(`apps/mobile/src/components/home/HomeScreen.tsx:460-469`):

```tsx
refreshControl={
  <RefreshControl
    refreshing={refreshing}
    onRefresh={refetch}
    tintColor={TEXT_SECONDARY}
    // RN 0.86: Android's SwipeRefreshLayout host paints opaque by
    // default, which hides the z-0 hero layer under the list.
    style={styles.refreshControl}
  />
}
```

`styles.refreshControl` (`HomeScreen.tsx:591-593`):

```ts
refreshControl: {
  backgroundColor: "transparent",
},
```

### Cause (b): the default `SurfaceView` never composites in this stack

`expo-video`'s default Android surface (`SurfaceView`) decodes correctly but
never composites under this layered, absolutely-positioned RN Fabric stack —
the hero shows black even though the decoder reports `PLAYING`. Fix — opt
the hero `VideoView` into `textureView` on Android
(`apps/mobile/src/components/home/HomeHeroPager.tsx:688-697`):

```tsx
<VideoView
  player={player}
  style={StyleSheet.absoluteFill}
  nativeControls={false}
  contentFit="cover"
  // RN 0.86 Fabric: the default SurfaceView decodes but never
  // composites under the layered home stack — hero shows black.
  surfaceType={Platform.OS === "android" ? "textureView" : undefined}
/>
```

This matches the pre-existing pattern already shipped on the watch page
(`apps/mobile/src/components/watch/VideoPlayer.tsx:408`), which never showed
this bug because it already used `textureView`.

### Follow-up hardening (same PR)

- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx:168-176` — the
  SDUI experience hero, mounted by `CuratedHomeLayout` in the same
  zIndex-0-behind-`FlashList` shape
  (`apps/mobile/src/components/sections/CuratedHomeLayout.tsx:162-174`),
  gets the identical `surfaceType` prop. No published Experience carries a
  `VideoHeroBlock` today, so this closes the gap before one does.
- A source-shape guard test,
  `apps/mobile/src/components/home/__tests__/homeHeroAndroidCompositing.guard.test.ts`,
  pins all three fixes: the `HomeHeroPager` `surfaceType` literal, the
  `VideoHeroRenderer` `surfaceType` literal, and both halves of the
  `RefreshControl` transparent-background wiring in `HomeScreen.tsx`. The
  test was falsified once during development — reverting the `surfaceType`
  prop turned it red — before landing.

## Why This Works

Jest cannot see native compositing. Nothing in the existing test suite
renders an Android `SurfaceView` or a `SwipeRefreshLayout` and checks what
paints on top of what — that behavior only exists on-device. A one-line
revert of either fix compiles cleanly, typechecks cleanly, and leaves the
whole jest suite green, because the bug is not a logic bug: it is a
platform-specific native rendering property of a Fabric-era `SurfaceView`
and `SwipeRefreshLayout` inside an absolutely-positioned layer stack.

`textureView` fixes cause (b) because it renders the video content through
the normal RN view hierarchy instead of punching a separate hardware
compositor surface through it — a `SurfaceView` composites outside that
hierarchy and RN 0.86 Fabric's layering does not carry it through correctly
in this stack. `backgroundColor: "transparent"` fixes cause (a) because it
removes `SwipeRefreshLayout`'s default opaque paint, letting the z-0 hero
show through the list's padding region as designed.

The `logcat` discriminator — `MediaSessionService` in `PLAYING`, position
advancing, `error=null` — is what separates "compositing bug" from "stream
bug" for any future black-video report. If the decoder reports an error or a
frozen position, look at the network/player layer. If it reports healthy
playback while the screen stays black, look at the surface/compositing
layer, starting with the bisection sequence above.

## Prevention

- **Known tradeoff, tracked not ignored.** `textureView` renders through the
  view hierarchy rather than a separate hardware layer — a real
  compositing-cost tradeoff versus `SurfaceView`. The repo's designated
  evidence path is the post-merge Datadog RUM app-start comparison (recorded
  as a PR #1926 review comment) — check that comparison before assuming the
  cost is negligible.
- **Guard the source shape, not just the runtime behavior.** Where a fix is
  invisible to jest (native compositing, native z-order), add a source-shape
  guard test that pins the literal fix and falsify it once by reverting the
  fix and confirming the guard goes red. See
  `homeHeroAndroidCompositing.guard.test.ts` for the pattern: read the file,
  slice out the relevant JSX/style block, assert the exact literal is
  present.
- **Bisect layer-by-layer on any "renders behind" Android report.** Probe
  color, remove a layer, restore it, remove the next candidate — one
  Fast-Refresh-and-screenshot cycle per step. Stop only once removing a
  single element flips the symptom; don't stop at the first fix that helps,
  because a stacked-layer bug can have more than one occluder.
- **Don't trust a long-lived emulator for verification.** If a fix appears
  to regress on-device after it previously passed, check emulator/gfxstream
  uptime and logs for `DisplaySurfaceGl` context-loss messages before
  re-opening the bug. A cold boot is the first troubleshooting step, not a
  code change. See GitHub issue #1928 for the recorded triage note.
- **Check sibling surfaces before shipping a new hero-shaped component.**
  Any new `VideoView` mounted in a zIndex-0-behind-list stack on Android
  needs the same `surfaceType={Platform.OS === "android" ? "textureView" :
undefined}` prop up front — `VideoHeroRenderer` needed it even with zero
  production traffic today, because the shape alone reproduces the bug the
  moment traffic exists.

## Related Issues

- GitHub issue #1928 — the residual cold-start gap (poster does not paint during stream warm-up) discovered right after these fixes landed, plus the emulator-session triage note. Not a duplicate: it is the follow-up, not the bug these fixes solved.
- `docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md` — sibling failure mode in the opposite direction on apps/tv: a SurfaceView punching THROUGH a clip and painting over content. Same "SurfaceView bypasses RN compositing" family.
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — the foundational hero pattern doc; its Android VideoView z-order section prescribes avoidance-only layout. The textureView remedy here is a direct alternative for that constraint.
- `docs/solutions/mobile/flashlist-opaque-background-hides-absolute-hero.md` — same symptom vocabulary at a different layer (an RN style prop painting over the padding region, not a native host).
- `docs/solutions/mobile/flashlist-hero-bleed-through-feed-background.md` — same two-layer hero architecture, opposite symptom direction (hero too visible instead of hidden).
- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — a different root cause for a "video renders black" symptom (decoder starvation on tvOS), useful for differential diagnosis.
