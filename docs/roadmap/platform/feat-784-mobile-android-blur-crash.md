---
id: "feat-784"
title: "Android app crash in expo-image's RenderScript blur"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-10-23"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
---

## Problem

The Android app can crash when the Search tab opens. The release check (feat-786) found it on 2026-10-22 at 19:46:39Z, on the `android-phone` emulator (API 35), in the `search-open-result` journey at the step "Search shows". On 2026-10-22 the release check counted 1 crash in 12 Search-tab opens on `android-phone`, 0 in 2 on `android-tablet`, and 0 in 14 on the iOS devices. Each open starts from cleared app data, so each one decodes the images again.

The crash is a native `SIGTRAP` on a Glide thread (`glide-source-th`), so no JavaScript error handler sees it:

```
libRS_internal.so android::renderscript::ObjectBase::~ObjectBase()
  <- rsContextDestroy
  <- android.renderscript.RenderScript.releaseAllContexts
  <- jp.wasabeef.glide.transformations.internal.RSBlur.blur
  <- jp.wasabeef.glide.transformations.BlurTransformation.transform
  <- Glide DecodeJob
```

On Android, `expo-image` 57.0.5 turns the `blurRadius` prop into `BlurTransformation(min(radius, 25), 4)` from `jp.wasabeef:glide-transformations:4.3.0` (`ExpoImageViewWrapper.kt`). That transformation blurs with RenderScript. The six browse topic cards on the Search tab each set `blurRadius`, so up to six blurs run at the same time on Glide's decode threads.

Mechanism (confirmed by a `javap` reading of `glide-transformations` 4.3.0 on 2026-10-23): `RSBlur.blur` calls `RenderScript.releaseAllContexts()` after each blur. That call destroys every RenderScript context in the process, including the contexts that other threads still use. The crash has not been checked on a physical phone yet. See `docs/solutions/runtime-errors/expo-image-android-blur-renderscript-crash.md`.

## Entry Points — Read These First

1. `apps/mobile/src/components/search/TopicCard.tsx` — `THUMBNAIL_BLUR_RADIUS` (4 on Android) and the `blurRadius` prop on the thumbnail `Image`.
2. `apps/mobile/src/components/watch/WatchAmbient.tsx` — `AMBIENT_BLUR` and the second `blurRadius` user. Check whether two of its blurs can decode at the same time (a poster change, a cross-fade, a remount).
3. `apps/mobile/node_modules/expo-image/android/src/main/java/expo/modules/image/ExpoImageViewWrapper.kt` — the `customize(blurRadius) { transform(BlurTransformation(min(it, 25), 4)) }` call.
4. `apps/mobile/release-check/config/known-bugs.json` — the Known-Bug entries that name this ticket.

## Grep These

- `blurRadius` in `apps/mobile/app` and `apps/mobile/src`
- `THUMBNAIL_BLUR_RADIUS`, `AMBIENT_BLUR`
- `feat-784` in `apps/mobile/release-check/config/known-bugs.json`

## What To Build

1. Stop every RenderScript blur on Android: no `expo-image` `blurRadius` reaches an Android view.
   - `TopicCard`: Android shows the thumbnail with no blur. Keep the label readable over the brightest real thumbnail: measure the label's contrast against the scrim on the device, and change the scrim or the image opacity only if the measurement needs it.
   - `WatchAmbient`: apply the same rule if two of its blurs can decode at the same time. Otherwise, write down why one blur at a time is safe, in the PR.
2. Add a jest guard that fails when a `blurRadius` value can reach Android. Falsify it once.
3. In a separate change on the feat-786 branch, remove the `feat-784` Known-Bug entries when this fix is on `main`.

## Constraints

- Do not use React Native's `<Image>` for a blur. The app uses `expo-image` everywhere.
- Do not add a native module or a config plugin for this fix. Either one moves the fingerprint runtime version.
- Keep iOS unchanged. The crash path is Android-only.

## Verification

- `pnpm --filter @forge/mobile test` passes, with the new guard falsified once.
- On an Android emulator, open the Search tab from cleared app data at least 40 times with no crash. At the measured rate of about 1 in 12, 40 clean opens without the fix have a chance of about 4%. The main proof is structural: with no `blurRadius`, expo-image adds no `BlurTransformation`, so the RSBlur path cannot run.
- Screenshot the Android topic cards before and after the change, and record the label contrast.
- After the fix is on `main`, a release check run shows no `feat-784` Known-Bug match, and the summary proposes to remove the entries.

## Results (2026-10-22)

The release check runner ran a probe on the `android-phone` emulator: launch, open the Search tab, and hold 8 s while the six topic thumbnails decode. The runner clears the app data before each try.

| Build                                  | Tries | Crashes |
| -------------------------------------- | ----- | ------- |
| Release check branch, no fix           | 20    | 0       |
| With the fix (first round, no blur)    | 40    | 0       |
| With the fix (final, stretched decode) | 5     | 0       |

- The probe did not reproduce the crash without the fix. At about 1 crash in 12 opens, 20 clean tries happen by chance about 18% of the time. So the main proof is structural: with no `blurRadius`, `ExpoImageModule.kt` keeps the prop null, `ExpoImageViewWrapper.kt` adds no `BlurTransformation`, and `RSBlur.blur` cannot run.
- The first round showed sharp topic thumbnails and soft vertical streaks in the ambient wash. The final round uses `stretchedDecodeStyle` (`src/lib/stretchedDecode.ts`): the topic cards use a shrink of 15, and the wash uses 64. On device screenshots, the topic cards match the old blurred look (mean luma gradient 1.097 against 1.133 with the old blur), the corners stay clipped, and the wash shows no streaks and no seam.
- Follow-up on the feat-786 branch: remove the five `feat-784` Known-Bug entries in `apps/mobile/release-check/config/known-bugs.json` after this fix is on `main`.
