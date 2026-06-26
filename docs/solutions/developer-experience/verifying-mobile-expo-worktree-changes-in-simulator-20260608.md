---
title: Verifying mobile (Expo) worktree changes in the iOS simulator
date: 2026-06-08
last_updated: 2026-06-24
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Verifying apps/mobile (or apps/tv) Expo changes in the iOS simulator from a git worktree"
  - "A worktree's mobile app shows 'Search failed' or renders no data despite correct code"
  - "Another Metro is already running for the main checkout or another app"
  - "A worktree's own Metro crashes the main checkout's Metro or red-boxes the dev-client (watchman recrawl contention)"
related_components:
  - apps/tv
  - packages/admin-graphql
tags:
  - expo
  - simulator
  - metro
  - worktree
  - env
  - admin-graphql
  - idb
  - expo-go
---

# Verifying mobile (Expo) worktree changes in the iOS simulator

## Context

Mobile changes must be verified in the simulator before they're called done —
typecheck + jest are not a substitute. Doing that from a **git worktree** (the
isolated copy `ce-work`/`ce-worktree` create) hits four traps that waste a lot
of time and silently produce a wrong or stale verification:

1. A fresh worktree has **no `.env.local`** (it's gitignored, so it isn't copied
   into the worktree), and the one in the main checkout points at the **retired
   Strapi endpoint**. The app then can't reach a backend — search fails.
2. A Metro is usually already running for the main checkout (and another for the
   TV app), so naively starting Metro collides on ports or, worse, you verify
   the wrong checkout's code.
3. Editing a file does **not** reliably hot-apply to an already-loaded Expo Go
   bundle — you can stare at stale UI and conclude your change didn't work.
4. Driving the sim with `idb` taps on virtualized lists (FlashList, grids,
   formSheet rows) is flaky, so a "the button doesn't do anything" reading is
   often a missed tap, not a bug.

## Prerequisites

Before any of this, **watchman must be installed** (`brew install watchman`).
Without it, Metro falls back to a node crawler that crashes with `RangeError:
Invalid string length` on a monorepo this large — intermittently, so a first
`expo start` may succeed and a later one won't. The crash also masquerades as a
device-side ngrok/connect error when Metro runs behind a tunnel. See
`docs/solutions/runtime-errors/metro-node-crawler-rangerror-missing-watchman-20260622.md`,
which also explains why a `--tunnel` Metro forces even a localhost-connected
simulator to fetch its bundle through the tunnel (run plain-localhost Metro for
sim work, as this guide does).

## Guidance

### 1. Point the worktree at the running admin, not stale Strapi

The mobile app resolves its GraphQL endpoint in `apps/mobile/src/lib/config.ts`
via `getGraphQLUrl()` → `env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL ?? DEFAULT_…`. The
**`EXPO_PUBLIC_GRAPHQL_URL_IOS=http://localhost:1337/graphql`** you'll see in the
main checkout's `.env.local` is the **retired Strapi CMS** endpoint and is a red
herring — the app no longer reads it. Symptom of getting this wrong:
**"Search failed. Please try again."** (search needs a live admin; many other
reads are anonymous-public and may still render, masking the problem).

Fix — set the admin endpoint in the worktree's `.env.local`, then restart Metro:

```bash
# admin dev server runs on :3003 (pnpm --filter @forge/admin dev)
printf '\nEXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://127.0.0.1:3003/api/graphql\n' \
  >> apps/mobile/.env.local
```

Use `127.0.0.1`, **not** `localhost` — `localhost` loops through admin's
auth-host proxy. `EXPO_PUBLIC_*` vars are inlined by Metro at bundle time, so a
shell `export` won't take effect and Metro must be **restarted** to pick up the
edit. (This same `:1337` → `:3003` trap exists on `apps/tv` — it generalizes to
both Expo apps.) (auto memory [claude])

The canonical local admin port is `:3003` — admin's `pnpm dev` binds it
(hardcoded in `apps/admin/package.json`), and `apps/mobile/.env.example` /
`.env.ci` point there too.

### 2. Verify the worktree non-disruptively with a second Metro

The installed iOS build (`org.jesusfilm.forgewatch`) is a **debug build
hardcoded to Metro on `:8081`** — it can only show the main checkout. To run the
_worktree's_ code without killing the main checkout's Metro, use **Expo Go +
its own Metro on a free port** (Expo Go is also installed on the sim):

```bash
# main checkout owns 8081, the TV app owns 8082 — pick a free port
cd apps/mobile && npx expo start --port 8090
# load THIS bundle in Expo Go (iPhone udid from `xcrun simctl list devices booted`)
xcrun simctl openurl <iphone-udid> "exp://127.0.0.1:8090"
```

This leaves the user's main (8081) and TV (8082) Metros untouched. When done,
`xcrun simctl openurl <udid> "exp://127.0.0.1:8081"` restores Expo Go to the
main checkout.

### 2b. A worktree's Metro needs its OWN node_modules — don't symlink to main

Section 2 assumes the worktree has its own installed `node_modules` (`pnpm
install` ran there). `EnterWorktree` / a bare `git worktree add` does **not**
install, so a worktree under `.claude/worktrees/` starts with none. **Do not**
shortcut that by symlinking the worktree's `node_modules` to the main checkout's:
the worktree's Metro then resolves through the symlink, ends up watching the
**entire main repo tree**, and the resulting `watchman` recrawl contends with the
main checkout's already-running Metro. Observed failure — the main checkout's
`:8082` Metro **crashes** and the tvOS dev-client red-boxes (`RCTFatal`), while the
worktree's Metro logs `Recrawled this watch N times`. (Symlinked `node_modules` is
fine for a one-off `tsc`/`eslint` pass; it's running a second **Metro** through it
that triggers the watch contention.)

