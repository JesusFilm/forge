---
title: "EAS default macOS image bump breaks apps/mobile install: sharp attempts a global-libvips source build without node-gyp"
date: 2026-08-28
category: build-errors
module: apps/mobile
problem_type: build_error
component: tooling
symptoms:
  - "EAS production build for apps/mobile failed in the INSTALL_DEPENDENCIES phase during `pnpm install --frozen-lockfile`"
  - 'sharp install log: "sharp: Attempting to build from source via node-gyp"'
  - 'sharp install log: "sharp: Please add node-gyp to your dependencies" then "Failed"'
  - "pnpm exits with ELIFECYCLE Command failed with exit code 1 building sharp@0.34.5 from source"
  - 'pnpm prints [WARN] The "pnpm" field in package.json is no longer read by pnpm'
root_cause: config_error
resolution_type: config_change
severity: high
related_components:
  - "apps/mobile/eas.json"
  - "apps/mobile/scripts/generate-app-icon.mjs"
  - "apps/admin (sharp dependency borrowed via createRequire)"
  - "apps/tv/eas.json (same gap, unpinned - known sibling risk)"
tags:
  - eas-build
  - pnpm
  - sharp
  - libvips
  - node-gyp
  - toolchain-drift
  - dependency-pinning
  - expo
framework_version: "node 20.19.4->22.23.1, pnpm 10.16.1->11.9.0 (EAS image macos-sequoia-15.6-xcode-26.0 -> macos-tahoe-26.5-xcode-26.6)"
---

# EAS default macOS image bump breaks apps/mobile install: sharp attempts a global-libvips source build without node-gyp

## Problem

On 2026-08-28, EAS production builds for `apps/mobile` failed in the `INSTALL_DEPENDENCIES` phase with no relevant change in the repo. EAS had moved its default macOS VM image, and the new image made `sharp@0.34.5` try to build from source instead of using its prebuilt binary.

## Symptoms

Every hex id below is an EAS build id, not a git commit. The last good builds ran on the older image (mobile EAS build `e25320e6` on 2026-07-16, TV EAS build `f05b72b9` on 2026-08-19, both on `macos-sequoia-15.6-xcode-26.0` with Node 20.19.4 and pnpm 10.16.1). The failing EAS builds were `c5b694fc` and `dfabe6e3`. Their `SPIN_UP_BUILDER` phase showed the new image (all versions as observed in the build logs on 2026-08-28):

```
Using VM template "macos-tahoe-26.5-xcode-26.6" running macOS Tahoe 26.5.2
- Node.js 22.23.1
- pnpm 11.9.0
```

The `PRE_INSTALL_HOOK` phase then printed a warning that no earlier build had shown:

```
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.packageExtensions", "pnpm.overrides", "pnpm.patchedDependencies".
```

The `INSTALL_DEPENDENCIES` phase ran `pnpm install --frozen-lockfile`, reported `Lockfile is up to date, resolution step is skipped`, and then failed inside sharp's install script:

```
.../sharp@0.34.5/node_modules/sharp install$ node install/check.js || npm run build
sharp install: > sharp@0.34.5 build
sharp install: > node install/build.js
sharp install: sharp: Attempting to build from source via node-gyp
sharp install: sharp: Found node-addon-api
sharp install: sharp: Please add node-gyp to your dependencies
sharp install: Failed
ELIFECYCLE Command failed with exit code 1.
pnpm install --frozen-lockfile exited with non-zero code: 1
```

The good builds in July and August show the same first line followed by `sharp install: Done`. On those builds `node install/check.js` exited 0, so pnpm never ran the `|| npm run build` half.

`sharp` is an `apps/admin` dependency (`apps/admin/package.json:119`). `apps/mobile/scripts/generate-app-icon.mjs:40` borrows it through `createRequire` on purpose, so it is part of the workspace install. It never runs during an EAS build. It only has to install.

## What Didn't Work

**Pinning `node` and `pnpm` alone.** EAS build `dfabe6e3` set `node: 24.14.1` and `pnpm: 9.12.3` in `eas.json`. The `INSTALL_CUSTOM_TOOLS` phase installed both, and the build failed at the same sharp line. The pins remove the pnpm 11 warning, but they do not change what sharp finds on the image. The image still has a global libvips, and `install/check.js` still exits 1.

**Blaming pnpm 11 for the sharp failure.** The first read of the log tied the sharp failure to the new pnpm major. That was wrong, and EAS build `dfabe6e3` proved it: pnpm 9.12.3 failed in the same way. The pnpm warning and the sharp failure are two separate facts that happened to arrive on the same image.

## Solution

`apps/mobile/eas.json` gained a `base` profile. Every build profile extends it. Before:

