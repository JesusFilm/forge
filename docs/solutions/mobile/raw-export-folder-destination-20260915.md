---
module: apps/mobile
tags:
  [
    raw-export,
    expo-file-system,
    folder-picker,
    destination-change,
    mocked-vs-real,
    ios,
    android,
  ]
problem_type: architecture-change
component: raw-file-export
---

# Raw file export saves to a folder the viewer picks, not to Photos

## The change

PR #2232 shipped raw file export into the device photo library. On 2026-09-15
product leadership decided the video must not land in Photos, and must instead
go where the viewer says. The destination moved to a folder chosen through the
platform's native folder picker.

The whole change sits behind one port. `rawExportAdapter.ts` had a
`library` port with five photo-library methods; it now has a `destination`
port with three:

```ts
export type ExportDestinationPort = {
  pickFolder: () => Promise<ExportFolder | null> // null = dismissed
  exists: (args: { folder: ExportFolder; fileName: string }) => Promise<boolean>
  copyInto: (args: {
    stagedPath: string
    folder: ExportFolder
    fileName: string
  }) => Promise<void>
}
```

`rawExportRuntime.ts` binds it to `Directory.pickDirectoryAsync`,
`File.exists` and `File.copy` from `expo-file-system` — a package the app
already linked. No new native module. `expo-media-library` left the app.

## Three facts that decided the design

Each was read from the installed native sources, not remembered.

**1. The folder picker has a completion signal; the share sheet does not.**
The obvious alternative was a share sheet with "Save to Files" inside it.
React Native's `Share.share` on iOS never settles when the viewer cancels
inside an activity (`RCTActionSheetManager.mm:293` — the completion handler
fires only on error, success, or a nil activity), and on Android it resolves
`sharedAction` right after `startActivity`, before the viewer acts, and cannot
carry a file at all (`ShareModule.kt:37-54`: `ACTION_SEND`, `text/plain`, no
`EXTRA_STREAM`). Either shape would wedge the export's one-at-a-time session
slot forever. A folder pick plus a programmatic copy keeps the signal exactly
as strong as the old library write: the copy's own promise.

**2. A picked folder is writable, and the grant lasts the process.**
`expo-modules-core` grants `[.read, .write]` to any `file://` path outside the
app container and defers to the OS
(`FileSystemUtilities.swift`, `getExternalPathPermissions`). The picker's
delegate calls `startAccessingSecurityScopedResource()` on the picked folder
and never calls the matching stop (`FilePickingUtils.swift:44-49`), so one pick
serves a whole series run. Android takes a persistable SAF grant
(`FilePickerContract.kt:48`) and the new `File`/`Directory` API is SAF-aware
through its unified file layer.

**3. The grant does NOT survive a process death on iOS.** `expo-file-system`
ships no bookmark API — `grep -rn bookmark` over its `ios/` tree returns
nothing. So the launch sweep cannot finish a copy the killed process never ran,
and it must not open a picker at launch. Every staged note is discarded. That
retired the `deferred` result, the app-state gate, `markTransferFinished`,
`deferStagingNote`, `completeStagedExport`, the sweep's `finish` action, and
the provider's foreground completion effect. Android's grant would survive, but
the recovery model is deliberately uniform.

## The step order moved the pick to the front

Before: permission → download → stage → library write → clean up.
After: **pick folder** → download → stage → **copy** → clean up.

The pick must run while the sheet is still on screen — a headless run has no
view controller to present from. Both routes call `adapter.pickExportFolder()`
and only then `router.back()`. Both orders compile and typecheck, so
`rawExportWiring.guard.test.js` pins the order inside each raw starter with a
brace-matched slice (an indent-keyed slice read the wrong span for the control
fixture — the control caught it). A dismissed picker starts nothing, reports
nothing, and leaves the sheet open; the series route restores its `ready`
phase.

## What the picker's cancel looks like

It **rejects**, on both platforms, with different classes:
`FilePickingCancelledException` (iOS) and `PickerCancelledException`
(Android). Their codes derive from the class names and therefore differ. The
binding catches every rejection, logs the code to
`raw_export.folder_not_picked`, and returns null. Matching a code string would
turn a version bump into a dismissal-becomes-failure regression; treating every
rejection as "no folder" is correct for the dominant case and leaves the rare
real error visible to operators.

## The confirm button reads "Open" — accepted

UIKit's folder picker labels its confirm button Open, and the title is not
configurable. The Save label exists only in export mode
(`UIDocumentPickerViewController(forExporting:asCopy:)`), which takes the
finished file, allows a rename, and copies it itself — and which no installed
package exposes. Building it means the first native module this app authors.
The product owner chose to ship the folder picker as-is on 2026-09-16; the
export-mode design, with its pros and cons, is recorded in
`docs/roadmap/platform/feat-509-mobile-export-save-sheet-native-module.md`.