**Two distinct `RCTFatal` causes — don't conflate them.** This one is a _Metro/watch_
failure (symlinked `node_modules` -> cross-tree watch contention). A different
`RCTFatal` with an identical all-native overlay comes from the _backend being down_:
when local admin (`:3003`) is unreachable, the dev-client's GraphQL fetch escalates
`Network request failed` to a fatal, and it persists via a wedged dev client + stale
Metro cache (fix: restart admin + Metro `--clear` + reload). See
`docs/solutions/runtime-errors/tv-rctfatal-network-request-failed-admin-down-20260626.md`.

Two ways out, preferred order:

1. **Real install in the worktree** — `pnpm install` there so it has isolated
   `node_modules` and its own watch scope, then run its Metro on a free port per
   section 2. Heaviest, but the clean isolation the second-Metro approach needs.
2. **Mirror to the primary checkout (best for JS/style-only changes)** — keep the
   canonical work on the worktree **branch**, but apply the same changed files in
   the **primary checkout** and verify against its already-running Metro. The
   dev-client reads the primary checkout's Metro, so a Fast-Refresh/reload there
   shows the change with zero new Metro and zero watchman contention. Revert the
   mirror only after review (the "keep the main mirror applied" pattern).

Applies to the TV dev-client (`org.jesusfilm.forgetv`, route deep-links like
`exp+jesus-film-forge-tv:///watch/<slug>`) the same as to mobile's Expo Go.

### 3. Force a full reload — fast-refresh lies

A style/JS edit often does **not** apply to an already-loaded Expo Go bundle
(an incremental `Bundled … (1 module)` may not re-render the mounted tree).
Force a clean reload and **confirm a full ~2386-module rebundle** in the Metro
log before trusting the screen:

```bash
# restart Metro fresh, then relaunch Expo Go (don't just openurl an already-open app)
npx expo start --port 8090 --clear
xcrun simctl terminate <udid> host.exp.Exponent
xcrun simctl openurl <udid> "exp://127.0.0.1:8090"
# wait for: iOS Bundled NNNNms ... (2386 modules)   <- full, not "(1 module)"
```

### 4. Drive + measure with idb (taps are flaky; measure to confirm)

`idb ui tap` on a virtualized list row (FlashList, the episode grid, formSheet
rows) frequently doesn't register. **Retry until confirmed** via the a11y tree,
and **measure rendered geometry** to prove a style change landed instead of
eyeballing a screenshot:

```bash
# get exact tap coords from labels, not pixel guesses
idb ui describe-all --udid <udid>   # → AXLabel + frame for each element
# tap, then VERIFY navigation/state via describe-all before screenshotting
# confirm a font-size change applied by comparing frame heights:
#   "Videos" h=17 (body) -> h=32 (titleLarge), matching the page title
```

## Why This Matters

Three of these are invisible to typecheck/lint/jest and to a casual screenshot:
a worktree that silently talks to a dead Strapi endpoint, a fast-refresh that
shows stale UI, and an idb tap that quietly misses. Each one produces a
_confident wrong conclusion_ ("search is broken", "my change didn't work", "the
button is dead") that costs a debugging detour. The endpoint trap in particular
had only ever lived as a per-app MEMORY note; capturing the worktree workflow
here makes the whole verification loop reproducible for the next person.

## When to Apply

- Before reporting any `apps/mobile` (or `apps/tv`) change as done — the
  standing "verify in the simulator" rule, executed from a worktree.
- Whenever a worktree's app shows no data / "Search failed" despite correct code.
- Whenever an on-disk change refuses to appear in the running Expo Go app.

## Examples

End-to-end, the loop that verified the series detail page from a worktree:

```bash
# 1. endpoint
printf '\nEXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://127.0.0.1:3003/api/graphql\n' >> apps/mobile/.env.local
# 2. second Metro (free port) + Expo Go
cd apps/mobile && npx expo start --port 8090 --clear &
xcrun simctl terminate <udid> host.exp.Exponent
xcrun simctl openurl <udid> "exp://127.0.0.1:8090"     # wait for full 2386-module bundle
# 3. drive + verify
idb ui describe-all --udid <udid> | grep -i <label>    # exact coords
idb ui tap --udid <udid> <x> <y>                       # retry until describe-all confirms
# 4. confirm + restore
xcrun simctl openurl <udid> "exp://127.0.0.1:8081"     # back to main checkout
```

A real catch from this loop: the admin search returned data only after the
`:3003` endpoint was set, and the series page rendered a poster (no player)
exactly because the series had 0 playable trailer dubs — both facts were
invisible without the running backend.

## Related

- `docs/solutions/architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md`
  — the Strapi → admin cutover that introduced `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`
  (root cause of trap #1). Its "production default fallback" is a _prod_ URL —
  locally you still must override to `127.0.0.1:3003`.
- `docs/solutions/mobile/expo-env-file-handling.md` — `.env.local` priority +
  Metro-inlining mechanics. Note: its `…:1337/graphql` examples are
  **pre-cutover**; the live var is `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`.
- `docs/solutions/best-practices/mobile-video-detail-page-patterns-20260527.md`
  — earlier (buried) record of the `127.0.0.1:3003` + search-needs-bearer fact.
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`
  — `xcrun simctl openurl` deep-link precedent (TV side).
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`
  — the web (Chrome MCP) analog of "measure rendered geometry to confirm a style
  change applied"; idb is the RN/simulator equivalent.
- `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md`
  — the diagnosis-side companion: this doc reads the live a11y tree to _verify_
  UI; that one reads the on-disk app container (AsyncStorage / `documentDirectory`)
  to _diagnose_ persisted state and native events when `console.log` is dead.
