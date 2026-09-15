---
title: Verifying mobile (Expo) worktree changes in the iOS simulator
date: 2026-06-08
last_updated: 2026-09-11
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Verifying an apps/mobile (or apps/tv) Expo change in a simulator from a git worktree"
  - "Pointing an installed Expo dev client at a different Metro without a new native build"
  - "A worktree app renders no data, or shows 'Search failed. Please try again.'"
  - "Another Metro already runs for the main checkout or for apps/tv"
  - "A worktree Metro crashes the main checkout Metro, or red-boxes the dev client (watchman recrawl contention)"
  - "Verifying an apps/tv change that touches a platform-branched value (scale(IS_ANDROID ? 48 : 28), Platform.select) on the Apple TV simulator only"
related_components:
  - apps/tv
  - packages/admin-graphql
tags:
  - expo
  - expo-dev-client
  - simulator
  - metro
  - worktree
  - deep-link
  - env
  - idb
  - android-tv
---

# Verifying mobile (Expo) worktree changes in the iOS simulator

## Context

You must verify an `apps/mobile` change in a simulator before you report it as
done. A typecheck and a jest run do not replace that check. You usually run the
check from a **git worktree**, the isolated copy that `ce-work` and
`ce-worktree` create. A worktree adds five traps. Each trap gives you a
confident wrong answer instead of an error.

1. A fresh worktree has **no `.env.local`**. The file is gitignored, so
   `git worktree add` does not copy it. The consumer bearer is then absent, and
   the device falls into a coarse shared rate-limit bucket.
2. **Expo Go cannot load this app.** `apps/mobile` depends on native modules
   that Expo Go does not ship. You must use a dev-client build.
3. A Metro server usually runs already for the main checkout, and often a
   second one for `apps/tv`. A new Metro can collide on a port, or can show you
   the wrong checkout's code.
4. An edit does not reliably reach a bundle that the device already loaded.
   Fast refresh lies, and a relaunch can serve a cached bundle.
5. An `idb` tap on a virtualized list misses often. A dead button is then a
   missed tap, not a defect.

## Guidance

### 0. Install watchman first

Run `brew install watchman` before anything else. Without watchman, Metro falls
back to a node crawler. That crawler throws `RangeError: Invalid string length`
on a monorepo this large. The crash is intermittent, so a first `expo start`
can succeed and a later one can fail. The crash also looks like a device-side
ngrok error when Metro runs behind a tunnel. See
`docs/solutions/runtime-errors/metro-node-crawler-rangerror-missing-watchman-20260622.md`.
That document also explains why a `--tunnel` Metro forces even a
localhost-connected simulator to fetch the bundle through the tunnel. Run a
plain-localhost Metro for simulator work, as this guide does.

### 1. Seed the environment with `scripts/setup-sim-env.sh`

`apps/mobile/CLAUDE.md` makes this the mandatory first step:

```bash
bash scripts/setup-sim-env.sh mobile
```

The script is idempotent, and it validates its argument
(`usage: scripts/setup-sim-env.sh <tv|mobile>`). It seeds
`apps/mobile/.env.local` from the main checkout, and it guarantees
`EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`, the `WatchSearch`-scoped consumer bearer.
Without that token the device drops into admin's coarse per-IP rate-limit
bucket. The canonical alternative is
`pnpm --filter @forge/mobile fetch-secrets`, which pulls the full environment
from Doppler.

The script **strips** `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` on purpose. Its own
comment gives the reason: copying the endpoint spread whatever the main
checkout happened to carry into every new worktree, "which is how a session
ends up on production admin without deciding to."

**A development bundle needs no endpoint.** `apps/mobile/src/lib/adminEndpoint.ts`
sets `LOCAL_ADMIN_GRAPHQL_URL = "http://localhost:3003/api/graphql"`, and a
development bundle defaults to it with no env file. A fresh worktree is already
pointed at local admin. `decideAdminEndpointAccess` refuses to start a
development bundle that resolves to `admin.jesusfilm.org`, so the wrong
endpoint fails loudly instead of writing into the production database.

**Put a per-machine override in `apps/mobile/.env.development.local`, never in
`.env.local`.** `adminEndpoint.ts` names that file in
`PER_MACHINE_ENV_FILE`. The `fetch-secrets` script is
`rm -f .env && doppler secrets download … > .env.local.tmp && mv .env.local.tmp .env.local`,
so it replaces `.env.local` whole and drops any line you add by hand. Use the
per-machine file for a LAN address on a physical device, or for a tunnel:

