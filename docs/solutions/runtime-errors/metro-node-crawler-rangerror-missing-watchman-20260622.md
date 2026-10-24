---
title: "Metro crashes with `RangeError: Invalid string length` in a large pnpm monorepo when watchman is missing (surfaces as ngrok/connect errors on device)"
date: 2026-06-22
problem_type: runtime_error
category: runtime-errors
module: apps/mobile
component: development_workflow
symptoms:
  - "Metro crashes: RangeError: Invalid string length at metro-file-map/src/crawlers/node/index.js:140 (Socket.<anonymous>)"
  - "Physical device shows ERR_NGROK_3004 'The server returned an invalid or incomplete HTTP response' or 'Failed to connect to https://<sub>.exp.direct'"
  - "iOS simulator: 'Could not connect to development server' pointing at the tunnel URL even when the deep link targeted localhost:8081"
  - "On-device feature failures (e.g. offline downloads stuck on Retry) that are actually a dead Metro, not app code"
root_cause: missing_tooling
resolution_type: environment_setup
severity: high
tags:
  - metro
  - watchman
  - expo
  - pnpm-monorepo
  - ngrok-tunnel
  - ios-simulator
  - react-native
  - dev-environment
related:
  - docs/solutions/developer-experience/metro-watchfolders-monorepo-refresh-storm-20260415.md
  - docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md
  - docs/solutions/mobile/expo-env-file-handling.md
  - docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md
---

# Metro crashes with `RangeError: Invalid string length` in a large pnpm monorepo when watchman is missing

## Problem

Without watchman installed, Metro falls back to its **node crawler**, which shells out `find` over everything in `watchFolders` (the whole pnpm monorepo) and concatenates the result into a single in-memory string. In a repo this large that string overflows Node's ~512 MB max string length and Metro crashes with `RangeError: Invalid string length`. When Metro is running behind an Expo `--tunnel`, the crash surfaces on the device as an ngrok gateway error — so an `apps/mobile` feature appears broken (e.g. offline downloads stuck on "Retry") when the real failure is a dead bundler.

## Symptoms

- Metro process output: `RangeError: Invalid string length` at `metro-file-map/src/crawlers/node/index.js:140` inside `Socket.<anonymous>`.
- Physical device dev-client: `ERR_NGROK_3004 "The server returned an invalid or incomplete HTTP response"`, or `"Failed to connect to https://<sub>.exp.direct"` in the launcher.
- iOS simulator: `"Could not connect to development server"` whose URL points at the **tunnel** host, even when the launch deep link targeted `localhost:8081`.
- **Intermittent** — the monorepo's file count sits near the string-length boundary, so a fresh `expo start` may succeed and a later one tips over. "It worked the first time" is a trap, not evidence that the environment is fine.

## What Didn't Work

- **Suspecting the app code.** Temporary `console.warn("[dl] ...")` traces showed the download started with `src=fresh valid=true` — the feature logic was correct. The red "Retry" was an environment artifact.
- **Checking the wifi-only setting.** `wifiOnly` defaults to `false`, so cellular wasn't blocked.
- **Restarting tunnel Metro repeatedly.** It kept crashing with the same `RangeError` on the same workload — the node crawler is the constant, not a transient.
- **Cold-relaunching the app / re-scanning the QR.** Downstream symptoms; the bundler was already dead.
- **Pointing the simulator at `localhost:8081` while Metro was in `--tunnel` mode.** The sim still tried to fetch the bundle from the tunnel and failed (see Why This Works — the manifest, not the connection, carries the bundle host).

## Solution

### 1. Install watchman (the real fix)

```bash
brew install watchman
```

Metro prefers watchman when it's present and skips the node crawler entirely. Watchman is event-driven and never materializes the full file list as one string, so the `RangeError` ceiling disappears. After installing, the same workload that crashed before stays up.

Prove Metro is healthy **without a device** by force-building the bundle:

```bash
curl -s -o /tmp/b.js -w '%{http_code}\n' \
  'http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true'
# expect: 200, and /tmp/b.js ~11-12 MB of JS
```

Caveat: watchman's first `watch-project` crawl on a repo this size can take minutes (~197s observed). If it hangs, check whether a path under `watchFolders` is backed by a **stopped Docker Desktop** — watchman stalls on unresponsive mounts and completes once Docker is back.

### 2. Run tunnel mode for the device, plain-localhost for the simulator — don't mix

```bash
# Physical device (localhost isn't reachable from the phone):
expo start --tunnel --dev-client

# iOS simulator (runs on the Mac, reaches localhost directly):
expo start --dev-client          # no --tunnel
xcrun simctl openurl <UDID> \
  'forgemobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
# then drive it with idb
```

The simulator is the reliable reproduction surface — fast local bundles, logs that stream, and idb-drivable — versus a flaky device tunnel.

## Why This Works

Metro's file-watching layer has two backends. **watchman** (preferred) tracks changes incrementally and never builds the full path list as a string. The **node-crawler fallback** pipes `find` output through a socket and accumulates it into one JS string per crawl; past ~10M paths that string exceeds V8's limit and throws synchronously inside the socket handler, taking Metro down. Installing watchman removes the fallback path, so the ceiling can't be hit.

The tunnel/localhost split is a Metro design fact, not a bug: with `--tunnel`, Metro bakes the **tunnel URL into the manifest** it serves as the bundle host, so the device (which can't reach `localhost`) gets a reachable bundle. The manifest is identical regardless of who fetched it — so a simulator asking `localhost:8081` still receives a tunnel-URL manifest and tries to load the bundle through the tunnel. Running Metro without `--tunnel` makes the manifest advertise localhost, which the sim can reach directly.

## Prevention

- **Treat watchman as a hard prerequisite for mobile dev, not an optional speedup.** The node-crawler fallback is fragile at this monorepo's scale and fails non-deterministically by file count at launch time. Add it to the `apps/mobile` dev-environment setup (alongside Xcode/idb) so a fresh machine never hits this.
- **When a device shows `ERR_NGROK_3004` or any tunnel/connect error, check Metro first.** The device error is always downstream — grep the Metro process output for `RangeError: Invalid string length` before suspecting the network, the device, or the feature code.
- **Use plain-localhost Metro for all simulator work; reserve `--tunnel` for physical devices.** Mixing them sends the sim through the tunnel via the manifest even when the deep link says localhost.
- **Smoke Metro health with `curl` on `/.expo/.virtual-metro-entry.bundle` before attaching a device** — a `200` proves the bundler is alive independent of tunnel/device state, and isolates "Metro is broken" from "the app is broken" in one step.

## Related Issues

- [Metro watchFolders monorepo refresh storm](../developer-experience/metro-watchfolders-monorepo-refresh-storm-20260415.md) — same "Metro + pnpm monorepo over-broad crawl" family (different mechanism: refresh storm vs. crawl-overflow crash).
- [Verifying mobile Expo worktree changes in the simulator](../developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md) — the sim dev-loop guide; its plain-localhost-Metro advice is the same conclusion reached here. Predates the watchman prerequisite and the tunnel-manifest note.
- [Expo env file handling](../mobile/expo-env-file-handling.md) — the device-needs-LAN-IP cousin of the tunnel-vs-localhost split; doesn't yet cover the `--tunnel` manifest behavior.
- [Metro pnpm symlink react duplicate resolution](../mobile/metro-pnpm-symlink-react-duplicate-resolution.md) — another Metro-in-pnpm-monorepo gotcha on the same `metro.config.js` axis.