Neither mode needs an Info.plist key or a runtime permission. The picker is
consent-per-action, and the app receives a security-scoped URL for exactly
what the viewer picked. The two keys that sound related —
`UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` — do the
opposite (they expose the app's own Documents folder to the Files app) and
stay unset.

## The Android SAF trap: a child is not a path segment

**Found by code review on 2026-09-16, after an iOS-only device pass called the
feature verified.** The first implementation named the saved file by joining it
onto the picked folder's uri:

```ts
await new File(stagedPath).copy(new File(new Directory(folder.uri), fileName))
```

That is correct on iOS and wrong on every Android device. Android's picker
returns a SAF **tree** uri. `expo-file-system` routes any tree uri through
`DocumentFile.fromTreeUri`, which reads only the tree's document id and returns
the ROOT document — the appended segment is discarded. So the destination
resolves to the folder itself, `FileSystemFile` throws
`InvalidTypeFileException` on a directory, and every Android export fails after
the whole video has already downloaded. The viewer reads "The video did not
save." and finds nothing.

The same mis-resolution silently broke the collision check: `exists` on the
joined uri answers for the FOLDER, not for a child.

**The fix is to let the source name the child.** Expo's SAF destination branch
resolves the child by the source's own file name
(`CopyMoveStrategy.SAF.prepareAsDestination` -> `findFile(source.fileName)` ->
create), and the local branch does the same. So the runtime binding renames the
staged file to its final name and copies it into the `Directory`:

```ts
const source = new File(stagedPath)
if (source.name !== fileName) source.rename(fileName)
await source.copy(new Directory(folder.uri))
```

`rename` reassigns the object's uri on both platforms (`uri = renamedUri(...)`
on Android, `url = updatedUrl` on iOS), so the copy uses the new path. One code
path now serves both platforms, with no `Platform.OS` branch.

**Why no test could have caught it, and what now does.** Every adapter test
injects a fake destination port, so the binding itself is unreachable from jest;
the wiring guard only matched `new File(stagedPath).copy(`, which the wrong
shape satisfied. iOS joins paths happily, so the device pass was green. The
guard now pins the rename and REJECTS the join shape, with a positive control
that carries the retired line. That is a text-layer guard and it is the weaker
half; the standing answer is the Android device row in `feat-508`.

**Two siblings the same review found on the same call.** `File.copy` is a plain
non-atomic byte copy on both platforms — unlike the transactional photo-library
API it replaced — so a failed copy leaves a truncated file under the final name
in the viewer's own folder, and `copyToFolder` now removes it best-effort in its
catch. And `signalBackgroundCompletion` used to fire BEFORE the copy, telling
iOS the background work was done and then copying ~165 MB inside a window the
app had just released; it now fires after.

## Collision policy

`File.copy` defaults to `overwrite: false` and throws on an existing name.
`suffixFileName` in `transferPort.ts` walks `Name.mp4`, `Name (2).mp4`,
`Name (3).mp4` … against `destination.exists`, bounded to 50 attempts and to
`RAW_EXPORT_MAX_FILENAME_LENGTH` (the stem gives up room for the suffix). The
viewer keeps both files.

## What the confirmation says

`exportFolderName(uri)` reads the last path segment, decodes it, and keeps
what follows the last colon — Android's SAF tree id is `primary:Download`. The
card reads "Saved to Download." or, when the name is unreadable, "Saved to
Files."

## Guards that changed

- `appJsonPhotoLibrary.guard.test.js` → `appJsonNoPhotoLibrary.guard.test.js`,
  the inverse: no photo plugin, no photo dependency, no media permission, no
  photo usage string, and neither `UIFileSharingEnabled` nor
  `LSSupportsOpeningDocumentsInPlace` (either would expose the staging root in
  the Files app and offer the app's own container as a destination that dies
  with the app).
- `mediaLibraryEntryPoint.guard.test.js` deleted with the package.
- `rawExportWiring.guard.test.js` repointed: no `PermissionsAsync` in the
  runtime, `Directory.pickDirectoryAsync(` present, copy-not-move into the
  folder, and the pick-before-dismiss order with a positive control.
- `exportErrorRedaction.guard.test.js` expects ONE raw sibling in
  `rawExport.ts` now, not two — the permission catch was the second.

## The verification oracle changed

The #2232 device pass counted `PHPhotoLibrary … success: YES` lines in the
simulator log. That signal no longer exists. The replacement: after a save,
list the picked folder through the same `Directory` handle the app holds and
assert the file is present at the byte size the sheet showed; then open the
Files app by hand and confirm. The aggregate series control is still NOT an
oracle — it returns to "Download all" whatever happened.

