---
id: "feat-506"
title: "Make Web memory diagnostics tolerate missing container tools and cache directories"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-15"
duration: 1
depends_on: []
blocks: []
tags: ["web", "observability", "infrastructure"]
---

## Problem

The production timeout investigation found recurring `command_execution` error
spans from `spawn ps ENOENT` and `du -sb .next/cache` when the directory does not
exist. They appear on both pre-worker Web `cc252f9d` at 02:16–02:18 UTC and
worker Web `5a2009df` at 02:19–02:24 UTC on 15 September. These are independent
diagnostic failures, not recommendation request timeouts or a worker regression.

Datadog issue IDs: `f7739d58-8ad0-11f1-9c24-da7ad0900002` (ps) and
`f787a58c-8ad0-11f1-8ba1-da7ad0900002` (du). Recovery evidence is in
`docs/operations/watch-runtime-recovery-2026-09-15.md`.

## Entry points

- `apps/web/src/observability/memory-diagnostics.ts`: `execFileAsync`, `du`, `ps`.
- `apps/web/src/instrumentation.ts`: diagnostics registration and cadence.
- `apps/web/railway.toml`: runtime/container configuration.

## Scope and verification

Use available Node/process or procfs information where practical, or check
optional tools/directories once and skip unsupported measurements. Keep actual
request errors visible; do not suppress all child-process errors or alter cache
storage/invalidation to satisfy a diagnostic probe. Preserve useful memory data
without repeatedly spawning a known-missing command. Verify in the normal built
runtime, with absent tools/cache and a healthy configured case, then deploy
through PR/main and confirm diagnostic noise stops without losing request traces.
