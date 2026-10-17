---
title: "A physical Android phone on a mobile dev build cannot reach local admin: the loopback rewrite targets the emulator alias on every Android device"
date: 2026-09-28
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
root_cause: config_error
resolution_type: environment_setup
applies_when:
  - "Running an apps/mobile development build on a physical Android phone against local admin"
  - "The Metro startup line shows admin_endpoint.url=http://10.0.2.2:... on a device that is not an emulator"
  - "Choosing which running local admin dev server a device should use"
  - "Setting EXPO_PUBLIC_ADMIN_GRAPHQL_URL in apps/mobile/.env.development.local"
  - "Changing normalizeAdminHost, apps/tv/src/lib/config.ts, or the feat-339 notes in apps/mobile/CLAUDE.md"
symptoms:
  - "A physical Android dev build shows no local admin content while an emulator on the same Mac works"
  - "adb reverse tcp:3003 tcp:3003 does not restore admin on the phone"
  - "The [admin-endpoint] startup line on a real phone names 10.0.2.2, an address that exists only inside the emulator"
retire_when: "normalizeAdminHost in apps/mobile/src/lib/adminEndpoint.ts stops rewriting a loopback host on a physical Android device (an emulator check or an opt-out)"
tags:
  [
    mobile,
    android,
    physical-device,
    local-admin,
    admin-endpoint,
    env,
    emulator-alias,
    feat-339,
  ]
---

# A physical Android phone on a mobile dev build cannot reach local admin: the loopback rewrite targets the emulator alias on every Android device

## Context

A development bundle of `apps/mobile` defaults to local admin at
`http://localhost:3003/api/graphql` (`apps/mobile/src/lib/adminEndpoint.ts:5`,
`:85-87`). On Android, `normalizeAdminHost` then rewrites a loopback host
(`localhost` or `127.0.0.1`) to `10.0.2.2` (`adminEndpoint.ts:21`, `:23`,
`:75`). That address is the Android emulator's alias for the host machine.

The gate is one line: `if (!isDev || platform !== "android") return url`
(`adminEndpoint.ts:68`). It keys on the platform only. The function has no
emulator input, and both callers pass `Platform.OS`
(`apps/mobile/src/env.ts:109-113`, `apps/mobile/src/lib/config.ts:5-11`). So a
physical Android phone on a development build also sends every admin request
to `10.0.2.2`. That address does not exist on the phone's Wi-Fi network.

The design intent was the two simulators. The comment above the function says
"Loopback -> emulator alias, so one configured value works on both simulators"
(`adminEndpoint.ts:61`), and the unit test title says "emulator alias"
(`apps/mobile/src/lib/__tests__/adminEndpoint.test.ts:52-58`). The "Admin
endpoint resolution (feat-339)" section of `apps/mobile/CLAUDE.md` said the
rewrite ran "on the Android emulator" and that "physical-device work is
unaffected". An agent that trusted those two sentences did not look at the
rewrite. The correction to that section is in PR #2444, open as of 2026-09-28.

This came up on 2026-09-28 on a Galaxy S20 (`SM_G981U1`) running a dev client
built from a worktree, with Metro on port 8137 over USB (`adb reverse`). The
user reported "The s20 is not connected to local admin." No env file set
`EXPO_PUBLIC_ADMIN_GRAPHQL_URL`, so the in-code default applied.

## Guidance

1. **Read the resolved URL first.** Metro prints one `[admin-endpoint]` line per
   launch (`adminEndpoint.ts:130-139`). If a physical Android phone shows
   `10.0.2.2`, the default configuration is the cause. Do not start with admin,
   Metro, or Wi-Fi. The line says `kind=local`, because `10.0.2.2` is in the
   local host set (`adminEndpoint.ts:26-32`), so read the URL, not the kind.
