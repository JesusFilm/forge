---
title: Next background route loading can outlive readiness
date: "2026-09-21"
module: Admin production startup
problem_type: performance_issue
component: service_object
severity: high
symptoms:
  - Health returns 200 while the first selection acknowledgment exceeds its caller deadline.
  - Small database operations coexist with large application scheduling gaps.
root_cause: async_timing
resolution_type: code_fix
tags:
  - nextjs
  - readiness
  - event-loop
  - recommendations
  - cold-start
---

# Next background route loading can outlive readiness

## Cause and discriminating experiment

Next 16.2.4 starts `unstable_preloadEntries()` without awaiting it. The method
loads all App Router entries, including large dashboard modules, while the
listener can already answer a trivial health route. In Forge, first real
selection acknowledgments took 926–949 ms after health returned 200, exceeding
the unchanged 700 ms caller deadline.

A supported Node CPU capture of the owned production-build child showed
`unstable_preloadEntries → loadComponentsImpl → requirePage` loading experience
and embeddings dashboard entries during GraphQL handling. This identifies an
application workload; long client-side SQL spans alone would not distinguish
database execution, pool/network time and delayed JavaScript continuation.

The behavior is explicit in the pinned framework's
[server implementation](https://github.com/vercel/next.js/blob/v16.2.4/packages/next/src/server/next-server.ts)
and [default configuration](https://github.com/vercel/next.js/blob/v16.2.4/packages/next/src/server/config-shared.ts).
There is no public completion hook at this version.

## Correction

`patches/next@16.2.4.patch` exposes the existing preload promise through
`globalThis[Symbol.for("forge.next.preloadEntries")]` in both published CJS and
ESM implementations. It does not start extra work or change other applications'
readiness. Admin's production `/api/health` waits for that promise and imports
the actual GraphQL route before returning 200. The explicit import matters:
Next catches and skips individual preload failures.

A missing hook returns 503; a rejected preload or failed GraphQL import cannot
be converted into healthy readiness. Development does not require the production
hook. Health invokes no GraphQL operation or mutation. The approach assumes the
normal single production Next server per process used by Railway `next start`.
Keep the framework patch and health check together during upgrades; run the
existing patched-dependency guard and a real production-build startup probe.

The five matched selections improve to 307–402 ms. Readiness takes about
0.6–0.9 seconds longer, inside the existing 60-second deployment health limit.
No API deadline, transaction budget, rate limit or acknowledgment semantics change.

## Controls that did not solve the problem

Importing only the schema or GraphQL handler while background preloading
continues leaves first GraphQL calls around 0.9 seconds. Disabling preloading
makes the initial API faster but moves heavy loading to the first editor visit;
it is not an acceptable fix.

Awaited entry preloading does not initialize every SSR module graph. A first
editor visit still delays a concurrent GraphQL call by about 0.8–0.9 seconds on
both the original readiness and the corrected version. Keep that defect and the
historical production capability-budget stall separate. This correction does
not prove full production recovery or identify every startup-bucket stall.

## Validation and prevention

Five readiness regressions cover pending completion, missing hook, preload
failure, GraphQL initialization failure and development behavior. All 7,286
Admin unit tests pass. The important performance guard is at the deployed layer:
fresh `next start`, poll health, send a real first selection, inspect the receipt,
then test a first editor request concurrently with GraphQL. Warm calls and a
mocked readiness promise cannot establish actual framework scheduling behavior.

See the [experiment, production traces and separate closure gates](../../operations/watch-startup-readiness-2026-09-21.md)
and [feat-496](../../roadmap/platform/feat-496-watch-rollout-runtime-recovery.md).
