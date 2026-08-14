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

- Finding 6 became R13 and the `pipPolicy` / `pipLatch` pair. The latch is fed
  from the VIEW's `onPictureInPictureStart` / `onPictureInPictureStop`, exactly
  as the spike recommended, so the pause is skipped only while the operating
  system's window is actually showing.
- Finding 4 became R14. The trailer surfaces were KEPT deliberately: the shared
  watch component backs both the watch screen and the series-detail trailer, so
  one prop covers that pair, and the two SDUI `[sectionKey]` screens carry the
  same wiring. All four spread one helper —
  `apps/mobile/src/lib/miniPlayer/pictureInPicture.ts`.
- Finding 3 still holds by construction. Home's hero views never reach the
  player adapter and carry no picture-in-picture prop.
- Finding 1 and 2 are the reason KD4 chose SDK 57. Neither has been re-run on
  hardware; the emulator remains the only Android evidence.

## Still unproven

- **Android hardware.** Everything above is one emulator, one device profile.
- **iOS.** Picture-in-picture has never been verified on this app on any iOS
  target, and it cannot be verified on an iPhone simulator. It needs an iPad
  simulator or hardware.
