# Android picture-in-picture on Expo SDK 57 — spike evidence

**Date of the spike:** 2026-08-13. **Copied into the repo:** 2026-08-15, during
U9 of `docs/plans/2026-08-12-001-feat-mobile-mini-player-plan.md`.

**Why this file exists.** The findings below lived only in one developer's home
directory and on a local-only git branch. A single `git branch -D` destroyed
the diff, and a laptop reset destroyed the rest. The plan's KD4 — ship
picture-in-picture on SDK 57 rather than on SDK 54 — rests on this evidence, so
it now travels with the repo.

**What is here and what is not.** The findings and the whole spike diff are
below. The nine screenshots are NOT in the repo; they are ~12 MB of emulator
captures and are named in place so a reader knows what was measured. They were
at `~/Documents/forge-pip-evidence-u4/` on the author's machine on 2026-08-13.
Treat any claim that rests on a named screenshot as a claim from a spike that
was run, not one this repo can re-check.

---

## Original findings, verbatim

> # U4 — Android PiP spike evidence (Expo SDK 57)
>
> Date: 2026-08-13. Emulator: Pixel_9a_API_35 (Android 15).
> Branch: `spike/mobile-pip-evidence` (never merges).
> Spike changes: app.json expo-video plugin `supportsPictureInPicture: true`;
> `startsPictureInPictureAutomatically` on the watch `VideoPlayer`;
> `SPIKE_SKIP_BACKGROUND_PAUSE` in `useManagedVideoPlayer` (evidence aid only).
>
> ## Verdict
>
> Android PiP works at SDK 57. The upgrade unblocks the feature. The feature
> needs three pieces of app work before it can ship (below).
>
> ## Evidence
>
> 1. **Inline watch player auto-enters PiP.** `u4-pip-5a.png` and `u4-pip-5b.png`
>    are 5 s apart; the PiP window shows different movie frames, so the video
>    renders AND plays. `dumpsys activity` shows the task `mode=pinned`,
>    `mLastReportedPictureInPictureMode=true`.
> 2. **Custom fullscreen overlay keeps PiP.** `u4-fs-active2.png` shows the
>    custom landscape fullscreen (2:24/3:42). HOME from there produced a live
>    PiP window (`u4-fs-pip2.png`).
> 3. **Home hero stays out of PiP.** `u4-neg-home.png` (hero active) then HOME:
>    `u4-neg-launcher.png` has no PiP window; pinned count 0. Hero VideoViews
>    carry no PiP props, so they are structurally ineligible.
> 4. **Series-detail trailer ALSO auto-enters PiP.** Fresh session, no watch
>    visit: `u4-trailer-fresh-detail.png` → HOME → `u4-trailer-fresh-launcher.png`
>    shows the trailer pinned. Cause: `app/video/[sectionKey].tsx:157` and
>    `app/collection/[sectionKey].tsx:343` already ship `allowsPictureInPicture`;
>    the prop was inert at SDK 54 only because app.json lacked the plugin flag.
>    On Android, an eligible VideoView auto-enters on HOME without
>    `startsPictureInPictureAutomatically`.
> 5. **No expo/expo#45668 crash.** No app FATAL in logcat across all runs; the
>    process stayed alive through every PiP entry and restore.
> 6. **The app pauses itself on PiP entry.** `u4-pip-3.png` shows the first
>    attempt: a white/frozen PiP window. The media session sat PAUSED because
>    `useManagedVideoPlayer` pauses on AppState `background`, and Android
>    reports PiP entry as background. The spike-only pause skip restored live
>    playback, which proves the mechanism.
>
> ## Required app work when the feature ships (separate PR)
>
> - Exempt PiP from the AppState background pause. Use expo-video's
>   `onPictureInPictureStart` / `onPictureInPictureStop` on the VideoView to
>   track PiP state; pause only when backgrounded AND not in PiP.
> - Decide the trailer surfaces. Enabling the plugin flag activates the two
>   existing `allowsPictureInPicture` props on video/collection trailers. Strip
>   them or keep them deliberately.
> - The chore branch does NOT set the plugin flag, so mainline behavior is
>   unchanged by the upgrade itself.

