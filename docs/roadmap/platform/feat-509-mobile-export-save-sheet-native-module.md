---
id: "feat-509"
title: "Mobile raw export: iOS Save sheet via an export-mode native module"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-01"
duration: 3
depends_on:
  - "feat-508"
blocks: []
tags:
  - "mobile"
  - "platform"
---

## Problem

feat-508 saves the exported video into a folder the viewer picks with
`Directory.pickDirectoryAsync()`. That is UIKit's folder picker, and iOS
labels its confirm button **Open**, not Save. The label cannot be changed.
The viewer also cannot rename the file from that sheet.

iOS shows **Save** only in export mode —
`UIDocumentPickerViewController(forExporting:asCopy:)` — which takes the
finished file, lets the viewer choose the folder AND rename the file, and
performs the copy itself. No installed package exposes export mode
(verified 2026-09-15: zero `forExporting` hits across every Expo package on
disk), so it needs a local native module. It would be the first native module
this app authors; today the app carries only config-plugin snippets and pnpm
patches.

Decided 2026-09-16: the folder picker ships as-is. This ticket holds the
analysis so the Save sheet can be built later without re-deriving it.

## Entry Points — Read These First

1. `apps/mobile/src/lib/rawExportAdapter.ts` — `ExportDestinationPort`. Export
   mode replaces `pickFolder` + `copyInto` with one `saveAs(urls)` call whose
   result IS the destination.
2. `apps/mobile/src/lib/rawExportStart.ts` — the pick-then-dismiss-then-start
   sequence. Export mode inverts it: download first, then present.
3. `apps/mobile/src/lib/exportSweep.ts` and `exportSession.ts` — the staging
   note needs `transferFinished` back, and the sweep needs an "offer" action
   that re-presents the Save sheet for a finished download.
4. `apps/mobile/src/components/ExportReportHost.tsx` — the card needs an action
   slot again ("Your video is ready to save" → Save).
5. `apps/mobile/plugins/withCastUIStyle.js` — the closest precedent for
   native code this app owns; read it for the defensive-load pattern.
6. `docs/solutions/mobile/raw-export-folder-destination-20260915.md` — why
   the share sheet was rejected (no completion signal) and what the folder
   picker verified.

## Grep These

- `pickExportFolder` — every call site the Save sheet replaces
- `startRawExportAfterPick` — the order that inverts
- `discardStagedExport` — becomes "offer" for a finished stage
- `forExporting` — must appear in the new module and nowhere else

## What To Build

A local Expo module at `apps/mobile/modules/file-export/`:

```ts
// index.ts
export type SaveAsResult =
  | { kind: "saved"; destinations: string[] }
  | { kind: "cancelled" }
export function saveAsAsync(fileUris: string[]): Promise<SaveAsResult>
```

- iOS (`ios/FileExportModule.swift`, ~60 lines): present
  `UIDocumentPickerViewController(forExporting: urls, asCopy: false)` from
  `appContext.utilities?.currentViewController()`. The delegate resolves
  `saved` with the destination URLs on `didPickDocumentsAt`, and
  `cancelled` on `documentPickerWasCancelled`. Presentation only; no
  business logic.
- Android (`android/.../FileExportModule.kt`, ~60 lines): one file →
  `ACTION_CREATE_DOCUMENT` with the filename and `video/mp4`, then stream
  the bytes into the returned URI through `ContentResolver`. Many files →
  keep `Directory.pickDirectoryAsync()` (Android has no multi-file create
  intent; its button reads "Use this folder").

Flow: Confirm → dismiss → download (headless) → **Save sheet** → done.
A series stages every episode, then presents ONE Save sheet listing them
all. Peak disk becomes the sum of the episodes; the R8 gate already charges
the sum, so no gate change.

Recovery improves: a finished stage is the app's own file, so a process
death no longer discards it. The relaunch shows a card with a Save action
that presents the sheet. A download that finishes while backgrounded waits
for the foreground to present.

## Constraints

- Keep the module presentation-only. The adapter stays pure and tested.
- File the upstream request against `expo-file-system` (`File.exportAsync`
  or similar) in the same PR, so the module has a planned end.
- No Info.plist key and no runtime permission: export mode, like folder
  mode, is consent-per-action. Do not add `UIFileSharingEnabled` or
  `LSSupportsOpeningDocumentsInPlace`.
- A native module change cannot ship over the air. Every fix is a build.

## Verification

- Device pass rows from feat-508, re-run, plus: rename in the sheet lands
  under the new name; cancel in the sheet keeps the staged file and shows the
  "ready to save" card; kill after the download and before Save → relaunch →
  the card offers Save and the copy lands.
- Falsify the module's cancel path once by hand (there is no jest for it).

## Pros and cons recorded 2026-09-16

Pros: the only route to "Save"; small and presentation-only; a definite
completion signal on both paths; rename; one sheet per series; a crash no
longer wastes a finished download; no third-party dependency to track.

Cons: the first native code this app owns (Swift + Kotlin, two toolchains,
Expo Modules API drift on SDK upgrades); no unit test can see it; every fix
is a store build, not an OTA; the download-then-present order brings back
the foreground gate and a staged file that outlives the run; iOS and
Android diverge for a series; the series holds every episode on disk until
Save.
