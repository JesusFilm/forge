---
title: "Series download stalls at N-of-M: per-download setConfig cancels in-flight transfers"
category: runtime-errors
tags:
  [
    mobile,
    offline-downloads,
    react-native-background-downloader,
    ios,
    urlsession,
  ]
date: 2026-06-24
---

## Symptom

A mobile **series "Download all"** consistently stops partway — e.g. "2 of 5
downloaded" — and the stalled episodes are _gone_ (no `failed`/`paused` record,
not just not-finished). Manual re-tap advances it a bit each time (2 → 4 → 5).
A **single-video** download is never affected. The action row reads
"N of M downloaded" (not "Downloading…"), so the missing ones aren't in any
in-progress state.

## Root cause

`@kesha-antonov/react-native-background-downloader`'s `setConfig`
(`setAllowsCellularAccess` / `setMaxParallelDownloads`) applies the new config
by **recreating the shared iOS `NSURLSession`** (`unregisterSession` +
`lazyRegisterSession` in `RNBackgroundDownloader.mm`). Recreating the session
**cancels every in-flight download task** — each surfaces as `error` with
`errorCode = -999` and message `"cancelled"`.

`DownloadsProvider.startDownload` called `configureDownloadEngine({ wifiOnly })`
on **every** download (also in `swapDownload` and the reconcile restart). In a
series the enqueue fans out sequential `startDownload`s, so episode B's
`configureDownloadEngine` recreated the session and **cancelled episode A**
mid-transfer. `mapNativeError("cancelled")` → `userCancel` →
`classifyInterruption` → `canceled` → `onInterruption` → `deleteDownload`, so the
record was **deleted entirely** (hence "gone", not "failed"). Only the
last-started download (nothing runs after it) plus already-complete ones survive.

It's invisible for one video: a single `setConfig` with no sibling task in flight
cancels nothing.

## How it was found

Native `os_log` and RN `console.log` didn't surface the events, so a temporary
file logger (`expo-file-system/legacy` → `documentDirectory/dl-debug.log`, read
straight from the sim app container) was wired at each boundary
(`begin/done/error/start`, `onInterruption`, every `startDownload` return). The
log showed the smoking gun: `-> handed-off can-god-be-known` then, 16 ms later
when the next episode's `startDownload` ran, `error code=-999 kind=userCancel
msg=cancelled` → `interrupt -> canceled`. AsyncStorage records read mid-stall
(also from the container) confirmed the queued placeholders vanishing.

## Fix

`apps/mobile` PR (commit 376189de):

1. **Configure the engine once**, in the existing mount effect
   (`[isReady, wifiOnly]`) — never per-download. Removed the
   `configureDownloadEngine` calls from `startDownload`, `swapDownload`, and the
   reconcile `restartInterrupted`.
2. **Make `configureDownloadEngine` idempotent** (`downloadEngine.ts`): track the
   last-applied `wifiOnly` and skip the native `setConfig` when unchanged, so no
   caller can ever needlessly recreate the session. Unit-tested via
   `downloadEngine.test.ts` (`__resetEngineConfigForTest` resets module state).

Verified in the simulator: a fresh 5-episode Washi Gospel download completed all
5 with **zero** `-999` cancellations and reached "All downloaded".

## Takeaways

- Treat any native "apply config" call that mutates a shared session as
  **session-recreating → task-cancelling**. Call it once at init / on real
  change, never in a per-item hot path that fans out concurrent work.
- A _deleted_ record (vs `failed`/`paused`) points at a `userCancel`
  classification — trace what emits `-999 "cancelled"`, which on iOS is often a
  side effect (session teardown), not a real user cancel.
- When neither Metro stdout nor `os_log` carries RN logs, a
  `documentDirectory` debug file read from the sim container is a reliable
  capture channel.
