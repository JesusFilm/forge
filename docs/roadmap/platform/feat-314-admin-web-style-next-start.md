---
id: "feat-314"
title: "Admin Web-style Next start on Railway"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-25"
duration: 1
depends_on:
  - "feat-308"
blocks: []
tags:
  - "platform"
  - "admin"
  - "railway"
  - "datadog"
  - "apm"
---

## Problem

Admin's Railway standalone runtime cannot resolve `dd-trace/init`, so the
Datadog server preload was removed to keep production healthy. Web runs the
standard Next server from the app directory and resolves
`./node_modules/dd-trace/init` normally. Admin should use the same runtime shape
unless there is a measured reason to keep standalone output.

## Entry Points

1. `apps/admin/next.config.ts` - Admin Next build output mode.
2. `apps/admin/railway.toml` - traffic-serving Admin Railway build/start.
3. `apps/admin/railway.worker.toml` - dedicated Admin worker Railway
   build/start.
4. `apps/admin/CLAUDE.md` - Admin deployment and Datadog notes.
5. `docs/observability/datadog.md` - shared Datadog/Railway runbook.

## What To Build

- Remove Admin's standalone-only deployment path.
- Run Admin and Admin worker from `apps/admin` with `pnpm start`, matching
  Web's `next start` runtime model.
- Restore the scoped runtime `dd-trace` preload using
  `./node_modules/dd-trace/init`.
- Keep browser sourcemap upload in the Railway build command.

## Verification

- `DATABASE_URL='postgresql://user:pass@localhost:5432/forge_admin' ADMIN_SESSION_SECRET='local-build-secret-at-least-32-chars' AUTH_ISSUER_URL='https://auth.example.test' AUTH_ADMIN_CLIENT_ID='forge-admin-local' pnpm --filter @forge/admin build`
- `node scripts/upload-datadog-sourcemaps.mjs --service test --minified-path-prefix /x/`
- `cd apps/admin && node -e "require('./node_modules/dd-trace/init'); console.log('dd-trace preload resolves')"`
- `git diff --check`

## Completion Evidence

- Admin no longer emits Next standalone output.
- Admin and Admin worker Railway start commands now match Web's runtime shape:
  run from the app directory with `pnpm start`.
- Runtime-scoped `dd-trace` preload is restored through
  `./node_modules/dd-trace/init`.
- Railway build commands keep browser sourcemap upload and no longer copy
  assets into `.next/standalone`.
