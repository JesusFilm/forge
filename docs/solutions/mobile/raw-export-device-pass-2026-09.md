---
module: apps/mobile
tags: [raw-export, media-library, device-verification, ios, android]
problem_type: verification-gate
component: raw-file-export
---

# Raw file export — device verification pass

**Status: PARTIAL — iOS simulator only, 2026-09-10. Android NOT RUN. Hardware
NOT RUN.**

A simulator is not a device. What it did establish is the part that no test
could: the photo-library write path actually works, and it is the exact call
that would have thrown before the `/legacy` import fix. What it cannot
establish is anything about real storage pressure, real network transitions,
cellular, or Android. Treat the filled rows as a floor, not as the gate.

Every unfilled row below is empty on purpose. U8 of
`docs/plans/2026-09-09-1301-feat-mobile-raw-file-export-plan.md` is a manual
gate, and its output IS the recorded observation. A green unit suite does not
satisfy it: a photo-library write is boundary code, so the mocked tests prove
branch shape only.

Record **what you observed**, on **which device** and **which OS version**.
Do not record "pass". Android is recorded independently of iOS — never inherit
an iOS result.

## Before you start

1. Build the `preview` profile for internal distribution. **Register the iOS
   test device BEFORE the build**, not after.
2. A development build defaults to LOCAL admin and refuses production admin at
   module scope. If you use one, edit the LAN admin URL into
   `apps/mobile/.env.development.local` — the shell environment is ignored —
   then restart Metro with a cleared cache.
3. This feature needs a NATIVE build. `apps/mobile/app.json` uses the
   fingerprint runtime-version policy, and U1 changed both `package.json` and
   `app.json`, so an over-the-air update cannot deliver it.

## Two things to know before you judge a result

**iOS has no album, and that is correct.** An add-only permission grant cannot
create one: `createAlbumAsync` and `getAlbumAsync` both run behind
expo-media-library's FULL read-write requester and additionally require
`accessPrivileges === "all"`. So on iOS the video saves to the library and the
confirmation names the library. R17's fallback is the normal iOS case, not a
defect. Android gets a real album, `Jesus Film Watch`.

**Android 12 and below.** `WRITE_EXTERNAL_STORAGE` is declared with
`maxSdkVersion="32"` and is required on API <= 32. If an export fails on an
older Android device, check whether the permission was granted before treating
it as a code defect.

## Observations

Fill in device, OS version and what you saw. One row per platform per step.

iOS column below: **iPhone 17 Pro Max simulator, iOS 26.4**, development build
from this branch, Metro from this worktree, local admin on `:3003`.