```json
"build": {
  "development": { "developmentClient": true, "distribution": "internal", "environment": "development" },
  "preview": { "distribution": "internal", "channel": "preview", "environment": "preview" },
  "preview-simulator": { "extends": "preview", "ios": { "simulator": true } },
  "production": { "autoIncrement": true, "channel": "production", "environment": "production" }
}
```

After:

```json
"build": {
  "base": {
    "node": "24.14.1",
    "pnpm": "9.12.3",
    "env": { "SHARP_IGNORE_GLOBAL_LIBVIPS": "1" }
  },
  "development": { "extends": "base", "developmentClient": true, "distribution": "internal", "environment": "development" },
  "preview": { "extends": "base", "distribution": "internal", "channel": "preview", "environment": "preview" },
  "preview-simulator": { "extends": "preview", "ios": { "simulator": true } },
  "production": { "extends": "base", "autoIncrement": true, "channel": "production", "environment": "production" }
}
```

`node`, `pnpm`, `env`, and `extends` are all fields the installed `eas-cli` (21.0.1) accepts. The contract lives in the CLI install rather than this repo: in `@expo/eas-json/build/build/schema.js` (under the `eas-cli` package, not a repo path), lines 35-38 declare `env`, `node`, and `pnpm` on the build profile, and line 113 declares `extends`.

The change opened in PR #2087 (`fix(mobile): make EAS installs survive the new builder image`). As of this writing the PR is open, not merged.

**Guard test.** `apps/mobile/app/__tests__/easToolchainPins.guard.test.js` reads `eas.json`, the root `package.json`, and `.nvmrc`, and pins five rules:

```js
it("pins pnpm to the root packageManager version, character for character", () => {
  const [, version] = rootPackage.packageManager.split("@")
  expect(base.pnpm).toBe(version)
})
it("pins node to a full semver on the .nvmrc major", () => {
  expect(base.node).toMatch(/^\d+\.\d+\.\d+$/)
  expect(base.node.split(".")[0]).toBe(nvmrcMajor)
})
it("makes sharp use its prebuilt binary on the builder", () => {
  expect(base.env.SHARP_IGNORE_GLOBAL_LIBVIPS).toBe("1")
})
```

The other two rules walk the `extends` chain of every profile to `base` (with a floor of three profiles, so an emptied `build` block cannot pass vacuously) and assert `base` carries no `channel`, `environment`, or `distribution`. Each rule was falsified once by hand.

**Reading EAS build logs.** `eas build:view <id> --json` returns `logFiles[]` (signed GCS URLs) and names the failing phase in `error.message`. The log body is served with `Content-Encoding: br` even when the request sends `Accept-Encoding: identity`. On this Mac, python has no `brotli` module and curl was built without Brotli, so decode with Node:

```js
const zlib = require("node:zlib")
const res = await fetch(url)
const text = zlib
  .brotliDecompressSync(Buffer.from(await res.arrayBuffer()))
  .toString("utf8")
for (const line of text.split("\n")) {
  if (!line) continue
  const { phase, msg } = JSON.parse(line)
  console.log(phase, msg)
}
```

Each line is one JSON object with `phase`, `msg`, and `marker` fields.

**Verification.** EAS build `31d21ac6` (version 1.0.0, build 4) passed on the `macos-tahoe-26.5-xcode-26.6` image in 6m44s and was submitted.

## Why This Works

Two separate mechanisms changed with the image. The fix addresses both.

**1. The new image has a global libvips, and sharp prefers it.** Every sharp path in this section is relative to the vendored package root `node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/`, so it is a dependency file rather than a repo file. sharp's install script is `node install/check.js || npm run build` (`package.json:96` in that package). `install/check.js:8-9` reads:

```js
if (useGlobalLibvips() || process.env.npm_config_build_from_source) {
  process.exit(1)
}
```

It calls `useGlobalLibvips()` with no logger, so the exit is silent. Nothing in the log says why the `||` branch ran. `lib/libvips.js:176-190` defines the check. Lines 177-178 return `false` at once when `SHARP_IGNORE_GLOBAL_LIBVIPS` is set. Otherwise line 187 runs `pkg-config --modversion vips-cpp` (`lib/libvips.js:134`) against Homebrew's pkg-config path plus the system paths (`lib/libvips.js:150-165`), and line 189 returns `true` when the found version meets sharp's minimum. The Sequoia image found no libvips, so `check.js` exited 0 and sharp kept its prebuilt binary. The Tahoe image finds one, `check.js` exits 1, pnpm runs `npm run build`, and `install/build.js:24-28` fails because `node-gyp` is not a dependency:

```js
const gyp = require('node-gyp');
...
log('Please add node-gyp to your dependencies');
process.exit(1);
```

