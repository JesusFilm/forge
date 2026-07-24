---
title: Deleted git worktree under a live Metro dev server produces a misleading module-resolution error
date: 2026-07-24
category: developer-experience
module: apps/tv
problem_type: developer_experience
component: development_workflow
severity: medium
root_cause: config_error
resolution_type: environment_setup
related_components:
  - apps/mobile
  - apps/tv
applies_when:
  - "Working a heavy multi-worktree workflow with several concurrent Metro dev servers, each rooted in a different `.claude/worktrees/<name>/apps/<tv|mobile>`"
  - "A worktree's PR just merged and the worktree directory was removed/pruned while its Metro dev server and the simulator's dev client were still running against it"
  - "TV or mobile LogBox shows an `Unable to resolve module` Console Error naming a transitive dependency (e.g. `@wry/equality`) inside a `.claude/worktrees/<name>/node_modules/...` path, surfacing only when a lazily-loaded screen (e.g. Search, which calls `getApolloClient()`) is opened for the first time"
symptoms:
  - 'LogBox Console Error: "Unable to resolve module @wry/equality" pointing at a path under `.claude/worktrees/<removed-worktree-name>/node_modules/.pnpm/...`'
  - "Error surfaces specifically on the Search screen, not at app launch"
  - "Call stack is `addLog -> addConsoleLog -> reactConsoleErrorHandler` plus Hermes frames: a console.error routed through LogBox, not a red-screen crash"
  - "The named missing module (`@wry/equality`, a transitive dependency of `@apollo/client`) is a red herring"
tags:
  - metro
  - expo
  - worktree
  - apollo
  - module-resolution
  - dev-client
  - node_modules
  - tvos
---

# Deleted git worktree under a live Metro dev server produces a misleading module-resolution error

## Problem