---

## The spike diff, recorded so the branch is no longer load-bearing

The spike branch was `spike/mobile-pip-evidence`, two commits on top of
`a144b318d`. Neither ever merges. Both are reproduced here in full because they
are two lines and eleven lines, and because a local branch is not storage.

`ff09ea35b` — `apps/mobile/app.json`:

```diff
       [
         "expo-video",
         {
-          "supportsBackgroundPlayback": true
+          "supportsBackgroundPlayback": true,
+          "supportsPictureInPicture": true
         }
       ],
```

`ff09ea35b` also added `startsPictureInPictureAutomatically` to the watch
player's `VideoView` in `apps/mobile/src/components/watch/VideoPlayer.tsx`.

`3414471eb` — a spike-only `SPIKE_SKIP_BACKGROUND_PAUSE` constant in
`apps/mobile/src/hooks/useManagedVideoPlayer.ts` that skipped the AppState
`background` pause outright. It was an evidence aid, never a candidate fix: it
would have disabled the background pause for every video in the app.

## What shipped instead, and where each finding landed

- Finding 6 became R13: `src/lib/pipPolicy.ts` decides the AppState branch, and
  the latch it reads is `setPipHold` on the mini-player store. The latch is fed
  from the VIEW's `onPictureInPictureStart` / `onPictureInPictureStop`, exactly
  as the spike recommended, so the pause is skipped only while the operating
  system's window is actually showing. The Android ordering question this raised
  was answered on 2026-08-25 — see the note under "Still unproven".
- Finding 4 became R14. The trailer surfaces were KEPT deliberately. Since the
  root playback host landed, the watch screen and the series-detail trailer
  share the app's ONE video view, so the host covers that pair; the two SDUI
  `[sectionKey]` screens keep views of their own. Three call sites, four
  surfaces, one helper —
  `apps/mobile/src/lib/miniPlayer/pictureInPicture.ts`. Read the correction
  below before relying on finding 4's stated mechanism.
- Finding 3 still holds by construction. Home's hero views never reach the
  player adapter and carry no picture-in-picture prop.
- Finding 1 and 2 are the reason KD4 chose SDK 57. Superseded in part on
  2026-08-25: finding 1 (the inline watch player auto-enters and plays live) is
  now confirmed on a Galaxy Tab S8 and a Galaxy S20 (Android 13). Finding 2
  (custom fullscreen keeps the window) has still not been re-run on hardware,
  and the emulator remains its only evidence.

## Correction to finding 4's mechanism (2026-08-18, during U9)

Finding 4 says an eligible Android `VideoView` auto-enters on HOME **without**
`startsPictureInPictureAutomatically`. The installed expo-video (57.0.2,
released 2026-07-22 — the same version the spike ran on) contradicts that:

- Android has **no `allowsPictureInPicture` prop at all**. Its `VideoModule.kt`
  declares eight view props and that is not one of them, so the prop the spike
  named on `app/video/[sectionKey].tsx` and `app/collection/[sectionKey].tsx`
  cannot have been what armed anything on Android. It is an iOS and web prop.
- `PictureInPictureManager.findAutoPiPViewCandidate` filters on
  `pipParams.autoEnter`, and the only writer of `autoEnter` is the
  `startsPictureInPictureAutomatically` prop.

The likelier explanation for the observation: the spike's own diff added
`startsPictureInPictureAutomatically` to the shared watch `VideoPlayer`
component, and that component rendered the series-detail trailer the screenshot
captured. The observation stands; the attribution does not.

**What this changes.** `allowsPictureInPicture` remains correct on all three
call sites — it is what puts a picture-in-picture button in iOS's native
transport controls, and the two SDUI screens run with native controls enabled.
Only the host arms `startsPictureInPictureAutomatically`; expo-video elects one
candidate across every view carrying it and warns when it finds more.

