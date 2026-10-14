---
title: "expo-file-system File.copy() returns a Promise: await it, copy to a part file, and test the real port against the jest-expo in-memory double"
date: "2026-10-14"
category: integration-issues
module: apps/mobile
problem_type: integration_issue
component: tooling
symptoms:
  - "A copy that is not awaited leaves the next line to read a file that may not exist yet"
  - "A failed copy becomes an unhandled rejection, and the jest worker crashes"
  - "A copy cut short leaves a truncated file under the final name, and a later pass trusts it"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
framework_version: "expo-file-system 57.0.7 (copy and move are async since 56.0.0)"
tags:
  - expo-file-system
  - file-copy
  - async
  - atomic-rename
  - app-group
  - widget
  - jest-double
  - daily-bible-pause
---

# expo-file-system File.copy() returns a Promise: await it, copy to a part file, and test the real port against the jest-expo in-memory double

## Problem

Since expo-file-system 56.0.0, `File.copy()` and `File.move()` return a Promise. Older code and examples call them as if they were synchronous. The Daily Bible Pause widget copies a bundled JPEG into the App Group folder. The first draft of that copy did not wait for it.

## Symptoms

- A copy that is not awaited names a file that may not exist yet. The next line, and the widget, can read nothing (auto memory [claude]).
- A failed copy becomes an unhandled rejection, and it crashed the jest worker (auto memory [claude]).
- A copy is a plain byte copy, so a pass cut short leaves a truncated file under the final name. A later pass that trusts the name serves that file. A code review flagged this risk on 2026-10-13.

## What Didn't Work

- **Calling `copy()` as if it were synchronous.** The type changed in 56.0.0, and a call with no `await` still compiles. Only the failure path showed the problem, as an unhandled rejection in jest (auto memory [claude]).
- **Resetting the jest double through its helper.** The double has `__resetMockFileSystem()` (`apps/mobile/node_modules/expo-file-system/mocks/FileSystem.ts:68`), but the public `expo-file-system` exports do not include it.
- **Setting the App Group folder on the double's record.** Writing the double's `appleSharedContainers` record did not take effect in this test setup: `Paths.appleSharedContainers` still returned no group (auto memory [claude]). A spy on the getter worked.

## Solution

The fix is in `apps/mobile/src/lib/dailyPause/widgetArt.ts`, on the branch `Ur-imazing/pause-devo-feature-polish` (PR #2717 into `Ur-imazing/pause-devo-feature`, open at the time of writing). The copy goes to a part file, waits for the copy, and then renames the part file in the same folder:

```ts
// widgetArt.ts:111-118
// A copy is not atomic, and a later pass trusts the final name. So
// the copy goes to a part file, and a rename in one folder is atomic.
copyIn: async (from, name) => {
  const part = new File(dir, `${name}.part`)
  if (part.exists) part.delete()
  await new File(from).copy(part)
  part.rename(name)
},
```

A stale part file from a killed pass is deleted first, and it never gets the final name. A pass that cannot stage the art keeps an earlier pass's copy (`widgetArt.ts:67-73`).

The tests run the real port against the jest-expo in-memory double, with no `jest.mock("expo-file-system")`:

```ts
// widgetArt.test.ts:188-197
beforeEach(() => {
  // The double's store outlives a test, so each test starts a new group.
  const group = new Directory(GROUP_URI)
  if (group.exists) group.delete()
  group.create({ intermediates: true })
  groups = { [WIDGET_ART_APP_GROUP]: group }
  jest
    .spyOn(Paths, "appleSharedContainers", "get")
    .mockImplementation(() => groups)
  // ...
})
```

The test "leaves no file under the final name when the copy fails" (`widgetArt.test.ts:236`) makes `copy()` write 10 bytes and then throw. It checks that no file appears under the final name.

## Why This Works

The installed types declare `copy(): Promise<void>`, `copySync(): void` and `rename(): void` for `File` (`apps/mobile/node_modules/expo-file-system/build/internal/NativeFileSystem.types.d.ts:182`, `:186`, `:198`). The CHANGELOG lists the change under 56.0.0 as a breaking change (`apps/mobile/node_modules/expo-file-system/CHANGELOG.md:112`). An `await` makes the rename run only after the bytes are written, and it routes a failure to the caller's `catch`.

`rename()` moves the part file to a name that does not exist yet. It does not replace a file: it throws if the name is taken. So the code copies only when the final name is absent (`apps/mobile/src/lib/dailyPause/widgetArt.ts:57`).

On iOS the move is one `FileManager.moveItem` call in the same folder (`apps/mobile/node_modules/expo-file-system/ios/FileSystemPath.swift:98-101`). So the final name points at a whole file or at nothing. This code runs only on iOS: Android has no App Group, so the port finds no folder. On Android below API 26, `rename()` copies and then deletes (`apps/mobile/node_modules/expo-file-system/android/src/main/java/expo/modules/filesystem/FileSystemPath.kt:201-206`). That is not one step, and React Native 0.86 supports API 24 and later (`apps/mobile/node_modules/react-native/gradle/libs.versions.toml:3`).

jest-expo feeds `apps/mobile/node_modules/expo-file-system/mocks/FileSystem.ts` to `requireNativeModule('FileSystem')`, as the header of that file states. So the real `File`, `Directory` and `Paths` classes run against an in-memory store. The test then exercises the same code as the app.

## Prevention

- **Await every `copy()` and `move()`, or use `copySync()` and `moveSync()` on purpose.** A call with no `await` compiles, so search for them: `grep -rn "\.copy(\|\.move(" apps/mobile/src`. On 2026-10-14 the search found three calls outside `__tests__`, and all three wait: `apps/mobile/src/lib/rawExportRuntime.ts:114`, `apps/mobile/src/lib/dailyPause/shareVideo.ts:27` and `apps/mobile/src/lib/dailyPause/widgetArt.ts:116`.
- **Write a file that a later pass trusts by name in two steps.** Copy to `<name>.part`, then `rename()` in the same folder. Delete a stale part file first. Copy only when the final name is absent, because `rename()` throws if the name is taken.
- **Test the real port, not a hand mock.** The in-memory double makes the copy, the rename and the failure path testable with real classes. Make `copy()` throw after a partial write to test the failure path.
- **Know the double's three traps.**
  - Its store outlives a test. Delete and recreate your own folder in `beforeEach`.
  - Spy on the `Paths.appleSharedContainers` getter. Do not write the double's record.
  - It seeds only `document`, `cache` and `bundle` (`apps/mobile/node_modules/expo-file-system/mocks/FileSystem.ts:25-27`). Create any other root with `create({ intermediates: true })`.

## Related Issues

- `docs/solutions/mobile/raw-export-folder-destination-20260915.md`: the raw-file export also waits for `File.copy`, into a folder that the viewer picks. It cannot use the part-file rename: Android's folder picker names the copy from the source file. So it removes a partial file in its `catch` instead.
- `docs/solutions/integration-issues/expo-downloadasync-non-2xx-body-corrupts-offline-sidecar.md`: another case where a file under a trusted name is not a valid file.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: the parent rule for preferring the real contract over a hand mock.