| #   | Step                                                                        | iOS — device / OS / observed                                                                                                                                                                                                                                                                                                              | Android — device / OS / API / observed |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Export one video. Does it reach the library (Android: the named album)?     | YES. `the-birth-of-jesus`, Low. Banner: "The Birth of Jesus / Saved to your photo library." Landed as `DCIM/100APPLE/IMG_0011.MP4`, 7,354,156 B — the 7.0 MB the sheet predicted. Names the LIBRARY, not an album, which is R17's correct iOS case.                                                                                       |                                        |
| 2   | Does the saved video PLAY from the device gallery?                          | Present in the Photos app at 4:33. Decodes: `ffprobe` reads h264 426x240 + aac, duration 273.439 s. Frame at t=60 s is the nativity scene, so it is the right content, not just the right length. NOT played through the Photos UI end to end.                                                                                            |                                        |
| 3   | Staged file gone from app storage afterwards?                               | YES. `Documents/raw-exports` exists and is EMPTY (0 entries) after the save. Still empty after a refusal, so a denied export leaves nothing behind either.                                                                                                                                                                                |                                        |
| 4   | Delete the app's own storage. Does the library copy survive?                | Covered by row 17 below — the whole app was removed, not only its storage.                                                                                                                                                                                                                                                                |                                        |
| 5   | Download offline, then export THAT SAME quality. Any network transfer?      | NOT RUN.                                                                                                                                                                                                                                                                                                                                  |                                        |
| 6   | After that reuse, does the offline copy still play?                         | NOT RUN.                                                                                                                                                                                                                                                                                                                                  |                                        |
| 7   | Export a rendition ABOVE 2 GB. Name it, and record the observed byte size.  | NOT RUN. The largest rendition offered on these segments is 158.0 MB, so this needs a feature-length title.                                                                                                                                                                                                                               |                                        |
| 8   | Background the app mid-transfer, return. Does the save complete and report? | NOT RUN.                                                                                                                                                                                                                                                                                                                                  |                                        |
| 9   | Kill the app DURING staging, relaunch. Swept? Told it did not finish?       | NOT RUN.                                                                                                                                                                                                                                                                                                                                  |                                        |
| 10  | Kill AFTER staging completes, relaunch. Does the save FINISH instead?       | NOT RUN.                                                                                                                                                                                                                                                                                                                                  |                                        |
| 11  | Export a multi-episode series. Do episodes save in episode order?           | NOT RUN.                                                                                                                                                                                                                                                                                                                                  |                                        |
| 12  | Cancel part-way from the running-export control. Do saved episodes remain?  | NOT RUN.                                                                                                                                                                                                                                                                                                                                  |                                        |
| 13  | Toggle wifi-only mid-export. Record EXACTLY what the viewer is told.        | NOT RUN. A simulator has no cellular radio, so this one cannot be answered here at all.                                                                                                                                                                                                                                                   |                                        |
| 14  | Refuse the permission at the first prompt. What is reported?                | The prompt reads "'forge-watch' would like to **add to** your Photos" — the add-only alert, carrying the `savePhotosPermission` string. On "Don't Allow": no crash, `raw_export.refused` logged, banner "Photo library access is off for this app. / Turn on photo access in Settings, then try again." with an **Open settings** action. |                                        |
| 15  | Refuse permanently. Is it reported differently, with a settings route?      | Second attempt shows NO prompt (iOS never re-asks) and reports the SAME copy and the SAME Settings route, with a padlock icon. So the two cases are not distinguished by wording. See Finding B.                                                                                                                                          |                                        |
| 16  | Export twice to the album. Does the SECOND export still name the album?     | Second export (`the-annunciation`, Low) saved as `IMG_0012.MP4`, 5,953,734 B, duration 222.090 s = the 3:42 the sheet showed. Both files coexist. On iOS both name the library, so the album-naming question this row exists for is Android-only.                                                                                         |                                        |
| 17  | LAST — delete the app. Do the exported files and the album survive?         | YES. `simctl uninstall` removed the app; both `IMG_0011.MP4` and `IMG_0012.MP4` remained in the camera roll at their original byte sizes.                                                                                                                                                                                                 |                                        |

Reset permissions between steps 14 and 15: on iOS reinstall, or reset Location
and Privacy; on Android reset the app's permissions or clear its data.

Step 16 is not in the plan. It is here because the app cannot read albums under
an add-only grant, so the adapter calls `createAlbumAsync` on every export and
treats a throw as R17's fallback. If Android throws when the album already
exists, every export after the first reports the library rather than the album.
The video still saves and the export never fails, so this is a copy question,
not a correctness one — but it needs an answer.

## Android API levels

The plan requires at least two. Record each separately; do not merge them.

| API level | Device | Result summary |
| --------- | ------ | -------------- |
|           |        |                |
|           |        |                |

## Disable switch

The Definition of Done requires exercising this once on a preview build before
any production build is submitted.

Set `RAW_EXPORT_ENABLED` to `false` in
`apps/mobile/src/lib/rawExportConstants.ts`, rebuild, and confirm:

| Check                                            | Observed |
| ------------------------------------------------ | -------- |
| No mode control renders on either download sheet |          |
| No new export can start                          |          |
| The launch sweep STILL runs                      |          |
| A completed stage is DISCARDED rather than saved |          |

## Page-load performance evidence

