---
title: "Redis admission timeouts must bound late work, not only caller waiting"
date: "2026-09-23"
category: "runtime-errors"
module: "Admin GraphQL admission and production readiness"
problem_type: "runtime_error"
component: "service_object"
severity: "high"
symptoms:
  - "Playback fails before its resolver during a mandatory Redis limiter outage"
  - "A caller aborts during a silent Redis stall but the resolver later commits"
  - "Health returns 200 while the mandatory dependency cannot admit requests"
root_cause: "async_timing"
resolution_type: "code_fix"
tags: [redis, admission, deadlines, readiness, idempotency, recovery, graphql]
---

# Bound Redis Admission Before Business Execution

## Problem

A caller-side timeout did not stop Admin's pending Redis admission from eventually
starting a business mutation. At the same time, initialization-only readiness could
report healthy while the mandatory limiter was unavailable. Both defects obscured
the distinction between rejected admission and an ambiguously acknowledged commit.

## Symptoms

- One retained production trace from the September 22 automatic Redis update has
  Admin HTTP 500 in 7.1ms, then Web playback HTTP 503 in 10.6ms. The error is
  `Stream isn't writeable and enableOfflineQueue options is false`, before the
  playback resolver. The burst contains 19 playback 503s; this one trace does not
  establish the action or root cause of every request in that population.
- The baseline real Redis/Postgres fixture reproduces a different failure mode:
  silent TCP stall, caller abort at about three seconds, then a late durable fact
  after Redis resumes. Automatic reconnection alone does not bound business work.
- Baseline health can return 200 after GraphQL initialization even when Redis
  admission fails. A connected socket alone also cannot detect a silent stall.

Redis was not removed from production admission. Removing an optional evidence
counter store did not remove the mandatory GraphQL rate limiter. This fix retains
Redis, the limiter's identities, keys, limits and fail-closed production behavior.

## What Didn't Work

- Treating fetch abort or `Promise.race` rejection as cancellation. The underlying
  Redis command can still settle, and an unguarded continuation can run a resolver.
- Releasing a pending-operation slot when its caller times out. Repeated callers
  then accumulate unresolved wire work despite an apparently bounded wrapper.
- Using only an initialization health probe, or interpreting HTTP 200 as semantic
  success. GraphQL errors and recommendation fallbacks need separate accounting.
- Increasing browser attempts without measuring the recovery horizon. Three fast
  failures exhausted facts in roughly 300ms and claims in 500ms, before the observed
  eight-second interruption ended. Caller pacing is a complementary fix, not a
  substitute for bounded server admission.

## Solution

`apps/admin/src/infra/redis-availability.ts` supplies
`createRedisOperationGuard(timeoutMs, maxPending)`. It rejects the observer after
the budget, verifies the monotonic deadline again at successful settlement, and
keeps capacity occupied until the underlying operation actually settles. Both late
fulfillment and rejection are handled. It does not cancel a Redis command or
disconnect the shared ioredis client.

`apps/admin/src/graphql/plugins/rate-limit.ts` wraps the existing RedisStore get
and set with a 500ms budget and 1024 unresolved operations per process. It checks
the request abort signal before and after the existing Envelop admission hook and
rejects admission that completes at or beyond a one-second monotonic deadline.
No business resolver may start after that rejection. Availability errors never
fall through to process-local limiting, including in development fallback paths.

The important ordering is:

```text
check caller signal
await existing admission through bounded Redis get/set
check caller signal and monotonic admission deadline
only then allow GraphQL execution
```

`apps/admin/src/app/api/health/route.ts` retains the Next preload and GraphQL import
gates, shares GraphQL initialization, then checks a shared 500ms Redis PING. At
most one underlying health probe remains unresolved. If it times out, later health
calls return 503 without adding wire probes until it settles. Readiness recovers
after Redis recovers; development health behavior remains unchanged. The probe
does not invoke a GraphQL operation or mutation.