On the Apple TV 4K simulator (tvOS 26.4), the Search screen threw a red LogBox `UnableToResolveError` for `@wry/equality`, a transitive dependency of `@apollo/client`. The named module was a red herring: the real cause was that the dev client was still pointed at a Metro dev server rooted in a git worktree (`fix-tv-search-watchsearch`) that had just been removed from disk after its PR (#1701) merged.

## Symptoms

- A red **Console Error** appeared in LogBox — not a full red-screen crash — reading `Unable to resolve module @wry/equality from /Users/.../.claude/worktrees/fix-tv-search-watchsearch/node_modules/.pnpm/@apollo+client@4.1.9_.../node_modules/...`.
- The call stack was `addLog -> addConsoleLog -> reactConsoleErrorHandler` plus Hermes frames, confirming this surfaced through `console.error`/LogBox rather than an uncaught native/JS crash.
- The app kept rendering: Home continued to work normally. Only the Search screen — the first screen to actually touch Apollo Client — broke. This partial-failure shape (one feature broken, rest of the app fine) was itself a clue that the issue wasn't a global bundling failure.

## What Didn't Work

The instinctive read was to treat this as a dependency/lockfile problem: reinstall `@wry/equality`, inspect pnpm's hoisting of Apollo's transitive deps, or suspect a version mismatch in the lockfile. That framing is wrong. `@apollo/client` (declared `^4.1.4`, resolved to 4.1.9) correctly declares `@wry/equality` as a dependency, and it was installed and correctly symlinked in every live checkout on disk — there was nothing to fix in `node_modules`, the lockfile, or the package graph itself.

## Solution

No code change was needed. The fix was to relaunch the dev client against a Metro server backed by a real, still-existing checkout:

```bash
xcrun simctl openurl <sim-udid> "exp+jesus-film-forge-tv://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A<port>"
```

After relaunch, both Home and Search rendered correctly, and Search returned results as expected.

## Why This Works

Two conventions compound to make this failure lazy and localized instead of immediate and global:

- `apps/tv/CLAUDE.md` and `apps/mobile/CLAUDE.md` both mandate a lazy `getApolloClient()` getter, never a module-scope Apollo Client instantiation ("Lazy Apollo Client init: never module-scope. Use getApolloClient() getter.").
- expo-router bundles routes with `lazy=true`, so a screen's module graph is only requested from Metro the moment that screen is actually navigated to.

Together, Apollo's module graph — and everything it transitively pulls in, including `@wry/equality` — is only requested from Metro the instant the Search screen mounts. By the time that request happened, the worktree the dev client's Metro was serving from had been deleted (pruned right after PR #1701 merged), so `node_modules` underneath that Metro process's cwd was gone. Metro could no longer resolve the require and threw `UnableToResolveError` for whichever module in Apollo's dependency chain it happened to touch first — in this case `@wry/equality`. The module name is a red herring: the entire `node_modules` tree back of that Metro instance was gone, not that one package. Home never hit this because it doesn't lazily require Apollo's graph and had already been served/cached before the worktree vanished.

## Prevention

This is a structural hazard of a pnpm + Turborepo monorepo run with a heavy multi-worktree workflow — at any given time roughly 8-10 `expo start` Metro servers can be running concurrently, each rooted in a different `.claude/worktrees/<name>/apps/<tv|mobile>` on its own port, and worktrees get pruned right after their PR merges. Any dev client still pointed at a just-pruned worktree's Metro will reproduce this exact error the next time it lazily requires a module not yet bundled.

Reflex: when an `UnableToResolveError` names a path under `.claude/worktrees/<name>/`, `ls` that exact path first — before touching dependencies, lockfiles, or pnpm hoisting. If it doesn't exist, this is the bug, not a package problem.

Diagnosis recipe (minutes, not a dependency hunt):

1. Confirm the path from the error is actually gone:

   ```bash
   ls "/Users/urimchae/Documents/GitHub/forge/.claude/worktrees/<worktree-name>"
   ```

2. Find which running Metro (if any) still owns that now-deleted cwd, to rule out (or confirm) a live process wedged on a dead directory:

   ```bash
   ps -eo pid,command | grep "expo start"
   lsof -a -p <pid> -d cwd -Fn
   ```

3. Prove a healthy, live checkout actually resolves the module by bundling it directly against that Metro and grepping the output — this positively confirms the fix target before you relaunch:
   ```bash
   curl -s "http://127.0.0.1:<port>/apps/tv/src/lib/apolloClient.bundle?platform=ios&dev=true&modulesOnly=true&runModule=false" \
     -o /tmp/probe.txt -w "HTTP %{http_code}\n"
   grep -o "@wry/[a-z]*" /tmp/probe.txt | sort -u
   ```
   (Expect `@wry/caches`, `@wry/context`, `@wry/equality`, `@wry/trie` all present, with zero `UnableToResolve` lines.)

Then relaunch the dev client at the live Metro's URL via `xcrun simctl openurl` (see Solution above).

Habit to adopt going forward: **before pruning a worktree**, check whether any `expo start` process has that worktree as its cwd, and whether any simulator dev client is currently pointed at that process's port. Kill the Metro (or repoint the dev client to a live one) as part of the prune/cleanup step, rather than discovering the dangling pointer later via a misleading module-resolution error.

(auto memory [claude]) This exact incident is also captured as the machine-local memory `worktree-deleted-under-live-metro-unresolve`, confirmed 2026-07-23 after PR #1701 merged and the `fix-tv-search-watchsearch` worktree was removed — reinforcing that this is a recurring, structural class of failure in this repo's workflow, not a one-off.

## Related

- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md` — the closest sibling: how to run a dedicated Metro for a worktree and point a dev client at it. This learning is the lifecycle-end gotcha of that "own Metro" choice — what fires when the worktree is pruned but its Metro/dev-client references survive.
- `docs/solutions/developer-experience/metro-watchfolders-monorepo-refresh-storm-20260415.md` — same category and tool (Metro/watchFolders in a pnpm monorepo), different failure mode (over-broad watch scope).
- `docs/solutions/runtime-errors/metro-node-crawler-rangerror-missing-watchman-20260622.md` — shares the "a Metro/tooling problem surfaces as a misleading device-side error" shape; unrelated root cause and fix.
- `docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md` — same family (Metro resolving into pnpm's `.pnpm` store), different mechanism (duplicate React via symlink traversal).