2. **Do not use `adb reverse tcp:3003 tcp:3003` alone.** A reverse tunnel
   listens on the phone's own loopback, but the app rewrites `localhost` before
   any request (`adminEndpoint.ts:68-75`). The tunnel gets no traffic. This was
   reasoned from the code, not tried. Metro is different: the dev client
   connects to Metro at `localhost:<port>`, and no app code rewrites that URL.
3. **Prove reachability from the phone before you edit a file.** Get both
   addresses and confirm they share a subnet (`ipconfig getifaddr en0` on the
   Mac, `adb -s <serial> shell ip -4 addr show wlan0` on the phone). Then send a
   real GraphQL POST from the phone to the Mac's LAN address (see Examples).
4. **Choose the port with a real query and a known owner.** `/api/health` is
   not a health signal: on this day the admin on port 3003 answered 500 on
   every route, `/api/health` included. A query that returns `data` also proves
   less than it seems. Other sessions run fake-admin proxies that forward every
   query to production
   (`docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`);
   ports 3010, 3011 and 3017 answered with the production Home experience
   (`watch-home`), which fits that pattern. Find the process behind the port
   (`ps -ax -o pid,command | grep "next dev --port <port>"`, or `lsof` when it
   does not hang). A `next dev` process under an `apps/admin` folder is a real
   admin. The production refusal does not help here: only the
   `admin.jesusfilm.org` host refuses (`adminEndpoint.ts:9`, `:56`, `:104`).
5. **Put the override in `apps/mobile/.env.development.local`.** Never use
   `.env.local`: `fetch-secrets` replaces it wholesale
   (`apps/mobile/package.json:9`). The per-machine file is gitignored
   (`apps/mobile/.gitignore:28`). A LAN host is not a loopback host, so
   `normalizeAdminHost` leaves it alone (`adminEndpoint.ts:70`). Never commit a
   LAN IP to a tracked or shared file, because DHCP reassigns it.
6. **Cold-restart Metro with `--clear`.** Expo inlines `EXPO_PUBLIC_*` values at
   bundler start. A reload or a shell `export` does not change the inlined value
   (`docs/solutions/mobile/expo-env-file-handling.md`).
7. **Prove the served bundle before you relaunch the phone.** Fetch the Android
   dev bundle from Metro and grep for the new value. If it shows the old value
   or nothing, restart Metro again before you debug the phone.
8. **Relaunch the dev client and check three proofs.** The startup line names
   the LAN URL with `kind=other`. Home logs `home_feed_ready`; only
   `feed_source: "network"` with `outcome: "success"` proves a live admin fetch
   (`apps/mobile/src/hooks/useWatchHome.ts:325-328`), because the same event
   also fires for a cached snapshot. A Home screenshot shows no "Admin endpoint
   unreachable" banner; this proof is weak alone, because an aborted request
   does not raise the banner (`apps/mobile/src/lib/apolloClient.ts:240`).
9. **Keep the override current.** The LAN IP changes per network. The named
   port can belong to another worktree's dev server, and it stops working when
   that server stops. Each worktree has its own untracked copy of the file, so a
   new worktree falls back to `10.0.2.2` on a phone.

Possible follow-ups, not done:

- Rename the test case at `adminEndpoint.test.ts:53` to say "every Android
  device", or add emulator detection plus a physical-device case that keeps
  `localhost`. Emulator detection through `expo-device` adds a native module and
  needs a new dev client.
- Add the pre-rewrite host to the startup line (for example
  `admin_endpoint.rewritten_from=localhost`), so `10.0.2.2` on a phone is easy
  to spot.
- `apps/tv/src/lib/config.ts:7-8` has the same platform-keyed rewrite for the
  substring `localhost`. A physical Android TV dev build likely has the same
  trap. Nobody has tested it on a physical Android TV.

## Why This Matters

The failure is quiet. The dev bundle boots, and the startup line says
`kind=local`. The unreachable banner may not show. Home can paint a cached
snapshot or the frozen fallback body, which looks like loaded content.

The obvious fixes fail. `adb reverse` on 3003 gets no traffic. A shell `export`
or a Metro reload does not change the inlined value. An override in `.env.local`
disappears on the next `fetch-secrets` run.