The accompanying browser change keeps three serialized fact attempts and three
exact-nonce claim attempts, spaced by 1/8-second waits plus up to 25% jitter. Fact
attempt age is bounded at 30 seconds, each request retains its five-second timeout,
and unmount stops scheduling new retries. See the separate
[retry-horizon learning](../logic-errors/playback-retries-exhaust-before-dependency-recovery-20260923.md)
for that lifecycle contract. Initial context creation remains single-attempt:
creating a fresh server-generated binding is not an idempotent ambiguous replay.

## Why This Works

The guard separates three events that must not be conflated: the caller stops
waiting, Redis wire work settles, and business execution begins. Bounding the first
while tracking the second prevents unlimited pending work. Rejecting at the third
prevents a delayed admission from starting a mutation after its budget expires.

This is not universal cancellation. A late limiter SET can still update a rate
bucket. A business transaction that already started can still commit after caller
disconnection; exact event-ID/payload-digest replay remains necessary. Likewise,
successful readiness cannot prevent a dependency outage immediately afterwards.

## Prevention

- Test both GET and SET stalls, delayed timer callbacks, caller abort, capacity
  exhaustion, late rejection, recovery and concurrent healthy admission. Assert
  resolver-call counts and durable facts, not just the outward HTTP status.
- Preserve `redis-availability.test.ts`, `rate-limit-deadline.test.ts`,
  `rate-limit-availability.test.ts` and `app/api/health/route.test.ts` under
  `apps/admin/src/`. Yoga may expose an aborted operation as HTTP 200 with GraphQL
  errors; the invariant is no resolver execution, not one universal HTTP mapping.
- Run `apps/admin/src/graphql/plugins/rate-limit-recovery.db.test.ts` with both
  `RECOMMENDATION_DB_TEST=1` and `RECOMMENDATION_REDIS_TEST=1`. The owned fixture uses
  loopback-only disposable Redis/Postgres, real Yoga HTTP and playback services.
  It is a minimal schema with a synthetic consumer, not the deployed auth stack.
- Keep post-commit socket-loss replay separate from pre-execution rejection. The
  former must retain exactly one fact; the latter must retain zero until a fresh
  explicit retry. Do not weaken one assertion to make the other pass.
- Check actual deployed revisions and semantic outcomes after the normal PR flow.
  Compare primary HTTP counts against indexed logs; keep unmatched populations and
  small samples visible. No outage in a sample means no production recovery test.

The final seven real-dependency controls pass: three restarts recover; a 100ms
stall succeeds; the bounded stall rejects admission in 504ms with health 503 and
zero facts even after wire work drains; an explicit retry accepts one fact; and
post-commit lost acknowledgement converges on one fact. Fourteen Chrome/HTTP
controls also pass, including eight-second fact and claim outages. These are
local causal proofs, not a claim that all intermittent production failures ended.

[PR #2404](https://github.com/JesusFilm/forge/pull/2404) merged as
`37e10b622bd66e55647cf561c3896b2d4fbb4dce` on September 23. The
[release report](../../operations/watch-intermittent-evidence-investigation-2026-09-23.md#release-continuation)
contains deployment and observation evidence. The broader feat-464 acceptance,
fresh integrity audit, installed-monitoring policy and initial-issuance recovery
are separate gates. Roll back a material regression with a normal revert PR;
do not bypass Redis or deploy local worktree code directly to production.

## Related Issues

- [Next startup readiness](../performance-issues/next-background-preload-can-outlive-readiness.md): module initialization remains a separate prerequisite.
- [Recommendation boundary pattern](../architecture-patterns/production-recommendation-boundary-hardening-pattern.md): immutable replay and privacy/lifecycle invariants.
- [Web Redis clock uncertainty](../performance-issues/redis-clock-sample-can-expire-admission-early-20260915.md): a distinct Lua/deadline algorithm, not this Admin RedisStore guard.
- [Web main-thread callback interference](../performance-issues/page-rendering-blocks-redis-admission-callbacks-20260915.md): a separate worker-isolation boundary.
- [Shared Web Redis cache cleanup](../performance-issues/shared-redis-cache-cleanup-blocks-admission-20260916.md): bounded cleanup commands address another source of Redis delay.
- [feat-464](../../roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md): broader evidence acceptance remains in progress.
