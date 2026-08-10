---
title: "pnpm patchedDependencies breaks filtered Docker installs unless patches/ is COPYed"
category: build-errors
date: 2026-06-11
last_updated: 2026-08-01
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
