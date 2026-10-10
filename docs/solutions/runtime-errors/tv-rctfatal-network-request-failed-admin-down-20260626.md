---
title: TV RCTFatal / Network request failed traced to local admin down + wedged Metro cache
date: 2026-06-26
category: runtime-errors
module: apps/tv (TV dev environment)
problem_type: runtime_error
component: development_workflow
symptoms:
  - "RCTFatal overlay with all-native stack and no JS error message or Metro log lines"
  - "App crashes immediately on launch with zero new bundle requests after sim reboot"
  - "Metro re-serves a tiny '(1 module)' bundle instead of the full 2315-module app bundle"
  - "idb key presses silently no-op after a simulator reboot"
  - "One Apollo search succeeds while an adjacent search fails with 'Network request failed'"
root_cause: config_error
resolution_type: environment_setup
severity: high
tags:
  - tv
  - rctfatal
  - react-native
  - expo-dev-client
  - metro
  - admin-cms
  - network-request-failed
  - simulator
related_components:
  - tooling
  - development_workflow
---

# TV `RCTFatal` crash: local admin CMS down (+ wedged dev tooling), not a code bug

## Problem

The TV dev-client app showed a hard `RCTFatal` crash overlay with an all-native stack and no JS message, caused by the local admin CMS going down/flapping — which escalated an unhandled `TypeError: Network request failed` to a fatal in dev mode — then persisted after admin recovered because the dev client stayed on its error screen and Metro had a stale transform cache.

## Symptoms

- Hard `RCTFatal` crash overlay on-screen (expo-dev-client error screen with "Reload" / "Go to home" buttons), **all-native stack with zero JS frames and zero JS error message**:
  ```
  RCTFatal
  __28-[RCTCxxBridge handleError:]_block_invoke
  _dispatch_call_block_and_release
  _dispatch_main_queue_drain.cold.8
  __CFRUNLOOP_IS_SERVICING_THE_MAIN_DISPATCH_QUEUE__
  __CFRunLoopRun
  GSEventRunModal
  -[UIApplication _run]
  ```
- Metro console showed only a **caught** error: `ERROR [search] Apollo error: [TypeError: Network request failed]` — not the obvious fatal source.
- Adjacent Metro log lines showed one search (`easter`) returning 9 results while another (`bible stories`) failed `Network request failed` — intermittent/flapping failure pattern.
- Admin PID changed repeatedly (`97607 -> 90212 -> down -> 12414`); `:3003` unreachable at the crash moment.
- Crash **persisted after admin recovered** (HTTP 200, query in ~50ms) — every reload kept crashing.
- After a full simulator reboot: app crashed immediately on launch with **zero new Metro log lines** (no bundle request at all).
- `idb ui key` presses on the on-screen "Reload" button **silently no-op'd** after the reboot.

## What Didn't Work

- **All-native stack read as a native crash** — no JS message, no JS frames; led diagnosis away from a network error. An all-native `RCTFatal` in dev mode is just the escalation path for any unhandled rejection, including network failures.
- **`xcrun simctl spawn <udid> log show`** returned nothing useful — the JS error doesn't surface in the simulator system log because it's a caught Apollo error wrapped in a dev-mode fatal escalation. (session history: on a _physical_ device, `xcrun devicectl device process launch --console <bundle-id>` DOES capture the real JS exception — that is how a prior apps/tv `RCTFatal` (a missing app.json `scheme`) was finally diagnosed when the on-screen native stack omitted the JS message.)
- **Metro's caught error looked already-handled** — `ERROR [search] Apollo error: [TypeError: Network request failed]` is emitted by the search try/catch; it appeared resolved, masking the fact that the same connection failure was hitting an uncaught callsite and triggering the fatal.
- **Restarting / waiting for admin did not recover the app** — the dev client stays on its persisted error screen; it doesn't auto-recover when the backend returns. Admin was healthy from the Mac side (HTTP 200, ~50ms) but the app never left the fatal overlay.
- **A full simulator reboot did not fix it** — the app crashed immediately on relaunch with zero new Metro log lines. The stale Metro transform cache (running 4h46m) served a broken/partial bundle; a tiny `Bundled … (1 module)` re-serve is not a real reload.
- **`idb ui key` presses silently no-op'd** after the sim reboot — idb loses its connection on simulator restart; pressing keys without reconnecting has no effect.

## Solution

Two-part fix: stabilize admin first, then clear the wedged dev tooling.

**Part 1 — Run and stabilize local admin.**

From `apps/admin`:

```bash
pnpm dev          # = next dev --port 3003
```

Prerequisites: Postgres running (postgresql@17), `apps/admin/.env` / `.env.local` with `DATABASE_URL`. Verify readiness before proceeding:

```bash
# minimal GraphQL probe
curl -s -X POST http://localhost:3003/api/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __typename }"}' | grep -q '__typename'

# app's exact query — should return results in ~50ms
# (semantic search, limit 40 -> HTTP 200)
```

**Non-fatal log to ignore:** admin logs `redis.error: getaddrinfo ENOTFOUND redis` repeatedly on startup — harmless (optional Redis host unreachable in local dev); GraphQL works correctly without Redis.

**Part 2 — Clear the wedged dev tooling.**

```bash
# 1. Kill the stale Metro on :8082
kill $(lsof -ti :8082)

# 2. Restart Metro with --clear to force a full fresh bundle
EXPO_TV=1 npx expo start --dev-client --port 8082 --clear

# 3. Reconnect idb to the sim after its reboot
idb connect <udid>

# 4. Press the dev-client Reload button
idb ui key --udid <udid> 40   # 40 = Select on Apple TV remote
```