The prebuilt binary was available the whole time. sharp's `package.json:147-149` lists the package specs `@img/sharp-darwin-arm64@0.34.5` and `@img/sharp-libvips-darwin-arm64@1.2.4` as optional dependencies, and `pnpm-lock.yaml` holds both (lines 3902 and 3914). `SHARP_IGNORE_GLOBAL_LIBVIPS=1` makes `useGlobalLibvips()` return `false` on line 178, `check.js` exits 0, and sharp loads the prebuilt package. Adding `node-gyp` would also have made the build pass, but it would compile libvips bindings on every EAS build for a package that never runs there.

**2. pnpm 11 ignores the root `package.json` `pnpm` field.** The root `package.json` carries `pnpm.packageExtensions`, `pnpm.overrides`, and `pnpm.patchedDependencies` (lines 33-93). The `patchedDependencies` block holds the repo's two committed patches, keyed by the package specs `react-native-tvos@0.81.5-2` and `@datadog/mobile-react-native@3.5.2` (lines 90-93). The `PRE_INSTALL_HOOK` warning says pnpm 11 no longer reads any of them. A build on pnpm 11 installs unpatched packages and ignores every override. That did not cause the sharp failure, but it is a correctness hole in its own right, and it would surface later as a native compile error or a runtime bug. The repo pins `"packageManager": "pnpm@9.12.3"` (root `package.json:4`) and `.nvmrc` holds `24`, but EAS does not read `packageManager`. It takes the toolchain from the image default unless `eas.json` pins `node` and `pnpm`. The `base` profile is that pin.

The pins matter for a second reason. The image default can move again at any time. A pinned toolchain makes the next image move a no-op for the install step, and it makes the builder match the toolchain that CI and local installs already use.

## Prevention

- **Keep the guard green.** `easToolchainPins.guard.test.js` fails when `base.pnpm` drifts from the root `packageManager`, when `base.node` leaves the `.nvmrc` major, when the env is removed, when a profile stops extending `base`, or when `base` becomes a build target. A stale pin does not fail locally. It fails on the next EAS build, so the test is the only early signal.
- **Bump all three together.** A pnpm or node bump touches root `package.json` `packageManager`, `.nvmrc`, and `eas.json` `base` in one commit. `.nvmrc` holds only the major, and `eas.json` needs a full semver, so the patch is the release the last green build used. The rule is written in `apps/mobile/CLAUDE.md` under "EAS builder toolchain pins".
- **Read the `SPIN_UP_BUILDER` lines first.** When an EAS build fails and the repo did not change, compare the VM template, Node, and pnpm lines against the last green build before reading the failing phase. An image move explains the failure faster than the failing command does, and the failing command may point at the wrong cause, as it did here.
- **Never pass `--profile base`.** It resolves to a store build with no channel and no build-number increment.
- **`apps/tv/eas.json` has the same gap.** It carries no `node`, no `pnpm`, and no `SHARP_IGNORE_GLOBAL_LIBVIPS`. Its next build on the Tahoe image will fail in the same way, and TV also depends on the `patchedDependencies` that pnpm 11 ignores. That fix is left for a TV-verified PR.
- **Any `eas.json` edit moves the fingerprint runtime version**, so the next `eas update` after a pin bump reaches no installed build until a native build ships; see "Publishing an EAS Update" in `apps/mobile/CLAUDE.md`.

## Related Issues

- PR #2087 — the fix this doc records (pins, env, guard test, CLAUDE.md section).
- PR #1971 — the same fix shape on `apps/tv`: pin a version so a native dependency (Hermes) uses its prebuilt artifact instead of building from source.
- `docs/solutions/build-errors/expo-doctor-affected-gated-live-registry-drift-20260817.md` — sibling symptom: an upstream Expo drift outside the repo's diff breaks a check and lands on whichever PR wakes it. Different mechanism and fix.
- `docs/solutions/build-errors/pnpm-patched-dependencies-filtered-docker-install-20260611.md` — same mechanism as cause 2: pnpm silently skips the root `pnpm.*` config under a particular execution context (a filtered Docker install there, a pnpm major bump here).
- `docs/solutions/architecture-patterns/pnpm-workspace-optional-peer-dependency-silent-borrowing.md` — a different pnpm monorepo hazard between `apps/mobile` and `apps/tv`; its lesson that a file-scoped diff cannot prove a sibling app is unaffected is why the TV gap is named above.
- `docs/solutions/build-errors/eas-managed-react-native-tvos-build-gotchas-20260615.md` — the `apps/tv` EAS gotchas doc; add a cross-reference there once TV's `eas.json` gets the same pins and env.
- `docs/solutions/platform/devcontainer-setup.md` — the repo's existing rule to pin pnpm to `packageManager` for reproducible installs, which this doc extends to the EAS builder.
