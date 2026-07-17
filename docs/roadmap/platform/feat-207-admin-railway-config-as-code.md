---
id: "feat-207"
title: "Admin Railway Config-as-code"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-06-26"
duration: 1
depends_on:
  - "feat-204"
blocks: []
tags:
  - "platform"
  - "admin"
  - "railway"
  - "datadog"
---

## Problem

Admin Datadog APM needs `dd-trace` loaded before application modules, but
putting `NODE_OPTIONS=--require dd-trace/init` in Railway service variables
also injects it into the Railpack/mise build phase. That can fail builds before
dependencies are installed. The Admin service needs code-owned Railway config
that scopes Datadog preload to runtime only.

## What Landed

- Replaced Admin's dead-config warning with `apps/admin/railway.toml`.
- Added Railpack build, Admin watch patterns, pre-deploy migrations,
  standalone start command, healthcheck, and restart policy.
- Scoped `NODE_OPTIONS='--require dd-trace/init'` to `startCommand`.
- Updated Admin and Datadog docs to remove global `NODE_OPTIONS` guidance.

## Operator Note

Set the Railway `@forge/admin` service Config-as-code Path to
`apps/admin/railway.toml`. Until that setting is present, Railway ignores this
file and the dashboard remains canonical.
