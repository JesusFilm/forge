---
title: "pnpm patchedDependencies breaks filtered Docker installs unless patches/ is COPYed"
category: build-errors
date: 2026-06-11
last_updated: 2026-10-24
tags: [pnpm, docker, monorepo, patched-dependencies, railway, shorts-worker]
module: apps/shorts-worker
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "Filtered pnpm Docker installs fail when root patch files or workspace manifests are absent from the staged filesystem."
root_cause: incomplete_setup
resolution_type: code_fix
---

# pnpm patchedDependencies breaks filtered Docker installs

## Problem

The shorts-worker Dockerfile (first Dockerfile-built app in this repo) copied
only `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the three relevant
`package.json` manifests before running
`pnpm install --frozen-lockfile --filter @forge/shorts-worker...`.
Both install stages (`build` and `prod-deps`) failed with
`ENOENT ... patches/react-native-tvos@0.81.5-2.patch` — a patch belonging to
the **mobile app**, which the worker subtree never touches.

## Root Cause

Root `package.json` declares `pnpm.patchedDependencies`. pnpm 9.x reads and
hashes every listed patch file during ANY install in the workspace —
`--filter` does not exempt it. If the Docker build context layer doesn't
contain `patches/`, the install dies before resolution starts.

## Solution

Add `COPY patches patches` immediately after the manifest COPYs in **every**
Docker stage that runs `pnpm install` (the shorts-worker Dockerfile has two:
`build` and `prod-deps`).

## Prevention

- Any new Dockerfile in this monorepo that runs `pnpm install` must COPY:
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the needed `package.json` files,
  **and `patches/`** — treat them as one inseparable set.
- This class of failure is only catchable by actually executing the install
  against the staged file set (the deployment-verification review reproduced
  it in a temp dir before any image was built — cheap and worth doing for
  every new Dockerfile).
- A recursive pnpm filter includes transitive workspace dependencies only when
  their manifests exist in the filtered Docker stage. Whenever an app adds a
  `workspace:*` dependency, copy that package's manifest into every install
  stage, its source into build/runtime, and its package-level `node_modules`
  into runtime when the source is executed there. Add the package path to the
  Railway watch list as well.

## Follow-up: source-shipped Workspace dependencies

The devotional Workspace release added `@forge/devotional-workspace` to Shorts
Worker. Repository tests remained green because the complete monorepo was
available, while Railway's filtered Docker build could not resolve the omitted
workspace package. Materializing that dependency then exposed two more
container-only assumptions: `BodyInit` was not present in the filtered TypeScript
environment, and Remotion could not resolve a source-shipped `./styles.js`
specifier to `styles.ts`.

The regression gate must execute the exact Docker `build` target, including
both Remotion prebundles. Package tests alone do not prove that manifests,
ambient types, source imports, and runtime workspace symlinks are present in
the container's staged filesystem.

## Manager feature-flags closure (PR #1087, feat-910)

Manager's package build passed in the complete monorepo, but its production
image failed during Next compilation with `Can't resolve '@forge/feature-flags'`.
The new dependency was declared in Manager and the lockfile; the Dockerfile
omitted both its manifest before the filtered frozen install and its source
before build. Copying only the source after install would leave its SDK
dependencies outside the installed workspace closure.

Supply both COPY entries and include `packages/feature-flags/**` in the image
workflow's pull-request and main-push path filters and Railway source watch list.
Keep the existing base digest, CA filtering, frozen install, media toolchain and image gates intact.
Extend the actual-image network-disabled smoke to authenticate with a dummy
service bearer and read `GET /api/admin/engine-flag`: the compiled resolver must
return `{ engine: "workflow", override: null }` with no SDK key or flag settings.
This exercises the shipped dependency path; a test that merely matches COPY
lines cannot establish runtime resolution.

An offline frozen install and real build against that staged file set then
exposed a second missing boundary: the existing TypeScript include set checks
`enrichment-callback.contract.test.ts`, which imports two shared JSON fixtures
under `docs/fixtures/`. Copy `manager-enrichment-steps.json` and
`manager-enrichment-callbacks.json` at their existing repository paths before
build, with matching CI/Railway watch paths. Keep test typechecking enabled.
Validate the resulting staged standalone server, not only the complete checkout.

Treat package builds, standalone smoke and actual-container acceptance as
separate evidence. If Docker is inaccessible or its storage is constrained,
record that qualification and retain the actual image build/trust/media/smoke
CI requirements. Do not redirect a build with an unsupported flag, change the
global daemon, or infer image success from a green package build.
