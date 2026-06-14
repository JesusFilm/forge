---
title: "pnpm patchedDependencies breaks filtered Docker installs unless patches/ is COPYed"
category: build-errors
date: 2026-06-11
tags: [pnpm, docker, monorepo, patched-dependencies, railway, shorts-worker]
module: apps/shorts-worker
symptom: "ENOENT: no such file or directory, open '.../patches/react-native-tvos@0.81.5-2.patch' during pnpm install --frozen-lockfile in a Docker stage"
root_cause: "pnpm hashes EVERY file in root package.json pnpm.patchedDependencies at install time, regardless of --filter scope — a Docker stage that copies only lockfile + manifests fails even when the filtered subtree never uses the patched package"
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
