---
title: expo-image blurRadius crashes Android when two RenderScript blurs run at once
date: 2026-10-23
category: runtime-errors
module: apps/mobile
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - "The Android app closes when the Search tab opens. The release check labels the attempt app_crashed (1 crash in 12 Search-tab opens on an API 35 emulator, 2026-10-22)."
  - "The logcat crash buffer shows Fatal signal 5 (SIGTRAP) on thread glide-source-th, in libRS_internal.so android::renderscript::ObjectBase::~ObjectBase()."
  - "The native stack is rsContextDestroy <- RenderScript.releaseAllContexts <- jp.wasabeef.glide.transformations.internal.RSBlur.blur <- BlurTransformation.transform <- Glide DecodeJob."
  - "No JavaScript error, red box, or Datadog JS error appears; the process ends in native code."
  - "A 20-open device probe without the fix stayed clean, so the crash does not reproduce on demand."
root_cause: concurrency
resolution_type: code_fix
severity: high
framework_version: "expo-image 57.0.5 / glide-transformations 4.3.0 / react-native 0.86.3"
retire_when: "expo-image's Android blurRadius stops going through glide-transformations RSBlur (RenderScript); after each expo-image upgrade, check what BlurTransformation the ExpoImageViewWrapper.kt customize(blurRadius) call adds, and read the expo-image changelog"
related_components:
  - apps/mobile/src/components/search/TopicCard.tsx
  - apps/mobile/src/components/watch/WatchAmbient.tsx
  - apps/mobile/src/lib/stretchedDecode.ts
  - apps/tv/src/components/search/SearchBrowse.tsx
tags:
  - expo-image
  - blur-radius
  - android
  - renderscript
  - glide
  - native-crash
  - sigtrap
  - release-check
---

# expo-image blurRadius crashes Android when two RenderScript blurs run at once

## Problem

On Android, the app crashed in native code when the Search tab opened. The six browse topic cards each set an expo-image `blurRadius`. When two of those blurs run at the same time, one blur can destroy a RenderScript context that the other blur still uses. The fix is PR #2866 (feat-784), unmerged as of this writing.

## Symptoms

- The Android app closes when the Search tab opens. The mobile release check (feat-798, unmerged as of this writing) labels the attempt `app_crashed` at the step "Search shows", and the failure screenshot shows the Android launcher.
- It happened in 1 of 12 Search-tab opens on the `android-phone` emulator (API 35), 0 of 2 on `android-tablet`, and 0 of 14 on the iOS devices (release check runs, 2026-10-22).
- The logcat crash buffer has `Fatal signal 5 (SIGTRAP)` on thread `glide-source-th`, with this stack:

  ```
  libRS_internal.so android::renderscript::ObjectBase::~ObjectBase()
    <- rsContextDestroy
    <- android.renderscript.RenderScript.releaseAllContexts
    <- jp.wasabeef.glide.transformations.internal.RSBlur.blur
    <- BlurTransformation.transform
    <- Glide DecodeJob
  ```

- No JavaScript handler sees the crash: there is no red box and no JS error in Datadog.

## What Didn't Work