```bash
# APPEND. This file is hand-maintained and usually already holds commented
# alternatives (local, production opt-in, LAN) — `>` would destroy them.
echo 'EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://192.168.1.20:3003/api/graphql' \
  >> apps/mobile/.env.development.local
```

Only one uncommented assignment of a key takes effect, so comment out the
previous one rather than leaving two live. Restart Metro after any edit here:
Expo inlines `EXPO_PUBLIC_*` at bundler startup.

Three further facts about the endpoint:

- `localhost` and `127.0.0.1` both work. `REWRITABLE_LOOPBACK_HOSTS` holds
  both, so both rewrite to `10.0.2.2` on the Android emulator. The in-code
  default is `localhost`. The old auth-host-proxy warning no longer
  reproduces.
- Admin on `:3003` is real, not a convention. `apps/mobile/.env.ci` pins
  `EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql`, and
  admin's `pnpm dev` binds that port.
- Metro inlines every `EXPO_PUBLIC_*` value at bundler startup. A shell
  `export` does nothing, and a reload picks up nothing. **Cold-restart Metro**
  after any environment change.

Caution about dead Strapi keys: the main checkout's `.env.local` still carries
`EXPO_PUBLIC_GRAPHQL_URL_IOS` and `EXPO_PUBLIC_STRAPI_TOKEN`, because Doppler
`forge-mobile/dev` still holds them. `scripts/setup-sim-env.sh` copies them
into the worktree. They are harmless: `apps/mobile/src/env.ts` reads neither.
Do not treat `…:1337/graphql` as the endpoint under test, and do not add it.

Symptom of an unreachable backend: **"Search failed. Please try again."** from
`apps/mobile/src/lib/watchSearch.ts`, plus an
`[admin-endpoint] admin_endpoint.unreachable=true` console line, plus a Home
screen that shows its frozen fallback. Many other reads are anonymous and
public, so they can still render and mask the problem.

### 2. Re-point the dev client at the worktree's Metro

`apps/mobile` cannot run in Expo Go. Its manifest declares
`expo-dev-client@~57.0.18`, `react-native-google-cast@4.9.1`,
`@kesha-antonov/react-native-background-downloader@^4.5.5`,
`@datadog/mobile-react-native@3.5.4`,
`@datadog/mobile-react-native-session-replay@3.5.4`,
`expo-glass-effect@~57.0.2`, and `react-native-webview@13.16.1`. Expo Go ships
none of them. `apps/tv/CLAUDE.md` states the same rule for TV: "Dev-client
builds only (no Expo Go on TV)."

The installed dev client is **not** locked to one Metro. It re-points by deep
link, with no new native build. `apps/mobile/ios/forgewatch/Info.plist`
registers three URL schemes: `forgemobile`, `org.jesusfilm.forgewatch`, and
`exp+jesus-film-forge-v2`.

```bash
# main checkout owns 8081, apps/tv owns 8082 — pick a free port
cd apps/mobile && npx expo start --port 8090
# re-point the installed dev client (udid from `xcrun simctl list devices booted`)
xcrun simctl openurl <iphone-udid> \
  'forgemobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8090'
```

The `exp+` form takes the **slug**, never the `scheme`. `apps/mobile/app.json`
sets `"slug": "jesus-film-forge-v2"` and `"scheme": "forgemobile"`, so
`exp+jesus-film-forge-v2://expo-development-client/?url=…` also works, and
`exp+forgemobile://` is unregistered and opens nothing at all. Two other
documents re-point a dev client the same way:
`docs/solutions/runtime-errors/metro-node-crawler-rangerror-missing-watchman-20260622.md`
for mobile, and
`docs/solutions/developer-experience/deleted-worktree-under-live-metro-unresolve-error.md`
for TV.

This leaves the main checkout's Metro and the TV Metro alive. When you finish,
send the same deep link with `%3A8081` to return the dev client to the main
checkout.

`apps/tv` works the same way with its own identity. `apps/tv/app.json` sets
`"slug": "jesus-film-forge-tv"`, `"scheme": "org.jesusfilm.forgetv"`, and
`"bundleIdentifier": "org.jesusfilm.forgewatch"`, so both
`exp+jesus-film-forge-tv://` and `org.jesusfilm.forgetv://` reach the TV dev
client.

**Ports are convention, not contract.** `:8081` for the mobile main checkout,
`:8082` for `apps/tv`, and a free port such as `:8090` for a worktree are
habits only. No repo file pins them.
`scripts/check-dev-port-contract.mjs` covers devcontainer service ports
(3000–4111, and 2222) and says nothing about Metro. Do not hunt for the pin.

