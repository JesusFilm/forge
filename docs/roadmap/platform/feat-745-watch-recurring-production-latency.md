---
id: "feat-745"
title: "Diagnose and repair recurring Watch production latency"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-10-19"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "performance"
  - "infrastructure"
---

## Problem

Watch repeatedly stalls despite HTTP 200 and Next cache HIT responses. Checkly times out across two regions. Container RAM and aggregate CPU headroom do not explain the incident. Deployment correlation is not yet causal attribution.

## Entry Points — Read These First

1. `docs/plans/2026-10-19-watch-production-latency-investigation.md`: evidence, access IDs, ordered investigation and acceptance.
2. `apps/web/cache-handler.mjs`, `apps/web/src/instrumentation.ts`, `apps/web/next.config.mjs`: cache hot path and startup.
3. `apps/web/railway.toml`, `apps/web/src/proxy.ts`, `packages/feature-flags/src/launchdarkly.ts`: deployment and request work.

## Grep These

`x-nextjs-cache`, `keyPrefix`, `revalidateTag`, `waitForInitialization`, `generateEtags`, `forgeWebCacheHandlerConfig`, `NEXT_CACHE_REDIS_PREFIX`.

## What To Build

Execute the linked investigation; attribute slow cache-hit latency, reproduce the mechanism, and prepare the smallest evidence-supported repair with a regression test and before/after performance measurements. Persist a sanitized incident report.

## Constraints

Read-only production diagnosis. No cache purge, restart, rollback, scaling, flag changes or manual deployment. Normal PR-to-main rollout. Preserve analytics and cache semantics. Do not fold separately scoped transient-renderer work from feat-700 into this task without justification and scope review.

## Verification

Comparable warm/cold production-mode measurements and a discriminating regression test; relevant package checks; trace and infrastructure evidence; explicit separation of local verification from pending production recovery. Follow disk admission rules for all heavy operations.

## Progress — 2026-10-19

Investigation findings are in `docs/reports/2026-10-19-watch-production-latency-incident.md`:

- The single Web main thread has been ~99% runnable since the 15:14 UTC process start (82% on CPU, 17% waiting in the run queue). Requests, including cache HITs, queue behind it.
- GC unit cost rose 50–70% on an unchanged heap, and the host load is 66 on 48 CPUs. This points to host contention on a service with ~0.9 baseline main-thread utilization, not a `3003c520` code regression.
- Added scheduler-pressure gauges (`forge.web.main_thread.*`, `forge.web.cgroup.*`) so this split is visible in Datadog.

Still open (keep in progress):

- Owner decision on a same-commit redeploy and on running ≥2 Web replicas.
- Production acceptance from the report.
- A separately reviewed change for the effective 60 s page lifetime.
