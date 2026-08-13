---
title: "pnpm optional-peer borrowing silently re-keys a sibling app's lockfile graph"
date: "2026-08-13"
category: "architecture-patterns"
module: "pnpm workspace optional peer dependency resolution"
problem_type: architecture_pattern
component: tooling
severity: high
symptoms:
  - "pnpm-lock.yaml peer suffixes for @expo/metro-runtime and react-native-safe-area-context in apps/tv silently re-keyed to mobile's new SDK 57 versions, with zero files changed under apps/tv"
  - "the plan's scope gate (git diff main -- apps/tv) stayed empty even though a fresh install would load SDK 57 metro-runtime into a react-native-tvos 0.81 bundle"
  - "ESLint 9 flat config threw ConfigError - Config next/typescript, Key plugins, Cannot redefine plugin @typescript-eslint"
  - "five CI lint jobs (admin, auth, manager, mastra-gateway, chat) failed after only apps/mobile's typescript version changed"
  - "no pnpm install error surfaced despite two workspace apps silently borrowing another app's resolved optional peer instance"
root_cause: config_error
resolution_type: dependency_update
applies_when:
  - "auditing a workspace app's blast radius after bumping another app's expo, react-native, or typescript version in a pnpm monorepo"
  - "an importer relies on an optional peer dependency it never declares directly in its own package.json"
  - "a change-scope gate compares only source-tree diffs (git diff -- <app-dir>) and ignores the shared lockfile"
related_components:
  - "apps/tv"
  - "apps/mobile"
  - "root package.json"
  - "eslint-config-next"
tags:
  - pnpm
  - peer-dependencies
  - lockfile
  - monorepo
  - expo
  - typescript-eslint
  - dependency-resolution
  - workspace
---

# pnpm optional-peer borrowing silently re-keys a sibling app's lockfile graph

## Problem

pnpm resolves an OPTIONAL peer dependency (one a package `peerDependenciesMeta`
marks `optional: true`, such as `expo-router`'s peer on `@expo/metro-runtime`)
against whatever matching instance already exists in the workspace graph. An
importer that never declares the package in its own `package.json` still gets
one — pnpm picks it up from a sibling workspace app that happens to need the
same peer. Two consequences follow from this, and both hit
`apps/mobile`'s Expo SDK 54 to 57 upgrade (PR #1926, unmerged as of this
writing):

1. An app can silently resolve a STALE instance of a peer it never declared,
   because pnpm reuses an existing graph entry instead of resolving fresh for
   the app's own dependency set.
2. When the owning app bumps its own version of that peer, every OTHER
   importer that was silently borrowing the old instance gets re-keyed to the
   new one — with no line changed in the borrower's own `package.json` or
   source tree.

The upgrade hit both directions of the same mechanism in sequence, on the
same package (`@expo/metro-runtime`).

## Symptoms

**A — direction 1, mobile silently borrowed TV's stale instance.** Partway
through the SDK 57 checkpoints, `expo-doctor@1.20.1` (made a blocking CI job
in this PR — `.github/workflows/ci.yml:256-274`) flagged a real defect on
`apps/mobile`: pnpm satisfied expo-router's optional `@expo/metro-runtime`
peer with the TV app's stale 6.1.2 instance ("expo-router should install
@expo/metro-runtime@^57.0.9, but 6.1.2 is installed"). Mobile's own
`expo-router` needed the SDK-57-compatible metro-runtime, but the resolver
handed it a leftover 6.1.2 snapshot because that instance was already present
in the graph from the pre-upgrade shared resolution. The fix was to pin
`"@expo/metro-runtime": "~57.0.9"` directly in `apps/mobile/package.json`.

