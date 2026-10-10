---
id: "feat-320"
title: "Datadog server APM source maps"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-27"
duration: 1
depends_on:
  - "feat-204"
  - "feat-215"
  - "feat-308"
blocks: []
tags:
  - "platform"
  - "web"
  - "admin"
  - "railway"
  - "datadog"
  - "sourcemaps"
---

## Problem

Web and Admin upload browser `.next/static` sourcemaps to Datadog, but backend
APM errors come from the Next.js server bundle. Datadog Error Tracking can
therefore still show "Unminification failed" on `web.request`/server-side
issues even when the browser RUM sourcemap upload for the same release
succeeded.

## Entry Points

1. `apps/web/next.config.mjs` - Web production server sourcemap generation.
2. `apps/admin/next.config.ts` - Admin production server sourcemap generation.
3. `apps/web/railway.toml` - Web Node runtime flags.
4. `apps/admin/railway.toml` - Admin web Node runtime flags.
5. `apps/admin/railway.worker.toml` - Admin worker Node runtime flags.
6. `docs/observability/datadog.md` - shared operator runbook.

## What To Build

- Generate production server sourcemaps for Web and Admin Next bundles.
- Run production Node with `--enable-source-maps` while keeping the Datadog
  preload scoped to Railway start commands.
- Document the boundary between uploaded browser RUM maps and deployed server
  APM maps.

## Verification

- `pnpm --filter @forge/web exec eslint next.config.mjs`
- `pnpm --filter @forge/admin exec eslint next.config.ts`
- `pnpm prettier --check apps/web/next.config.mjs apps/admin/next.config.ts apps/web/railway.toml apps/admin/railway.toml apps/admin/railway.worker.toml docs/observability/datadog.md docs/roadmap/platform/feat-320-datadog-server-apm-sourcemaps.md`
- `git diff --check`

## Completion Evidence

- Web and Admin production server bundles now emit server sourcemaps for
  backend stack traces.
- Web, Admin web, and Admin worker Railway start commands run Node with
  `--enable-source-maps` while keeping `dd-trace` preloaded at runtime only.
- The Datadog runbook documents why browser RUM sourcemap uploads do not cover
  backend APM server errors.