Confirm success: Metro must emit a **full** bundle line:

```
iOS Bundled 3753ms … (2315 modules)
```

A `(1 module)` line is a cache re-serve, NOT a real reload. After a full bundle, home and search both rendered correctly against the stable admin.

Recovery deep-link if needed: `exp+jesus-film-forge-tv://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082`

## Why This Works

**Layer 1 — admin down causes the crash.** The TV app's Apollo client hits `http://localhost:3003/api/graphql` for every screen load. When `:3003` is unreachable, the fetch throws `TypeError: Network request failed` — a **connection-level rejection**, not a GraphQL error. In a dev build, React Native escalates any unhandled rejection to `RCTFatal`, which shows the crash overlay. The caught `ERROR [search] Apollo error` line in Metro is from a _different_ Apollo call wrapped in a try/catch; the home/experience query had no such guard, so it escalated. Proof: adjacent log lines where one query succeeded and another failed `Network request failed` = admin was flapping (restarting), not down entirely.

**Layer 2 — why it persisted after admin recovered.** Two sub-causes stacked: (a) The Expo dev client holds on its persisted error screen — it does not auto-retry once the fatal overlay is shown; only pressing on-screen "Reload" (or a Metro restart + deep-link) exits it. (b) Metro had accumulated 4h46m of transform cache. When "Reload" was pressed, Metro served a stale/broken partial bundle — only `(1 module)` re-served instead of the full 2315-module app — so the app re-crashed even though admin was healthy. Killing Metro and restarting with `--clear` forced a full recompile from scratch, producing a clean bundle that loaded correctly.

**Why this is not product code.** The app ran cleanly all session until admin started flapping. After the two-part fix, home and search rendered correctly with no code changes. The crash is purely environmental — a dev-mode safety net doing its job.

## Prevention

Diagnostic playbook for this class of crash:

- **All-native `RCTFatal` stack + no JS message + no Metro logs != a code bug.** It is dev-mode escalation of a network failure OR a broken/stale cached bundle. Check the backend first.
- **To get the real JS error behind a native `RCTFatal`** (the on-screen stack is all-native), launch via `xcrun devicectl device process launch --console <bundle-id>` on a paired device, or read the Metro console for the firing query that precedes the fatal — the simulator `log show` is often silent. (session history)
- **"No fresh Metro bundle request on reload"** means the dev client is wedged, not fetching. Only a `Bundled … N modules` full-bundle line confirms a real reload; a `(1 module)` re-serve is not a reload.
- **A caught Apollo error in Metro can coexist with an `RCTFatal`.** The caught log line means one callsite handled it; the fatal came from a different uncaught callsite hitting the same flapping backend.
- **Adjacent log lines: one query succeeds, another fails `Network request failed`** = intermittent connection failure = a flapping/restarting backend, not a query-specific bug.
- **After any sim reboot, run `idb connect <udid>` before sending keys.** `idb ui key` presses silently no-op without an active connection.
- **If the crash persists after the backend recovers:** don't keep restarting admin. Suspect the dev tooling — restart Metro with `--clear` and reload. The dev client's persisted error screen + Metro's stale transform cache outlive the backend recovery.
- **Always start local admin before launching the TV dev client.** If admin is down at launch, the first fetch escalates to `RCTFatal` before any JS is usefully running.
- **Simulator vs physical device for the admin URL:** the **simulator** shares the Mac's loopback, so `localhost:3003` works; a **physical Apple TV** cannot resolve `localhost`/`127.0.0.1` (it resolves to the TV itself) — use the Mac's LAN IP there. (session history)
- **(auto memory [claude])** `EXPO_PUBLIC_GRAPHQL_URL` must use `localhost`, not `127.0.0.1` or the Mac's LAN IP, for simulator dev. `getGraphQLUrl()` swaps `localhost`->`10.0.2.2` for Android; `127.0.0.1` bypasses that swap and breaks the Android emulator. LAN IPs go stale on DHCP. See `[tv-mobile-sim-local-admin-use-localhost]`.
- **(auto memory [claude])** `EXPO_PUBLIC_*` vars are inlined by Metro at **startup** — after editing `.env.local`, restart Metro with `--clear` and reload the dev client; a hot-reload is not enough. See `[tv-mobile-sim-local-admin-use-localhost]`.

## Related Issues

- **Known Pattern (shared recovery mechanics, different root cause):** `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md` — same Metro `--clear` / `EXPO_PUBLIC_*`-inlined-at-startup / idb-reconnect-after-reboot recovery, but its `RCTFatal` cause is a **symlinked-node_modules worktree Metro**, not a down backend. Disambiguate when triaging.
- **Sibling `RCTFatal` (different root cause):** `docs/solutions/runtime-errors/expo-router-standalone-no-scheme-launch-crash-20260623.md` (PR #1340) — a standalone/TestFlight `RCTFatal` from a missing app.json `scheme`; uses `xcrun devicectl --console` to capture the real JS error. (session history)
- **See also:** `docs/solutions/runtime-errors/metro-node-crawler-rangerror-missing-watchman-20260622.md` (Metro-is-the-real-failure meta-rule); `docs/solutions/mobile/expo-env-file-handling.md` and `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md` (env-file traps + simulator `log show` silent in Expo dev builds).
- **Memory:** `[tv-mobile-sim-local-admin-use-localhost]` (localhost vs 127.0.0.1 vs LAN IP; `.env.local` gitignored in worktrees; Metro inlines `EXPO_PUBLIC_*` at startup); `[tv-fast-refresh-zombie-player]` (cold-relaunch before blaming the player); `[tv-sim-dpad-and-focus-bridging]` (`idb` key codes; `idb connect` after sim reboot).
