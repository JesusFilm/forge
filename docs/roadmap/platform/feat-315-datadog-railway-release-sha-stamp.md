---
id: "feat-315"
title: "Datadog Railway release SHA stamping"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-27"
duration: 1
depends_on:
  - "feat-308"
  - "feat-314"
blocks: []
tags:
  - "platform"
  - "web"
  - "admin"
  - "railway"
  - "datadog"
  - "apm"
---

## Problem

Railway exposes `RAILWAY_GIT_COMMIT_SHA` inside GitHub-triggered build and
runtime processes, but service-variable aliases such as
`DD_VERSION` pointing at the Railway git SHA can resolve empty. Web production
confirmed sourcemaps uploaded with the Railway SHA while runtime `DD_VERSION`,
`NEXT_PUBLIC_DATADOG_VERSION`, and `DATADOG_RELEASE_VERSION` were empty. That
prevents Datadog APM deployment tracking from seeing a release version even
when traces reach the Agent.

## Entry Points

1. `apps/web/railway.toml` - Web build/start commands.
2. `apps/admin/railway.toml` - Admin web build/start commands.
3. `apps/admin/railway.worker.toml` - Admin worker build/start commands.
4. `docs/observability/datadog.md` - operator runbook.
5. `infra/datadog-agent/README.md` - shared Agent wiring notes.

## What To Build

- Stamp `DD_VERSION`, `NEXT_PUBLIC_DATADOG_VERSION`, and
  `DATADOG_RELEASE_VERSION` from `RAILWAY_GIT_COMMIT_SHA` inside Railway
  build commands before Next builds and sourcemap uploads run.
- Stamp the same vars inside Railway start commands before `dd-trace/init`
  preloads.
- Document that app services should not use Railway service-variable aliases
  for the release SHA.

## Verification

- TOML parsing for Web, Admin, and Admin worker Railway config.
- `bash -n` validation of each Railway build/start command.
- `rg` check that stale Railway reference-variable guidance for Datadog
  release vars is gone.
- `git diff --check`.

## Completion Evidence

- Web, Admin, and Admin worker now stamp Datadog release vars from
  `RAILWAY_GIT_COMMIT_SHA` in build and runtime commands.
- Datadog runbooks now describe the observed Railway alias behavior and the
  command-level stamping pattern.
