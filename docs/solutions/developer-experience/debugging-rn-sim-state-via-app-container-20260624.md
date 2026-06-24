---
title: Debugging RN simulator state by reading the app container (when console.log is dead)
date: 2026-06-24
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "A React Native (Expo) bug depends on persisted state or native events you can't see, and console.log reaches neither Metro stdout nor os_log"
  - "You need ground-truth AsyncStorage records, on-disk files, or a debug-event log while the app runs in the iOS simulator"
  - "Diagnosing download / cache / offline-manifest state mid-flight in apps/mobile"
related_components:
  - apps/tv
tags:
  - simulator
  - async-storage
  - react-native
  - debugging
  - expo
  - idb
  - offline-downloads
  - simctl
---

# Debugging RN simulator state by reading the app container (when console.log is dead)

## Context

A class of React Native bug depends on **persisted state or native events you
can't see**: which AsyncStorage records exist mid-flight, what byte counts a
download has, what `errorCode` a native task fired and when. The instinct is to
`console.log` it — but in an Expo dev build the RN `console.log` polyfill ships
output to the **Metro dev-tools websocket**, not to Metro's **stdout** (so a
captured stdout log file stays empty) and not to **`os_log`** (so
`xcrun simctl spawn <udid> log show` never sees it). Native-module logs (NSLog /
DLog) reach `os_log`, but a third-party module's may be gated off. When every log
channel you reach for is silent, you're blind to the exact state the bug turns on.

This technique was what cracked the series-download "stops at N of M" bug (see
`docs/solutions/runtime-errors/series-download-setconfig-cancels-inflight-20260624.md`):
reading the persisted
download records _mid-stall_ showed them go `queued -> gone` (proving the native
session was cancelling + deleting them, not failing), and a file-based event log
caught the `errorCode -999 "cancelled"` firing 16 ms after a sibling started — a
sequence no reachable log channel would have shown.

## Guidance

The iOS simulator stores each app's data on the host disk. Read it directly for
ground truth — three surfaces, all reachable from the host shell.

**1. Find the app's data container:**

```bash
xcrun simctl get_app_container <udid> <bundle-id> data
# -> /Users/<you>/Library/Developer/CoreSimulator/Devices/<udid>/data/Containers/Data/Application/<app-uuid>
```

**2. Read AsyncStorage records** (the `@react-native-async-storage` community
module) at
`<container>/Library/Application Support/<bundle-id>/RCTAsyncLocalStorage_V1/manifest.json`.
Small values sit inline in `manifest.json`; large values live in a sibling file
named `md5(key)`. A few lines of Python dumps them while the app runs:

```python
import json, os, hashlib
d = "<container>/Library/Application Support/<bundle-id>/RCTAsyncLocalStorage_V1"
man = json.load(open(os.path.join(d, "manifest.json")))
def val(k):
    v = man.get(k)
    if v is not None:
        return v  # small values inline
    f = os.path.join(d, hashlib.md5(k.encode()).hexdigest())  # overflow file
    return open(f).read() if os.path.exists(f) else None
for k in (x for x in man if x.startswith("offline.download.")):
    print(json.loads(val(k))["state"], k)
```

**3. Write a file-based event log from app code** when you need an event timeline
the bug-relevant code is the only one that can stamp. Append (serialized so
concurrent events don't clobber) to a `documentDirectory` file you read back from
`<container>/Documents/<file>`:

```ts
import {
  documentDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy"

const LOG = `${documentDirectory ?? ""}dl-debug.log`
let chain: Promise<void> = Promise.resolve() // serialize so events never clobber
export function dlDebug(line: string): void {
  chain = chain.then(async () => {
    let prev = ""
    try {
      prev = await readAsStringAsync(LOG)
    } catch {
      prev = ""
    }
    await writeAsStringAsync(LOG, `${prev}${line}\n`)
  })
}
```

Then `cat "<container>/Documents/dl-debug.log"`. The app's other `Documents/`
files (e.g. an offline-download dir) give byte-level state the same way.

**Remove the file logger and its call sites before committing** — it is scratch
instrumentation, not shipping code.

## Why This Matters

The on-disk container is **ground truth that survives the log-channel gap**. It
turns "the screen says 2 of 5 and I have no idea why" into a precise, timestamped
account of what the native layer actually did — read repeatedly _during_ a stall,
not reconstructed after. The state read (records vanishing, not failing) and the
event read (the `-999` cancellation timing) were each necessary to find the
root cause; neither was visible through Metro stdout or `os_log`. Guessing from
the UI would have produced a wrong fix.

It is a **diagnosis channel, not a test**. Unit tests prove the fix; this proves
_what is happening_ when a state/native-event bug won't surface any other way.

## When to Apply

- A RN `console.log` you added isn't appearing where you expect (not in Metro
  stdout, not in `simctl spawn … log show`) — assume it went to the dev-tools
  websocket and switch to reading state off disk instead of chasing the log.
- The bug hinges on **persisted state** (AsyncStorage records, an offline
  manifest) or **native-event timing** you need to observe live.
- You can pair it with `idb describe-all` for the live a11y tree (the
  verification-side companion — see Related) when you also need on-screen state.
- Not for logic you can unit-test off-device; reach for this only when the
  signal genuinely lives in the simulator's persisted/native layer.

## Examples

Reading the same records at two moments isolated the cause of a stalled batch
download:

```
@14s:  queued can-god-be-known   queued what-are-humans   queued what-is-sin
@40s:  (those three GONE)        downloaded what-is-salvation  downloaded what-is-the-cross
```

The three `queued` placeholders did not become `failed` or `paused` — they were
**deleted**, which pointed straight at a cancellation path rather than a transfer
failure. The file-based event log then confirmed it:

```
40619  -> handed-off can-god-be-known
40634  startDownload what-is-sin          # sibling starts ...
40635  error id=can-god-be-known code=-999 kind=userCancel msg=cancelled
```

## Related

- `docs/solutions/runtime-errors/series-download-setconfig-cancels-inflight-20260624.md`
  — the bug this technique cracked (its root cause + fix); the worked example here.
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`
  — the verification-side companion: that doc reads the live a11y tree / measures
  geometry to confirm UI; this one reads the on-disk container to diagnose state.
- `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`
  — same meta-pattern on a different platform: a log channel silently swallows
  output, so capture through a channel that actually carries ("logging lies").
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`
  — the web analog of "measure ground truth instead of eyeballing it."
