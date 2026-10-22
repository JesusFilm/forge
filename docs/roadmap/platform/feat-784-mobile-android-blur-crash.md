---
id: "feat-784"
title: "Android app crash in expo-image's RenderScript blur"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-10-23"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
---

## Problem

The Android app can crash when the Search tab opens. The release check (feat-783) found it on 2026-10-22 at 19:46:39Z, on the `android-phone` emulator (API 35), in the `search-open-result` journey at the step "Search shows". It crashed in 1 of 5 Search-tab opens. Each open starts from cleared app data, so each one decodes the images again.

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

Likely mechanism (not verified): `RSBlur.blur` calls `RenderScript.releaseAllContexts()` after each blur. That call destroys every RenderScript context in the process, including the contexts that other threads still use. The crash has not been checked on a physical phone yet.

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
3. In a separate change on the feat-783 branch, remove the `feat-784` Known-Bug entries when this fix is on `main`.

## Constraints

- Do not use React Native's `<Image>` for a blur. The app uses `expo-image` everywhere.
- Do not add a native module or a config plugin for this fix. Either one moves the fingerprint runtime version.
- Keep iOS unchanged. The crash path is Android-only.

## Verification

- `pnpm --filter @forge/mobile test` passes, with the new guard falsified once.
- On an Android emulator, open the Search tab from cleared app data at least 20 times with no crash. With the 1-in-5 rate, 20 clean opens without the fix have a chance of about 1%.
- Screenshot the Android topic cards before and after the change, and record the label contrast.
- After the fix is on `main`, a release check run shows no `feat-784` Known-Bug match, and the summary proposes to remove the entries.