**Native-resource trap.** `expo run:ios` skips prebuild when
`apps/mobile/ios/` already exists, and `apps/mobile/ios/` is untracked
generated output. After a pull that brings in a new native resource, run
`pnpm --filter @forge/mobile exec expo prebuild --platform ios` in that
checkout. Otherwise the resource stays out of that checkout's builds.

### 3. A worktree's Metro needs its own `node_modules`

Section 2 assumes that `pnpm install` ran in the worktree. `EnterWorktree` and
a bare `git worktree add` do not install, so a worktree under
`.claude/worktrees/` starts with none. **Do not** symlink the worktree's
`node_modules` to the main checkout's. The worktree Metro then resolves through
the symlink, watches the **whole main repo tree**, and its watchman recrawl
contends with the Metro that already runs there. Observed failure: the main
checkout's `:8082` Metro **crashes**, the tvOS dev client red-boxes
(`RCTFatal`), and the worktree Metro logs `Recrawled this watch N times`. A
symlink is fine for a one-off `tsc` or `eslint` pass. A second **Metro** through
it is what causes the contention.

**Two distinct `RCTFatal` causes — do not conflate them.** This one is a Metro
and watch failure. A different `RCTFatal` with an identical all-native overlay
comes from a backend that is down: when local admin (`:3003`) is unreachable,
the dev client's GraphQL fetch escalates `Network request failed` to a fatal,
and a wedged dev client plus a stale Metro cache keeps it there. The fix there
is to restart admin, restart Metro with `--clear`, and reload. See
`docs/solutions/runtime-errors/tv-rctfatal-network-request-failed-admin-down-20260626.md`.

Two ways out, in preferred order:

1. **Install in the worktree.** Run `pnpm install` there. The worktree then has
   isolated `node_modules` and its own watch scope. Run its Metro on a free
   port, per section 2. This is the heaviest option and the clean one.
2. **Mirror to the primary checkout**, which suits a JS-only or style-only
   change. Keep the canonical work on the worktree **branch**, apply the same
   changed files in the primary checkout, and verify against the Metro that
   already runs there. No new Metro starts, and no watch contention happens.
   Revert the mirror only after review.

**Lifecycle-end gotcha for option 1.** If somebody prunes the worktree while a
dev client still points at its Metro, the next lazily-required module throws a
misleading `UnableToResolveError` that names an arbitrary transitive
dependency. The whole `node_modules` tree under the deleted worktree is gone,
not that one package. See
`docs/solutions/developer-experience/deleted-worktree-under-live-metro-unresolve-error.md`.

### 4. Force a full reload — fast refresh lies

A JS or style edit often does not apply to a bundle that the device already
loaded. A force-stop and a relaunch also do not prove a refetch: the dev client
can come back on a cached bundle, and Metro then logs no new `Bundled` line.
Prove both halves.

```bash
# Metro-side truth: the served bundle contains your edit
curl -s "http://localhost:8090/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false" \
  | grep -c "<a literal your edit introduced>"
# device-side truth: force connected clients to refetch and remount
curl -s -X POST http://localhost:8090/reload
```

When you need a cold start instead, restart Metro with `--clear` and re-send
the deep link:

```bash
npx expo start --port 8090 --clear
xcrun simctl openurl <iphone-udid> \
  'forgemobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8090'
```

Wait for a full rebundle in the Metro log, not `(1 module)`, before you trust
the screen.

### 5. Drive and measure with idb

An `idb ui tap` on a virtualized row (FlashList, the episode grid, a formSheet
row) often does not register. **Retry until the accessibility tree confirms the
result.** Measure rendered geometry to prove that a style change landed. Do not
judge it from a screenshot.

```bash
# get exact tap coords from labels, not pixel guesses
idb ui describe-all --udid <udid>   # AXLabel + frame for each element
# tap, then verify navigation or state via describe-all before screenshotting
# confirm a font-size change by comparing frame heights:
#   "Videos" h=17 (body) -> h=32 (titleLarge), matching the page title
```

### 6. For `apps/tv`, the Apple TV simulator is one of two targets

`apps/tv` runs on Apple TV (tvOS) and on Android TV, and its layout values are
often **platform-branched**: `scale(IS_ANDROID ? 48 : 28)`, `Platform.select`,
`Platform.OS`. `scale()` is a no-op on tvOS but shrinks on Android. A change
that you verify on the **Apple TV simulator** only exercises one branch. The
Android branch can be wrong from day one, and nothing flags it.

Two ways to cover the Android branch, in preferred order:

