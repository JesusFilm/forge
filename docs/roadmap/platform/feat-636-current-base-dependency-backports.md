---
id: "feat-636"
title: "Refresh held dependency backports on October default"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags: [infrastructure]
---

## Problem

PRs #2587 (Hono Node server 1.19.14 to 1.19.15), #2588 (xmldom 0.8.12 to 0.8.15), #2592 (Babel runtime 7.29.2 to 7.29.7) and #2593 (NestJS path-to-regexp 8.4.0 to 8.4.2) predate the current default. Preserve each independent compatible update and validate each combined tree. One dependency candidate per PR; shared qualification tracking does not combine their dependency graphs.

## Entry Points — Read These First

1. `package.json`: `pnpm.overrides`.
2. `pnpm-lock.yaml`: all resolved Hono Node server users.
3. `.github/workflows/ci.yml`: native application and integration gates.

## Grep These

`@hono/node-server`, `admin-schema-drift`, `auth-postgres-integration`.

## What To Build

Merge current default into the existing dependency candidate without dropping the bot update. Run frozen install, patch guards, formatting, schema generation, auth contracts and exact-head CI.

## Constraints

No infrastructure changes, manual deployment, merging, force pushes or check weakening. Provider receipt acceptance belongs to the coordinator.

## Verification

`pnpm install --frozen-lockfile`, `node scripts/check-patched-deps.mjs`, `pnpm --filter @forge/auth test`, typecheck and lint; regenerate both schema artifacts and assert no drift. Inspect exact-head `ci-gate`. Staging healthcheck failure remains a distinct provider hold.

Native source qualification: frozen install, schema/introspection no-drift, auth unit/types/lint and production build pass. The real PostgreSQL cold-start contract passes. Under concurrent worker load, 5-second Changelog integration timeouts precede cleanup overlap; retain this failure and retry serially. Hosted current-base integration and the staging 503 remain explicit coordinator acceptance conditions.