## Configuration evidence (2026-08-18, during U9)

Two Android prebuilds of the same tree, differing only in the plugin flag:

- **With `supportsPictureInPicture: true`** — the generated
  `android/app/src/main/AndroidManifest.xml` carries
  `android:supportsPictureInPicture="true"` on `.MainActivity`.
- **Without it** — the attribute is absent. Everything else on the line is
  unchanged.
- `android:configChanges` is
  `keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths`
  in **both** runs. `smallestScreenSize` is present, and it comes from the Expo
  template, not from this plugin — so no extra `configChanges` work is owed.
- The iOS `Info.plist` is **identical** across both runs (`expo config --type
introspect`, 1584 bytes either way, `UIBackgroundModes: ["audio"]`). The
  plugin adds the `audio` background mode when EITHER option is set, and
  `supportsBackgroundPlayback` already set it.

## Still unproven

> **Answered 2026-08-25 — the third bullet below.** The pause does arrive first,
> exactly as this file predicted. The consequence was not the frozen window
> predicted here: instead, pressing Home produced **no window at all**, because
> the ordinary background pause stopped the very video the window was about to
> carry. A second, unpredicted defect followed from the same ordering — the guard
> meant to remember "we left under picture-in-picture" was armed inside the
> AppState background branch, where on Android the latch is guaranteed clear, so
> it never armed; closing the window and reopening the app then resumed a video
> the viewer had dismissed.
>
> Confirmed on a Galaxy Tab S8 and a Galaxy S20 (Android 13); fixed in PR #2022,
> open at the time of writing. Full write-up:
> `docs/solutions/logic-errors/android-pip-appstate-latch-ordering-force-resume.md`.
>
> **The predicted remedy was close, but not what shipped.** This file predicted
> "a second store field for 'armed for automatic entry' threaded into
> `appStateBranchDecision`". What shipped is an adapter OPTION
> (`armsPictureInPicture`), not a store field, and it feeds a NEW sibling
> decision (`pipHoldTransitionDecision`) rather than being threaded into
> `appStateBranchDecision`. The arming moved to the latch's `started` edge —
> the moment the latch is guaranteed meaningful rather than guaranteed clear.
>
> Two bullets below remain genuinely open: iOS is still unverified on any
> target, and finding 2 (custom fullscreen keeps the window) has still not been
> re-run on hardware.
>
> One method note for whoever re-runs this: `mLastReportedPictureInPictureMode`
> (used in finding 1 above) held on both devices, but the `pip_input_consumer`
> window that appears on the Tab S8 does NOT appear on the S20 under Android 13.
> Treat its absence as telling you nothing.

- **Android hardware.** Everything above is one emulator, one device profile.
  Partly superseded — see the note above; finding 1 now has hardware evidence.
- **iOS.** Picture-in-picture has never been verified on this app on any iOS
  target, and it cannot be verified on an iPhone simulator. It needs an iPad
  simulator or hardware.
- **Whether the latch beats the AppState pause on Android.** Finding 6's pause
  is now exempted by the picture-in-picture latch, and the latch is fed from
  `onPictureInPictureModeChanged`. React Native reports AppState `background`
  from `Activity.onPause`, and Android's own guidance ("the system calls
  onPause(); your activity should not stop playback") implies the pause arrives
  FIRST — which would leave the latch unset at the moment the decision is read,
  and reproduce finding 6's frozen window. iOS is safe by construction: it
  reports `inactive` first, which decides nothing, and automatic entry has
  already fired by the time `background` arrives. **Android hardware must check
  whether the picture-in-picture window shows live frames or a frozen one.** If
  it freezes, the fix is a second store field for "armed for automatic entry"
  threaded into `appStateBranchDecision` beside the latch — never a widening of
  the pause exemption itself.