## Device pass — iPhone 17 Pro Max simulator, iOS 26.5, 2026-09-15

Local admin on `localhost:3003`, dev client built before this change (a
removed native module leaves the old binary a superset, so the JS runs on it).
Every row below was observed, not inferred; the disk oracle is the primary
proof and the screenshot the secondary.

| #   | Step                                                                      | Observed                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open the video sheet.                                                     | Mode control reads **Offline Watching / Save to Files**. Selecting Save to Files hides the subtitle picker, shows the Terms gate, and the button reads "Save to device".                                                                                                                                                                                              |
| 2   | Confirm.                                                                  | Apple's `UIDocumentPickerViewController` presents in folder mode (Recent / Shared / Browse, an **Open** button) WHILE the sheet is still up behind it.                                                                                                                                                                                                                |
| 3   | Dismiss the picker (✕).                                                   | Picker closes; the download sheet is still open with Save to Files and Terms both still set. `Documents/raw-exports` has 0 entries. Nothing started, nothing reported.                                                                                                                                                                                                |
| 4   | Confirm again, Browse → On My iPhone → Open.                              | Sheet dismisses, the download glyph turns into the progress ring, the run proceeds headless. The app's own container is NOT offered under On My iPhone (no `UIFileSharingEnabled`).                                                                                                                                                                                   |
| 5   | Wait for the save (`the-birth-of-jesus`, Highest, 158.0 MB on the sheet). | `File Provider Storage/The_Birth_of_Jesus.mp4`, **165,681,585 B = 158.0 MiB**; `ftypisom`; ffprobe duration 273.43 s = the 4:33 the sheet showed. `raw-exports` back to 0 entries.                                                                                                                                                                                    |
| 6   | Read the card.                                                            | **Defect found:** "Saved to File Provider Storage." — iOS's on-disk name for the On My iPhone root leaked through `exportFolderName`. Fixed the same session: that segment now maps to null and the card reads "Saved to Files." Pinned in `rawExport.test.ts`, falsified once.                                                                                       |
| 7   | Export the same video into the same folder.                               | `The_Birth_of_Jesus (2).mp4`, same byte size; the original untouched. The picker's own Browse view then lists both, so the Files app confirms the suffix by hand.                                                                                                                                                                                                     |
| 8   | Series `washi-gospel`, 5 episodes, all already offline → Save to Files.   | Sheet reads "5 of 5 episodes reuse an offline copy at this quality." **ONE** picker for the run. Five files land within 2 s (reuse path, no network): `Can_God_be_Known_`, `What_are_Humans_`, `What_is_sin_`, `What_is_the_Cross_of_Jesus_`, `What_is_salvation_`. Stage empty.                                                                                      |
| 9   | Downloaded episode (`what-is-sin`) → manage menu → Save to Files.         | Card reads **"Saved to Files."** — the row-6 fix live after a cold relaunch.                                                                                                                                                                                                                                                                                          |
| 10  | Kill the app mid-download (`the-annunciation`), relaunch.                 | Before the kill: a v2 note on disk (new shape, no `albumIntent` / `transferFinished`) and an empty `raw-exports/the-annunciation/` dir (the engine holds the bytes elsewhere until done). After relaunch: note `None`, dir gone, and the card **"The export did not finish. / Start it again to keep a copy."** at launch (burst-captured; it auto-dismisses at 6 s). |

Not run here: iCloud Drive as the destination (the simulator is not signed
in), and every Android row. The simulator has no cellular radio, so the
wifi-only rows still cannot be answered on it.

Two environment facts that cost time and are worth knowing: the low-memory
reaper killed Metro while three simulators were booted (shut the spares down
first), and a Metro restart under a running app takes a Fast Refresh that
re-evaluates the `env` proxy and red-boxes "Attempted to access a server-side
environment variable on the client" — cold-relaunch the dev client after every
Metro restart, per the standing rule.

## Ship note

Removing a native module moves the fingerprint runtime version. A native
build must ship before the next `eas update`, or the channel goes dark
(see `apps/mobile/CLAUDE.md`, "Publishing an EAS Update").

## Related

- `docs/plans/2026-09-09-1301-feat-mobile-raw-file-export-plan.md` — the
  photo-library design, with a supersession note.
- `docs/solutions/mobile/raw-export-device-pass-2026-09.md` — the old pass,
  with the rows that must be re-taken.
- `docs/solutions/logic-errors/series-export-cancel-scoped-to-episode-not-run.md`
  — the run latch survives; its Known Limit does not.
- `docs/roadmap/platform/feat-508-mobile-export-to-files-folder.md`
