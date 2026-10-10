---
id: "feat-308"
title: "Web and Admin Datadog sourcemap build upload"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-182"
  - "feat-204"
blocks: []
tags:
  - "platform"
  - "web"
  - "admin"
  - "datadog"
  - "sourcemaps"
  - "railway"
---

## Problem

Datadog RUM reports for Web and Admin show "Unminification failed" because no
matching JavaScript sourcemaps are available for the application release. Both
apps already generate production browser sourcemaps and expose
`datadog:sourcemaps` scripts, but Railway builds do not run those scripts.
Admin's client-side RUM version also needs to fall back to the same git release
identity that the upload script uses.

## Entry Points

1. `apps/web/railway.toml` - Web production build command.
2. `apps/admin/railway.toml` - Admin production build command.
3. `apps/admin/railway.worker.toml` - Admin worker production build command.
4. `apps/web/package.json` - Web Datadog sourcemap upload script.
5. `apps/admin/package.json` - Admin Datadog sourcemap upload script.
6. `apps/admin/src/config/datadog-rum-env.ts` - Admin browser RUM release
   version fallback.
7. `docs/observability/datadog.md` - operator runbook for Datadog variables and
   upload behavior.

## What To Build

- Run the app-local `datadog:sourcemaps` script after successful Railway builds
  when a Datadog API key is available.
- Keep builds green in local/preview contexts where sourcemap upload credentials
  are intentionally absent.
- Align Admin browser RUM `version` fallback with the sourcemap upload release
  fallback.
- Document the build-time source-map upload requirement for both apps.

## Verification

- `pnpm --filter @forge/admin test -- src/config/datadog-env.test.ts src/components/__tests__/DatadogRum.test.tsx`
  - 11 tests passed.
- `git diff --check`

## Completion Notes

- Web and Admin Railway build commands now run the existing Datadog sourcemap
  upload scripts after successful production builds when `DATADOG_API_KEY` or
  `DD_API_KEY` is present.
- Added `apps/admin/railway.worker.toml` for the dedicated Admin worker service,
  reusing the Admin build/start shape without running the migration predeploy.
- Builds without Datadog upload credentials now log a skip message instead of
  failing local or preview contexts.
- Admin browser RUM now falls back to `RAILWAY_GIT_COMMIT_SHA`,
  `VERCEL_GIT_COMMIT_SHA`, or `GIT_COMMIT_SHA` for `version`, matching the
  upload script's release fallback.
- `docs/observability/datadog.md` now documents the automatic Railway upload
  behavior and Web sourcemap variables.
