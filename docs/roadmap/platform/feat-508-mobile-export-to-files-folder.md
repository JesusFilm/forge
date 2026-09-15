---
id: "feat-508"
title: "Mobile raw export saves to a viewer-picked folder, not Photos"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-09-15"
duration: 2
depends_on: []
blocks:
  - "feat-509"
tags:
  - "mobile"
  - "platform"
---

## Problem

PR #2232 shipped raw file export with the device photo library as its
destination. Product leadership decided on 2026-09-15 that exported videos
must not land in Photos. The viewer must instead choose where the file goes,
through the platform's native folder picker.

The photo-library design carried machinery that only that destination needed:
a runtime permission with a refusal outcome and a Settings action, an
add-only scope and a named album, a deferred write gated on the app being
active, and a foreground effect plus a launch sweep that finished a write a
killed process never ran. A folder grant needs none of it and cannot support
the last part at all, because the grant dies with the process.

## Entry Points — Read These First

1. `apps/mobile/src/lib/rawExportRuntime.ts` — the ONE composition root. The
   `destination` port binds to `Directory.pickDirectoryAsync`, `File.exists`
   and `File.copy` from `expo-file-system`. No other module touches native.
2. `apps/mobile/src/lib/rawExportAdapter.ts` — `ExportDestinationPort`,
   `copyToFolder`, `freeFileName`, `pickExportFolder`. `completeStagedExport`
   is gone.
3. `apps/mobile/src/lib/rawExport.ts` — `ExportFolder`, `exportFolderName`.
   The permission section is gone; `admit` goes storage gate to admitted.
4. `apps/mobile/app/watch/download.tsx` and `apps/mobile/app/series/download.tsx`
   — the pick runs BEFORE `router.back()`. The series route picks once and
   threads `folder` into `buildSeriesExportRun`.
5. `apps/mobile/src/lib/exportSweep.ts` — every note is a `discard`.
6. `apps/mobile/src/lib/__tests__/rawExportWiring.guard.test.js` — pins the
   pick-before-dismiss order inside each raw starter.
7. `apps/mobile/src/lib/__tests__/appJsonNoPhotoLibrary.guard.test.js` — pins
   the absence of every photo permission and of `UIFileSharingEnabled`.
8. `apps/mobile/CLAUDE.md` § "Raw file export — save to a folder the viewer
   picks" — the standing rules.

## Grep These

- `pickExportFolder` — the two call sites and the adapter method
- `ExportDestinationPort` — the port and its one binding
- `destinationWriteError` — the copy's failure cause in telemetry
- `raw_export.folder_not_picked` — the dismissed-picker telemetry
- `suffixFileName` — the collision policy
- `exportFolderName` — the confirmation's folder name
- `expo-media-library` — must return NOTHING under `apps/mobile`

## What To Build

Done in the working branch `feat/mobile-export-to-files`:

```ts
// rawExportAdapter.ts
export type ExportDestinationPort = {
  pickFolder: () => Promise<ExportFolder | null> // null = dismissed
  /** One call: Android resolves no per-name probe against a SAF tree. */
  listNames: (folder: ExportFolder) => Promise<readonly string[]>
  copyInto: (args: {
    stagedPath: string
    folder: ExportFolder
    fileName: string
  }) => Promise<void>
  /** A non-atomic copy can leave a partial file under the final name. */
  removeIfExists: (args: {
    folder: ExportFolder
    fileName: string
  }) => Promise<void>
}
```

The binding names the saved file by RENAMING the staged source and copying it
into the `Directory`. Appending a name to an Android SAF tree uri resolves back
to the folder, so the join shape fails every Android export. See the solution
doc's "Android SAF trap" section.

Step order per export: pick folder (UI) → storage gate → download → stage →
copy into folder → delete stage → report. A series picks once and runs the
episodes one at a time against that folder.

Removed: `expo-media-library` (package, plugin, permissions, usage strings),
`RAW_EXPORT_ALBUM_NAME`, `ExportAlbumIntent`, the `refused` outcome, every
permission type, `permissionError`, the note's `albumIntent` and
`transferFinished`, `markTransferFinished`, `deferStagingNote`, the `deferred`
result, `completeStagedExport`, the sweep's `finish` and `dropNote` actions,
the provider's foreground completion effect, the report card's Settings
action, and every "Photos" / "photo library" string.