The repo requires this whenever client-side initialization changes, and this
change mounts `<ExportReportHost />` at the app root and adds a launch sweep —
both on the startup path for every screen. See
`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
Lighthouse does not apply here; the mobile loops are the bundle gate and the
Datadog scorecard (`project_mobile_perf_measurement`).

**Bundle size.** `expo export --platform ios` on this branch produces a
**6.5 MB** Hermes bundle (`entry-08d208042783aca35592429d29cb0214.hbc`, 8.3 MB
total export). The feature contributes 11 new shipped modules totalling
**91.5 KB of TypeScript source**, plus **39.0 KB** of `expo-media-library`
build JS. Both are pre-compilation upper bounds — types erase and comments
strip — so the real Hermes contribution is smaller than the ~2% those numbers
suggest against a 6.5 MB bundle.

**Delta against main: NOT MEASURED.** A like-for-like baseline needs a bundle
built from the merge base, and the feature adds a native dependency, so the
baseline needs its own install. This session is worktree-isolated and will not
build in another checkout to get it. The absolute figure above is the datum.

**Startup cost: reasoned from the code, not timed.** Three properties keep the
root mount off the critical path, and all three are worth re-checking if this
code moves:

- `ExportReportHost` returns `null` while `reports.length === 0`
  (`ExportReportHost.tsx:138`). A launch with nothing to report renders no view.
- The sweep runs in a `useEffect` gated on `isReady`, dispatched as
  `void (async () => …)()`, and shares one `Promise.allSettled` with the
  `reattachSurvivors` pass that already existed. It never blocks a render.
- `if (sweep.length === 0) return` fires BEFORE any adapter is built
  (`DownloadsProvider.tsx:596`), so a launch that has never exported touches no
  photo-library binding at all.

**Cold-launch timing: NOT MEASURED, deliberately.** A dev-client cold launch on
this app has a ±6 s noise floor, which is larger than any effect this change
could have. A number from it would be noise wearing a decimal point. The real
measurement is a release build reporting Datadog `js_tti`, and that needs a
production build this session has not made. Recorded as unmeasured rather than
dressed up.

## Findings from the 2026-09-10 simulator run

Neither blocks the feature. Both are real and both were invisible to the suite.

### Finding A — the watch route's collapse button draws OVER the report banner

`<ExportReportHost />` is mounted at the root, but on `/watch/[slug]` the
red collapse-player chevron renders ABOVE it. The topmost banner's status icon
sits directly under that button and is unreadable: the icon is blurred by the
banner's own material while the chevron stays crisp on top. Cropping the two
stacked banners shows it plainly — the lower banner's padlock is sharp and
legible, the upper one's is a smear behind a red chevron.

Visual only. The dismiss control is on the opposite side, so nothing is
mis-tappable. Fix is a z-order or a top-inset on the banner stack.

### Finding B — repeated failures stack identical banners that never expire

`foldSignal` keys records by `runId`, and every export attempt is a new run, so
two refusals on the same video produce two records. A refusal with
`canAskAgain === false` sets `expiresAt: null`, which is deliberate — the
viewer has to go to Settings, so the banner must not vanish. The consequence is
that tapping "Save to device" repeatedly stacks up to `MAX_VISIBLE_REPORTS` (3)
banners with identical text, none of which auto-dismiss.

Measured: two banners present at T0, still both present at T+12 s (the
auto-dismiss budget is 6 s).

Related, from row 15: the askable and permanent refusals share the same
headline and the same detail line. The design intends them to differ — there
are two distinct branches in `singleView` — but on iOS the first denial already
sets `canAskAgain: false`, so the askable branch appears to be unreachable
there. Worth confirming on Android, where the first denial IS re-askable.

## Outcome

**Not complete.** The iOS write path is proven end to end and the two failure
paths behave. Everything about interruption, reuse, series, size limits,
network transitions, Android, and real hardware is still open.

Before this gate can be called met: the unfilled rows, both Android API levels,
and the disable-switch table.
