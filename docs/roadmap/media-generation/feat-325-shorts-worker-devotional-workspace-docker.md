---
id: "feat-325"
title: "Shorts Worker Devotional Workspace Docker materialization"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-08-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "devotional"
  - "docker"
  - "railway"
  - "shorts-worker"
---

## Problem

The production Shorts Worker image fails to build after the signed Workspace
transfer release because its filtered pnpm/Docker stages do not materialize the
new `@forge/devotional-workspace` dependency. Monorepo and CI builds pass because
the full workspace is present, but Railway's Docker context cannot resolve the
package.

## Entry Points — Read These First

1. `apps/shorts-worker/Dockerfile` — filtered install, build, production
   dependency, media dependency, and runtime image stages.
2. `apps/shorts-worker/package.json` — authoritative `workspace:*`
   dependencies the image must materialize.
3. `apps/shorts-worker/railway.toml` — Dockerfile selection, deploy watch
   paths, health check, and replica contract.
4. `apps/shorts-worker/src/dockerfile-workspace-deps.test.ts` — structural
   regression guard for every Worker workspace dependency.
5. `apps/shorts-worker/scripts/prebundle.ts` — standard and devotional
   Remotion bundle entry points.
6. `packages/shorts-compositions/src/devotional/schema.ts` — source-shipped
   devotional schema resolved by TypeScript and Remotion.

## Grep These

- `workspace:*` in `apps/shorts-worker/package.json`.
- `--filter @forge/shorts-worker...` in `apps/shorts-worker/Dockerfile`.
- `devotional-workspace|shorts-compositions` in the Dockerfile, Railway
  config, and regression test.
- `prebundle|devotional-bundle` in `apps/shorts-worker`.

## What To Build

- Copy the Devotional Workspace manifest into both filtered install stages.
- Copy its source into the build and runtime stages while preserving pnpm's
  source-workspace symlink layout.
- Copy its production `node_modules` into the runtime image.
- Watch the package path for future Railway deployments.
- Add a regression test for every source-shipped Worker workspace dependency.

## Constraints

- Copy each workspace manifest into both pnpm install stages before running
  the recursive Worker filter.
- Keep source-shipped workspace packages outside `node_modules` at runtime;
  Node 22.18+ must resolve their workspace symlinks so TypeScript stripping is
  allowed.
- Copy package-level production `node_modules` for every source-shipped
  workspace package into the final image.
- A workspace source change must trigger the Worker Railway deployment.
- Both Shorts and devotional Remotion bundles must resolve during the exact
  Docker `build` target.
- Production deploys remain PR-to-main through Railway autodeploy.

## Verification

- `pnpm --filter @forge/shorts-worker test`
- `pnpm --filter @forge/shorts-worker typecheck`
- `pnpm --filter @forge/shorts-worker lint`
- `docker build --target build -f apps/shorts-worker/Dockerfile .`
- Railway production deployment reaches `SUCCESS` for the merged commit.

Local verification passed with 17 Worker test files / 173 tests, Worker
lint/typecheck/build checks, Shorts Compositions tests/lint/typecheck, and the
exact Docker `build` stage including both Remotion bundles. Production
verification remains the post-merge gate.