## Known limitation — the confirm button reads "Open"

UIKit's folder picker labels its confirm button **Open**, and the title is
not configurable. "Save" exists only in export mode, which no installed
package exposes and which would need a native module the app does not have
today. Decided 2026-09-16: ship the folder picker with the Open label. The
Save sheet is `feat-509`, with the analysis recorded there.

## Constraints

- Do not add `expo-sharing` or any share-sheet path. RN's share sheet has no
  usable completion signal on either platform (verified 2026-09-15 against
  `RCTActionSheetManager.mm` and `ShareModule.kt`), and it would wedge the
  one-at-a-time session slot.
- Do not resume a staged export after a process death. The iOS grant is
  process-scoped and `expo-file-system` exposes no bookmark. Keep discard
  uniform across platforms.
- Do not add `UIFileSharingEnabled` or `LSSupportsOpeningDocumentsInPlace`.
- Do not match the picker's cancel error code. Log it and treat every
  rejection as "no folder".
- Copy, never move, into the folder — R38 protects the offline copy.

## Verification

```bash
cd apps/mobile
pnpm test                      # 227 suites green
npx tsc --noEmit
npx eslint src app
grep -rn "expo-media-library" . --include="*.json" --include="*.ts" --include="*.tsx" | grep -v node_modules   # nothing
```

Device pass, both platforms, recorded against the NEW oracle (list the picked
folder through the `Directory` handle and assert the byte size; confirm in
the Files app by hand). **iOS simulator rows 1–5 DONE 2026-09-15** — see the
"Device pass" table in
`docs/solutions/mobile/raw-export-folder-destination-20260915.md`.

1. ✅ Single video → pick a folder → file lands at the sheet's byte size.
2. ✅ Same video again into the same folder → `Name (2).mp4`, both files remain.
3. ✅ Dismiss the picker → nothing starts, no report, sheet stays open.
4. ✅ Series of 5 → ONE picker → 5 files in that folder.
5. ✅ Kill mid-download → relaunch → staged file gone, "did not finish" card.
6. ⬜ iCloud Drive as the folder (iOS) → copy lands. Needs a signed-in device.
7. ⬜ **Android: every row above, on a real device or emulator. This is the
   gating row.** A code review on 2026-09-16 found that the first
   implementation failed every Android export, and neither jest nor the iOS
   pass could see it. Re-run rows 1-5 on Android before calling this done.
8. ⬜ iOS hardware: rows 1 and 5.
9. ⬜ Fresh `npx expo prebuild --platform android --clean`, then grep the
   generated `AndroidManifest.xml` to confirm `READ_EXTERNAL_STORAGE` carries
   `tools:node="remove"`.
10. ⬜ Induce a copy failure (fill the destination, or pull the folder's
    provider) and confirm no truncated file is left under the final name.

Ship: a NATIVE build before the next `eas update` — removing a native module
moved the fingerprint runtime version.

## Review round (2026-09-16)

A Tier-2 `/ce-code-review` on the finished branch returned 11 findings: 4 P1, 5
P2, 2 P3. An independent validation gate confirmed all 8 it examined. Every one
is fixed on this branch. The two that mattered most:

- **Every Android export failed** (#4). The binding named the saved file by
  joining it onto the picked folder's uri, which an Android SAF tree resolves
  back to the folder. Fixed by renaming the staged source and copying it into
  the `Directory`. See the solution doc's "Android SAF trap".
- **`READ_EXTERNAL_STORAGE` came back** (#7). Deleting the whole
  `blockedPermissions` array removed the only thing stripping a permission that
  Expo's own base template, `expo-file-system` and `expo-image` all declare.
  The array is restored, now also blocking `WRITE_EXTERNAL_STORAGE`, which a
  SAF grant does not need.

Two guards written for this change could not fail as written, and both are
fixed: one read an `app.json` key that has never existed, and one compared
object-literal property order and called it call order.

**Nothing here was visible to the 227-suite run, to `tsc`, or to the iOS device
pass.** That is the standing reason row 7 below is the gating row.

## Open

- The Terms of Use PERSONAL USE clause blocker from the #2232 plan is
  unchanged by this work.
- Android device pass has never been run for raw export in either design.