- **Fixing only the topic cards.** `WatchAmbient` also blurs on Android, and a poster swap starts a second decode: `apps/mobile/app/watch/[slug].tsx:448` sets `displayPoster = video?.posterUrl ?? seed?.imageUrl ?? null`, so the wash starts with the seed image and changes to the real poster. Per this session's javap of Glide 5.0.5, `DecodeJob.cancel()` only sets a flag, so a transform that has started runs to its end. The old and the new poster can therefore blur at the same time. Both sites needed the fix.
- **Showing the thumbnails sharp on Android.** The first fix sent no blur and kept the full-size image. The crash path was gone, but every Android user saw a design change: text inside the images ("StoryClub", a large "Study") sat behind the card labels. A crash fix must keep the look, so the soft look came back with a stretched decode (below).
- **A wash shrink of 48.** At 53 screen pixels per bitmap pixel, the stretched poster showed soft vertical streaks under the player on device screenshots. A shrink of 64 (70.4 px) removed them.
- **A fixed overscan of 1.1.** Layout rounds the small box to whole pixels and can move it by half a pixel. On a 480 px wide hdpi phone with shrink 64, the box is 5 dp, and 1.1 left a gap of about 7 dp on each side. The helper now adds a cover term for one rounded pixel.
- **Proving the fix by counting crashes.** At about 1 crash in 12 opens, 20 clean opens happen by chance about 18% of the time ((11/12)^20). The probe without the fix had 0 crashes in 20 opens, so device runs alone could not prove the fix. The structural proof below is the evidence; the device runs (45 opens with the fix, 0 crashes, on 2026-10-22 and 2026-10-23, recorded in PR #2866) only confirm it.

## Solution

Give `blurRadius` on iOS only. On Android, get the soft look from a stretched small decode.

```tsx
// apps/mobile/src/components/search/TopicCard.tsx (abridged)
<Image
  source={thumbnailUrl}
  style={[
    Platform.OS === "ios"
      ? StyleSheet.absoluteFill
      : stretchedDecodeStyle(
          cardWidth,
          cardWidth / CARD_ASPECT_RATIO,
          ANDROID_THUMBNAIL_SHRINK, // 15
        ),
    styles.thumbnail,
  ]}
  contentFit="cover"
  blurRadius={Platform.OS === "ios" ? IOS_THUMBNAIL_BLUR_RADIUS : undefined}
/>
```

`stretchedDecodeStyle` (`apps/mobile/src/lib/stretchedDecode.ts`) puts the image in a box `shrink` times smaller than its frame, at the frame's center, and scales the view back up. The parent must clip it (`overflow: "hidden"`).

```ts
const width = frameWidth / shrink
const height = frameHeight / shrink
const pixel = 1 / pixelRatio
const cover = Math.max(
  (frameWidth + pixel) / (width - pixel),
  (frameHeight + pixel) / (height - pixel),
)
// style: absolute, centered box of width x height,
// transform: [{ scale: Math.max(shrink * MIN_OVERSCAN, cover) }]
```

How the factors were chosen: a stretch of P screen pixels per bitmap pixel looks like a Gaussian blur with a sigma of about P/2 (this session's fit). The old Android blur (radius 4, Glide sampling 4) was about sigma 9 px on a card. A fit against the old blurred card on device screenshots was best at 16 to 17 px, so the cards use 15 (16.5 px). On the final build, the Parables card measured a mean luma gradient of 1.097, against 1.133 with the old blur and 2.623 for the sharp first attempt (device screenshots, 2026-10-23, recorded in PR #2866). The wash uses 64, as above.

Guards that ship with the fix:

- `apps/mobile/src/components/__tests__/noAndroidBlurRadius.guard.test.js` scans `apps/mobile/app/` and `apps/mobile/src/`. Each `blurRadius` site must have the form `blurRadius={Platform.OS === "ios" ? NAME : undefined}`, with `NAME` on an allow list for that file. Its failure messages name feat-784 and `stretchedDecodeStyle`.
- The render tests read the props that expo-image receives on each platform. On Android they pin no `blurRadius`, the small centered box and its scale, `contentFit="cover"`, `allowDownscaling` not `false`, and the clip (`overflow: "hidden"`) on the card and on the `WatchAmbient` root.

## Why This Works

- expo-image 57.0.5 maps the prop at `ExpoImageModule.kt:351-352`: `view.blurRadius = blurRadius?.takeIf { it > 0 }`. With no value, the prop stays null.
- `ExpoImageViewWrapper.kt:446-447` adds the blur through `.customize(blurRadius) { transform(BlurTransformation(min(it, 25), 4)) }`, and `customize` (`GlideExtensions.kt:20`) returns the request unchanged for a null value. So no `BlurTransformation` is added, and `RSBlur.blur` cannot run.
- The crash itself (per this session's javap of glide-transformations 4.3.0, the version in expo-image's `build.gradle:55`): `RSBlur.blur` calls `RenderScript.create()` and, at its end, `RenderScript.releaseAllContexts()`. That call destroys every RenderScript context in the process, including one that another Glide thread is still using. The crash needs two blurs that overlap, and six cards that decode together make that likely.
- The stretched decode: `createDownsampleStrategy` (`ExpoImageViewWrapper.kt:483-495`) uses `ContentFitDownsampleStrategy` only when `allowDownscaling` is true and `contentFit` is not `fill` or `none`. Then Glide decodes at the view's layout size, so a box 15 times smaller than a 480 px card gives a bitmap about 32 px wide. The GPU stretches that bitmap with bilinear filtering, which looks soft. A later `contentFit="fill"` or `allowDownscaling={false}` would decode at full size and show a sharp image, with no crash and no test failure. That is why the tests pin both props.

## Prevention

- Never send an expo-image `blurRadius` to Android. The rule is in `apps/mobile/CLAUDE.md` (Common Pitfalls), and the guard test enforces it for `apps/mobile`.
- For a soft image on Android, use `stretchedDecodeStyle`. Keep the parent's `overflow: "hidden"`, keep `contentFit="cover"`, and keep downscaling on.
- To prove a fix for a rare native crash, trace the structural path first: the prop, its native mapping, and proof that the crashing code cannot run. Before you trust a clean device run, compute the chance of a false clean run, `(1 - p)^n`.
- When a fix removes a visual effect, compare device screenshots with the old ones by measurement (gradient, RMSE), not by eye.
- Open as of this writing: `apps/tv/src/components/search/SearchBrowse.tsx:28` still sets `THUMBNAIL_BLUR_RADIUS = Platform.OS === "ios" ? 12 : 4`, and line 186 sends it to expo-image 3.0.11. That version adds the same `BlurTransformation` (`ExpoImageViewWrapper.kt:436`), so Android TV has the same crash path. The guard does not scan `apps/tv`. TV and mobile code are copies, so a fix needs both apps (auto memory [claude]). The owner decides on a follow-up.

## Related Issues

- PR #2866 (feat-784): the fix, unmerged as of this writing.
- `docs/solutions/mobile/expo-image-blurradius-cross-platform-calibration.md`: the earlier iOS 12 / Android 4 calibration. Its Android half is superseded by this learning.
- `docs/solutions/best-practices/whole-source-allowlist-guard-for-defects-no-gate-catches.md`: the guard technique that `noAndroidBlurRadius.guard.test.js` follows.
- `docs/solutions/best-practices/expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md`: the table of blur surfaces in this app; its `blurRadius` row is iOS only now.
- `docs/solutions/runtime-errors/player-settings-sheet-fullscreen-orientation-sigabrt-crash.md`: an iOS native crash that, like this one, no JavaScript handler sees.
- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`: do not trust a clean device run as proof.