A wrong port can give a false pass. A rotten dev server fails every route, and
a fake-admin proxy answers with production content. Only a real query plus a
known process owner separates the three cases.

## When to Apply

- You run an `apps/mobile` development build on a physical Android phone and
  want local admin.
- The Metro log shows `admin_endpoint.url=http://10.0.2.2:...` on a real phone.
- Home on a phone shows no local content, a cached snapshot, or fallback
  content.
- You switch Wi-Fi networks, start a new worktree, or stop the admin dev server
  that the override names.
- You change `normalizeAdminHost`, `apps/tv/src/lib/config.ts`, or the
  "Admin endpoint resolution (feat-339)" section of `apps/mobile/CLAUDE.md`.

## Examples

The startup line, before and after:

```text
# Before: default configuration on a physical Android phone (derived from the code)
[admin-endpoint] admin_endpoint.url=http://10.0.2.2:3003/api/graphql admin_endpoint.kind=local

# After: LAN override (observed on the Galaxy S20, 2026-09-28)
[admin-endpoint] admin_endpoint.url=http://10.1.137.137:3013/api/graphql admin_endpoint.kind=other
```

The override file:

```bash
# apps/mobile/.env.development.local
# Gitignored, per machine, per worktree. Never .env.local (fetch-secrets replaces it).
# The LAN IP changes per network: `ipconfig getifaddr en0`.
EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://10.1.137.137:3013/api/graphql
```

The recipe:

```bash
# 1. Both addresses. They must share a subnet.
ipconfig getifaddr en0                          # Mac, e.g. 10.1.137.137
adb -s <serial> shell ip -4 addr show wlan0     # phone, e.g. 10.1.11.77

# 2. A real GraphQL query FROM THE PHONE. Pass one quoted string, because the
#    phone's shell parses the quotes a second time.
adb -s <serial> shell 'curl -s -X POST http://10.1.137.137:3013/api/graphql -H "content-type: application/json" -d "{\"query\":\"{ videoBySlug(slug: \\\"the-arrow\\\") { slug } }\"}"'
# Expect: {"data":{"videoBySlug":{"slug":"the-arrow"}}}

# 3. Write apps/mobile/.env.development.local (above), then cold-restart Metro.
cd apps/mobile && npx expo start --dev-client --port 8137 --clear
adb -s <serial> reverse tcp:8137 tcp:8137

# 4. Prove the SERVED bundle carries the new value before you touch the phone.
curl -s 'http://localhost:8137/.expo/.virtual-metro-entry.bundle?platform=android&dev=true' \
  | grep -o 'EXPO_PUBLIC_ADMIN_GRAPHQL_URL": "[^"]*"'
# Expect: EXPO_PUBLIC_ADMIN_GRAPHQL_URL": "http://10.1.137.137:3013/api/graphql"

# 5. Relaunch the dev client, then read the startup line, home_feed_ready
#    (feed_source network + outcome success), and a Home screenshot.
```

## Related

- `docs/solutions/mobile/expo-env-file-handling.md`: env file loading and the
  feat-339 local-admin default. It also calls the rewrite emulator-only.
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`:
  worktree simulator checks. It also calls the rewrite emulator-only.
- `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`:
  the fake-admin proxies that forward queries to production.
- `docs/solutions/runtime-errors/pothos-turbopack-hmr-duplicate-typename-crash-20260515.md`:
  a local admin that returns 500 on `/api/graphql` while `/api/health` stays 200. The 3003 server here failed on every route, so it may be a different
  fault.
- `docs/solutions/runtime-errors/tv-rctfatal-network-request-failed-admin-down-20260626.md`:
  the same "use the Mac's LAN IP" rule for a physical Apple TV.
- `docs/solutions/developer-experience/mobile-local-admin-consumer-jwt-auth-issuer-mismatch-20260812.md`:
  another feat-339 local-admin trap, on auth rather than host resolution.
