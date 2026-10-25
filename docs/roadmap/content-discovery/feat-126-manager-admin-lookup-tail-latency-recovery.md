---
id: "feat-126"
title: "Recover manager enrichment dispatch from admin lookup tail latency"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "manager"
  - "ai-pipeline"
  - "reliability"
  - "production-recovery"
---

## Problem

Production transcript enrichment retries are blocked by manager returning Cloudflare 502s from `POST /api/admin-trigger/transcript`.

The manager route is reachable: an unauthenticated probe returns a clean 401, and an authorized single-item probe eventually returned 200 and started one transcript job. The authorized path is still too close to timeout budgets because manager must call admin GraphQL `videosByCoreIds` before dispatching. Debug probes showed:

- manager -> admin `videosByCoreIds` takes multiple seconds even for one to ten core IDs
- admin HTTP logs showed `/api/graphql` 499 near 15 seconds, matching caller abort behavior
- direct prod Postgres `EXPLAIN ANALYZE` for the exact lookup SQL completes in milliseconds

This means the remaining bottleneck is above SQL, inside admin's GraphQL/Prisma/runtime request path or its surrounding middleware. Batch enrichment should stay paused until this tail-latency cause is instrumented and fixed.

## Entry Points

1. `apps/admin/src/app/api/graphql/route.ts` — Yoga GraphQL handler and plugin chain.
2. `apps/admin/src/graphql/context.ts` — per-request context, bearer resolution, service construction.
3. `apps/admin/src/graphql/plugins/rate-limit.ts` — Redis-backed GraphQL limiter on every operation.
4. `apps/admin/src/graphql/types/video.ts` — `videosByCoreIds` resolver.
5. `apps/admin/src/services/video.service.ts` — targeted SQL projection and current slow/failure breadcrumbs.
6. `apps/manager/src/lib/admin-video-lookup.ts` — manager outbound admin lookup client and timeout budget.
7. `apps/manager/src/lib/admin-trigger-route.ts` — authorized trigger route using the admin lookup before dispatch.
8. `apps/admin/src/services/manager-trigger.service.ts` — admin outbound manager client and `DISPATCH_FAILED` classifier.

## Grep These

```
grep -rn "videosByCoreIds\\|VideoForEnrichment" apps/admin/src apps/manager/src
grep -rn "lookup.slow\\|lookup.failed" apps/admin/src
grep -rn "ADMIN_FETCH_TIMEOUT_MS\\|MANAGER_FETCH_TIMEOUT_MS" apps/admin/src apps/manager/src
grep -rn "rateLimitPlugin\\|createContext" apps/admin/src/graphql apps/admin/src/app/api/graphql
grep -rn "admin-trigger" apps/manager/src apps/admin/src
```

## What To Build

Fix the authorized manager enrichment dispatch path so a small transcript retry batch can complete without manager 502s.

The work should:

1. Add production-safe timing breadcrumbs around the admin `videosByCoreIds` request path so operators can see where time is spent.
2. Preserve the existing manager/admin trigger contract and outcome statuses.
3. Remove or bypass the latency source once identified.
4. Keep timeout budgets explicit so manager fails with typed JSON errors before admin's outbound 15 second ceiling.
5. Verify with a small production-safe retry before resuming larger transcript enrichment batches.

## Constraints

- Do not resume full transcript enrichment retries until the lookup tail-latency cause is fixed or explicitly overridden.
- Do not print bearer tokens, DB URLs, Railway tokens, or workflow keys in logs or reports.
- Do not change missing mux/subtitle validation semantics.
- Do not make manager depend on CMS for this path.
- Do not hand-edit generated GraphQL type outputs.
- Prefer plain-string `event=name key=value` logs in request paths; Railway logsV2 may drop JSON-shaped runtime log lines.

## Verification

1. Local tests cover the timing/instrumentation path without leaking secrets.
2. Production logs show which phase dominates `videosByCoreIds` latency.
3. After the fix deploys, a manager -> admin 10-coreId lookup returns comfortably below timeout budgets.
4. A 10-item transcript retry batch returns `STARTED`, `ALREADY_IN_FLIGHT`, or `VALIDATION_FAILED`, not `DISPATCH_FAILED remote_5xx`.
5. Remaining `DISPATCH_FAILED` items are retried only after the healthy smoke passes.
