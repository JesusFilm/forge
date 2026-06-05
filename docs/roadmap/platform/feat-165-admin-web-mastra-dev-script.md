---
id: "feat-165"
title: "Admin Web Mastra Dev Script"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-05-18"
duration: 1
depends_on: []
blocks: []
tags:
  - "tooling"
  - "admin"
  - "web"
---

## Problem

Local admin preview and Experience AI chat work often needs three processes:
the admin app, the web/watch app, and the admin Mastra playground. Running
them by hand is easy to forget and repeats known setup friction documented in
`docs/solutions/integration-issues/admin-preview-blank-tab-web-server-not-running-20260510.md`.

## Entry Points - Read These First

1. `package.json` - root workspace scripts.
2. `turbo.json` - persistent dev task configuration.
3. `apps/admin/package.json` - admin `dev` and `mastra:dev` scripts.
4. `apps/web/package.json` - web `dev` script.

## Grep These

- `"dev"` in `package.json` and app package manifests.
- `"mastra:dev"` in `apps/admin/package.json`.
- `"persistent": true` in `turbo.json`.

## What To Build

Add root scripts that start, pause, stop, and restart:

1. `@forge/admin#dev` on `http://localhost:3003`.
2. `@forge/web#dev` on `http://localhost:3000`.
3. `@forge/admin#mastra:dev`.

The root commands should be:

- `pnpm run:admin-web-mastra`
- `pnpm pause:admin-web-mastra`
- `pnpm resume:admin-web-mastra`
- `pnpm stop:admin-web-mastra`
- `pnpm restart:admin-web-mastra`
- `pnpm status:admin-web-mastra`

Prefer existing workspace commands over adding a new process-runner dependency.

## Constraints

- Do not change app runtime code.
- Do not add a new dependency if Turborepo can run the processes.
- Keep the existing root `dev` script behavior unchanged.

## Verification

- `scripts/dev-admin-web-mastra.sh --dry-run`
- `scripts/admin-web-mastra.sh status`
- `scripts/admin-web-mastra.sh pause --dry-run`
- `scripts/admin-web-mastra.sh stop --dry-run`
- `scripts/admin-web-mastra.sh restart --dry-run`
- `bash -n scripts/dev-admin-web-mastra.sh`
- `bash -n scripts/admin-web-mastra.sh`
- `bash -n scripts/stop-admin-web-mastra.sh`