1. **Make divergence structurally impossible.** When a skeleton or placeholder
   mirrors a real component, import that component's exported geometry constant
   instead of copying the value. Both surfaces then read the same branch. See
   `docs/solutions/design-patterns/mirror-ui-derive-geometry-from-shared-constants.md`.
2. **Check the divergent branch on an Android TV target.** When a value must
   branch independently, run it on an Android TV emulator too.

Motivating catch: a Home loading skeleton hardcoded `scale(28)` for the card
gap, while the real rail used `scale(IS_ANDROID ? 48 : 28)`. The placeholder
reflowed at the loading-to-content handoff on **Android TV only**. Apple TV
simulator verification never surfaced it, because tvOS was the branch that
happened to match.

## Why This Matters

Four of these traps are invisible to typecheck, lint, jest, and a casual
screenshot: a missing consumer bearer, a dev client still bound to another
checkout's Metro, a cached bundle behind a fast refresh, and an `idb` tap that
misses. Each one produces a confident wrong conclusion — "search is broken",
"my change did not work", "the button is dead" — and each conclusion costs a
debugging detour. The env step in particular lived only in a per-app memory
note for months. Writing the whole loop down makes it reproducible for the next
person.

## When to Apply

- Before you report any `apps/mobile` or `apps/tv` change as done. This is the
  standing "verify in the simulator" rule, run from a worktree.
- Whenever a worktree app shows no data, or shows "Search failed. Please try
  again.", although the code is correct.
- Whenever an on-disk change refuses to appear in the running dev client.
- Whenever you must show a worktree's code without disturbing the Metro server
  that the main checkout uses.
- Before you report an `apps/tv` change that touches a platform-branched value
  (`IS_ANDROID ? …`, `Platform.select`). The Apple TV simulator covers one
  branch.

## Examples

End-to-end, the loop that verifies a worktree change on the iOS simulator:

```bash
# 0. install once
brew install watchman
# 1. environment (idempotent; seeds the consumer bearer, omits the endpoint)
bash scripts/setup-sim-env.sh mobile
# 2. the worktree's own Metro on a free port
cd apps/mobile && pnpm install && npx expo start --port 8090 --clear
# 3. re-point the installed dev client at it
xcrun simctl openurl <iphone-udid> \
  'forgemobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8090'
# 4. prove the edit reached the device
curl -s "http://localhost:8090/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false" \
  | grep -c "<a literal your edit introduced>"
curl -s -X POST http://localhost:8090/reload
# 5. drive and verify
idb ui describe-all --udid <iphone-udid> | grep -i <label>
idb ui tap --udid <iphone-udid> <x> <y>     # retry until describe-all confirms
# 6. restore the dev client to the main checkout
xcrun simctl openurl <iphone-udid> \
  'forgemobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
```

A real catch from this loop: a series page rendered a poster and no player,
exactly because the series had 0 playable trailer dubs. That fact was invisible
without a running local admin.

## Related

- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`
  — the native-artifact half of this loop. Prove that the `.app` on the device
  came from this checkout before you diagnose a defect.
- `docs/solutions/developer-experience/expo-dev-client-cached-bundle-verification.md`
  — the two curl probes in section 4. They prove that Metro serves your edit,
  and they force a refetch.
- `docs/solutions/developer-experience/deleted-worktree-under-live-metro-unresolve-error.md`
  — a live Metro whose backing worktree was pruned, plus a worked deep-link
  re-point.
- `docs/solutions/runtime-errors/metro-node-crawler-rangerror-missing-watchman-20260622.md`
  — the missing-watchman crash, the tunnel-versus-localhost split, and another
  worked deep-link re-point.
- `docs/solutions/runtime-errors/tv-rctfatal-network-request-failed-admin-down-20260626.md`
  — the other `RCTFatal`, caused by an unreachable local admin.
- `docs/solutions/architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md`
  — the Strapi to admin cutover that introduced
  `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`.
- `docs/solutions/mobile/expo-env-file-handling.md` — `.env.local` priority and
  Metro inlining mechanics. Its `…:1337/graphql` examples are pre-cutover.
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`
  — the `xcrun simctl openurl` deep-link precedent on the TV side.
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`
  — the web analog of "measure rendered geometry to confirm a style change".
  `idb` is the simulator equivalent.
- `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md`
  — the diagnosis-side companion. This document reads the live accessibility
  tree to verify UI. That one reads the on-disk app container to diagnose
  persisted state.
- `docs/solutions/design-patterns/mirror-ui-derive-geometry-from-shared-constants.md`
  — the structural fix for the section 6 platform-branch trap.