**B — direction 2, that fix re-keyed apps/tv.**
`apps/tv/package.json` never declares `@expo/metro-runtime` or
`react-native-safe-area-context` (verified: `git show main:apps/tv/package.json`
has neither in `dependencies`, and TV is still on Expo SDK 54 —
`"expo": "~54.0.33"`). Once mobile's pin landed, pnpm's optional-peer
resolution for TV's `expo-router` (`main` field
`"expo-router/entry"`, so it is the very first module TV's bundle imports)
picked up mobile's new SDK 57 instances instead of the old shared ones. The
flip, captured mid-upgrade (after mobile's pin, before the TV fix — this
intermediate state exists only in the PR branch's own history):

```
# before (matches main):
expo@54.0.34(@babel/core@8.0.1)(@expo/metro-runtime@6.1.2)(...)(typescript@5.9.3):
react-native-safe-area-context@5.6.2(react-native-tvos@0.81.5-2)(react@19.1.0):

# after mobile's pin, before the TV fix:
expo@54.0.34(@babel/core@7.29.0)(@expo/dom-webview@55.0.6)(@expo/metro-runtime@57.0.9)(...)(typescript@5.9.3):
react-native-safe-area-context@5.7.0(react-native-tvos@0.81.5-2)(react@19.1.0):
```

A fresh install at that point would have put the SDK 57 `@expo/metro-runtime`
runtime at the top of every TV bundle on `react-native-tvos` 0.81, and
`react-native-safe-area-context` (a native module) would have moved
5.6.2 to 5.7.0 — none of it visible in a diff of `apps/tv/` source, because
no `apps/tv/` source file changed.

**The scope gate was structurally blind to this.** The plan's TV-untouched
check was `git diff main -- apps/tv` (empty). That gate proves no TV _file_
changed; it cannot see that TV's _resolved dependency graph_ moved, because
the graph lives in the shared root `pnpm-lock.yaml`, not under `apps/tv/`.

**C — a second instance of the same mechanism, on `typescript`.** Root
`package.json` declares `typescript-eslint: ^8.56.0` but no `typescript` of
its own (confirmed: `git show main:package.json` has `typescript-eslint` in
root `devDependencies` with no sibling `typescript` entry). Its peer floats.
When mobile added `"typescript": "~6.0.3"` for SDK 57, the floating root peer
re-keyed: the pre-fix lockfile shows `typescript-eslint@8.56.0` resolved
TWICE in the same lockfile — once against `(typescript@5.9.3)` (the instance
`eslint-config-next`'s inner `@typescript-eslint` parser still used) and once
against `(typescript@6.0.3)` (the instance mobile's new pin produced).
ESLint 9's flat config treats two resolved instances of the same plugin name
as a redefinition. The pre-fix CI run failed exactly that way, in five lint
jobs: `@forge/admin`, `@forge/auth`, `@forge/manager`, `@forge/mastra-gateway`,
and `@forge/chat`. Every one logs the same line:

```
ConfigError: Config "next/typescript": Key "plugins": Cannot redefine plugin "@typescript-eslint".
    at rethrowConfigError (.../@eslint+config-array@0.21.1/node_modules/@eslint/config-array/dist/cjs/index.cjs:343:8)
```

(All five jobs share `next/typescript` via `eslint-config-next`; that is why
they and only they failed.) Reproducible locally with
`pnpm --filter @forge/admin lint`.

## What Didn't Work

- **File-scope diffing as a safety gate.** `git diff main -- apps/tv` stayed
  empty through the whole sequence above, including while TV's resolved
  graph was actively wrong. A gate scoped to one app's directory cannot see
  a shared lockfile's peer-suffix movement — the two live in different
  files.
- **Whack-a-mole pinning.** The first protective pin
  (`apps/mobile`'s own `@expo/metro-runtime ~57.0.9`, added to satisfy
  the expo-doctor finding) is the SAME change that broke the next
  borrower (TV). Fixing one importer's borrowed-stale-instance problem
  exposed a second importer's borrowed-instance problem one layer over. The
  pattern was only named — "each importer must own its instance
  explicitly" — after the second occurrence, not predicted from the first.
- **A reviewer claim that turned out to need an experiment, not inspection.**
  A separate review finding claimed the mobile jest config's
  `moduleNameMapper` react pins were "never exercised." That claim was
  empirically refuted, not argued away: removing the pins failed 104 of 108
  test suites (verified twice, independently, per the PR description).
  Distinguishing load-bearing config from dead config required running the
  removal, not reading the file.

## Solution

One pattern, three pins. Each importer that relies on a peer it never
declares gets an explicit direct dependency, pinned to the exact version
`main`'s lockfile had already resolved for it — verified against
`git show main:pnpm-lock.yaml` before picking the number:

**1. `apps/mobile/package.json`** (own the SDK 57 instance mobile actually
needs; added via `npx expo install @expo/metro-runtime`):

```json
"@expo/metro-runtime": "~57.0.9"
```

**2. `apps/tv/package.json`** (restore the SDK 54 instances main resolved):

```json
"@expo/metro-runtime": "~6.1.2",
"react-native-safe-area-context": "~5.6.2"
```

**3. Root `package.json` `devDependencies`** (restore the instance the
shared lint toolchain resolved on main):

```json
"typescript": "~5.9.3"
```

Confirmed post-fix: `pnpm-lock.yaml` now resolves
`react-native-safe-area-context@5.6.2(react-native-tvos@0.81.5-2)(react@19.1.0)`
— byte-identical to the key on `main` — and `typescript-eslint@8.56.0` now
resolves against `(typescript@5.9.3)` only, with no second
`(typescript@6.0.3)` copy of the same plugin in the graph. All five
previously-red lint jobs pass locally after fix 3
(`pnpm --filter @forge/admin lint`, etc.); TV's suite passed 1675 green after
fix 2.

**Cleanup pass.** A follow-up `pnpm dedupe` pruned most of the orphaned
Expo-57 snapshot universe the pre-fix resolution had left behind in the
lockfile: net -742 lines. One smaller family —
`expo@57.0.12(@babel/core@8.0.1)(react@19.2.4)` and its dependents —
survives dedupe because pnpm still finds it reachable from some workspace
path. It is inert lockfile weight, not a correctness issue: no importer
installs it.

**Accepted residual, deliberately not chased further.** TV's `expo@54.0.34`
key still differs from `main` in two respects after both protective pins
land: `@babel/core` keys `7.29.0` where `main` had `8.0.1` (build-time
toolchain, and `7.29.0` is what `babel-preset-expo@54` actually targets —
pinning it back would fight the resolver rather than match it), and
`@expo/dom-webview@55.0.6` now appears in the key's optional-peer suffix as
an inert resolved-but-unused peer under TV's SDK 54 classic autolinking.
The PR documents this explicitly rather than silently accepting it.

## Why This Works

pnpm resolves an optional or floating peer against whatever instance is
already reachable in the graph — it does not derive the resolution purely
from the requesting importer's own declared dependencies. An explicit direct
dependency in the importer's OWN `package.json` removes the ambiguity: that
importer now has a concrete version requirement of its own, so pnpm resolves
it independently instead of reusing a sibling's snapshot. Two apps can then
own DIFFERENT versions of the same package and coexist in one lockfile
without either borrowing from the other — confirmed in the final state,
where `apps/mobile` resolves `@expo/metro-runtime@57.0.9` and `apps/tv`
resolves `@expo/metro-runtime@6.1.2`, each keyed separately, with no
crossover.

## Prevention

- **When one workspace app bumps a widely-shared dependency generation**
  (an SDK upgrade, a major-version bump of a package many apps depend on
  transitively), diff the OTHER importers' resolved keys in
  `pnpm-lock.yaml` against `main` — the peer SUFFIXES in the version key
  are the only observable signal, because no source file changes. Concrete
  recipe used to catch this class of drift:

  ```bash
  git show main:pnpm-lock.yaml | grep "^  <package>@<version>(" > /tmp/before.txt
  grep "^  <package>@<version>(" pnpm-lock.yaml > /tmp/after.txt
  diff /tmp/before.txt /tmp/after.txt
  ```

- **Never rely on a file-scope gate (`git diff -- apps/X`) to prove another
  app is unaffected by a dependency change.** It proves the app's source is
  untouched; it says nothing about the app's resolved dependency graph,
  which lives in the shared lockfile.
- **If a tool declares a peer your importer relies on** (here,
  `typescript-eslint` relies on `typescript`, which the root `package.json`
  never declared for itself), pin the peer explicitly in the same
  `package.json` that declares the tool. A floating peer in a shared root
  config is exactly the shape that lets any workspace member's version
  choice silently redirect it.
- **`expo-doctor` (1.20.1+, now a blocking CI job for `apps/mobile` per the
  same PR) catches the mobile-side shape** — "X should install Y but Z is
  installed" — but only for the app it runs against. It would not have
  caught TV's re-keying; nothing in CI runs an equivalent doctor check
  against `apps/tv`. The ESLint flat-config `ConfigError` is the loud
  symptom of a split plugin instance, but only for tools that fail loudly on
  duplicate identity; a native module version bump (like TV's
  `react-native-safe-area-context` flip) would have failed silently at
  build or runtime instead.
- **The alternative containment — a root `pnpm.overrides` entry forcing one
  version workspace-wide — is the wrong tool here.** Two apps legitimately
  need different generations of the same package (mobile on SDK 57's
  `@expo/metro-runtime`, TV still on SDK 54's). An override would force one
  app onto the other's version. Per-importer pins are the correct mechanism
  for a deliberate, intentional version split across workspace apps. See
  `docs/solutions/security-issues/dependabot-pnpm-transitive-remediation-20260416.md`
  for the overrides-based sibling pattern and when IT is the right tool.

## Related

- `docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md` —
  same hazard class (pnpm duplicate/borrowed instances) one layer down: Metro
  BUNDLER-time resolution picking the wrong React copy, fixed in
  `metro.config.js`. This doc's hazard is LOCKFILE-time peer resolution;
  fixing one layer does not fix the other.
- `docs/solutions/security-issues/dependabot-pnpm-transitive-remediation-20260416.md`
  — the `pnpm.overrides` alternative and its scope caveats.
- `docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md`
  — structural analogy: a fix covering the sites the diff touched while
  sibling instances of the same shape hide elsewhere.
- `docs/solutions/build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md`
  — expo-doctor's peer-range checks during the previous SDK bump.
