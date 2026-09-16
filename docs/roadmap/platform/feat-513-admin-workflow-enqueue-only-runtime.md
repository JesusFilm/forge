---
id: "feat-513"
title: "Keep workflow listeners out of the Admin enqueue-only runtime"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-09-16"
duration: 2
depends_on: []
blocks: []
tags:
  - "infrastructure"
  - "cms"
  - "recommendations"
---

## Problem

During feat-496 diagnostics, production Admin reported
`WORKFLOW_RUNNER_ENABLED=false`, yet CPU captures contained workflow execution
and PostgreSQL showed workflow scheduler activity. Installed
`@workflow/world-postgres` 4.1.1 calls `start()` from `queue()`, which also calls
`setupListeners()`. The application gate only prevents explicit startup; normal
enqueue can start execution in the web process. Its contribution to remaining
Watch deadline failures has not been causally isolated. Do not attribute those
failures to workflow execution based on this observation alone.

## Entry Points — Read These First

1. `apps/admin/src/instrumentation.ts` — `WORKFLOW_RUNNER_ENABLED` and `getWorld`.
2. `apps/admin/src/instrumentation.test.ts` — current explicit-startup coverage.
3. `apps/admin/src/config/env.ts` — world/runner configuration.
4. Installed `@workflow/world-postgres/dist/queue.js` — inspect `queue`, `start`
   and `setupListeners` in the pinned version, not only upstream documentation.
5. `apps/admin/src/services/workflow-worker-heartbeat.service.ts` — worker
   ownership and health signals.

## Grep These

`WORKFLOW_RUNNER_ENABLED`, `getWorld`, `setupListeners`, `workflow/api`,
`WORKFLOW_TARGET_WORLD`, `WORKFLOW_POSTGRES_WORKER_CONCURRENCY`.

## What To Build

Reproduce enqueue causing local execution against an isolated PostgreSQL world
with the runner flag off. Determine the smallest supported enqueue-only world
boundary; preserve durable enqueue, retries, resume, cancellation and dedicated
worker consumption. Test actual queue behavior, not only `world.start` mocks.
Measure concurrent request latency with and without the execution workload
before claiming a performance benefit. Investigate the other nested Mux fallback
relation reads identified during feat-496 independently if they still transfer
large result sets; the duration scalar fix does not change those loaders.

## Constraints

Do not disable production scheduling, drain shared queues, change worker
concurrency, or alter another task's services during diagnosis without ownership
checks. No direct production deploys. Keep Watch deadlines, rate limits,
attribution and homepage launch state unchanged. This is separate from the
already reproduced duration-loader overfetch fixed under feat-496.

## Verification

Use a dedicated local database and two processes: Admin enqueues without
executing; the worker consumes and completes the job. Assert retry/resume and
deduplication behavior. Run Admin instrumentation tests, types, lint, build and
the relevant workflow regressions. Verify both automatically deployed revisions
and observe real queue consumption before closing this ticket.
