---
title: "Cached Watch page hashing can starve recommendation admission"
date: "2026-09-15"
category: "performance-issues"
module: "apps/web request runtime"
problem_type: "performance_issue"
component: "service_object"
severity: "high"
symptoms:
  - "Recommendation profile and playback requests intermittently return admission_unavailable."
  - "Redis TIME/EVAL timers fire late while cached catalog pages are being served."
root_cause: "async_timing"
resolution_type: "config_change"
tags:
  - "recommendations"
  - "nextjs"
  - "etag"
  - "redis"
  - "event-loop"
  - "cpu-profile"
---

## Cause

The English language inventory response is approximately 9.5 MB, confirmed on
both the local catalog clone and production. Next.js 16.2.4 computes its FNV
ETag synchronously over the complete cached HTML/RSC response on every request.
Redis-backed ISR avoids rendering again, but does not avoid this hashing.

The Web request thread also handles recommendation admission's Redis replies
and timers. Serving large cached pages can therefore keep otherwise healthy
admission work from completing within its 250 ms command budget. The first
timeout retires the connection; nearby callers then encounter its existing
bounded backoff. The conservative Redis-clock deadline can also expire before
the EVAL is sent after a delayed TIME reply. Changing those safeguards would
hide the cost rather than remove it.

The first local mixed-page CPU profile spent about 8.7 seconds of a 20-second
sample inside ETag generation. Cache deserialization was a smaller additional
cost. Individual GC pauses and private-network configuration did not explain
the measured hashing hotspot.

## Fix and tradeoff

Set `generateEtags: false` in `apps/web/next.config.mjs`. This is the supported
[Next.js configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/generateEtags).
ISR and Cache-Control remain enabled. This removes Next's generated page
validators: conditional requests relying on those validators receive a normal
response instead of a 304. Explicit application ETags and immutable static-asset
caching are separate mechanisms.

The fix does not alter recommendation deadlines, Redis atomic limits, fail-closed
admission, identity, ranking, curated pools or the homepage launch gate.

## Discriminating reproduction

Use production builds, local Redis and a local catalog clone. Warm `/watch`,
`/watch/chosen-witness.html` and `/watch/english.html/videos`. Four page callers
loop through these routes with a 100 ms pause; a separate caller sends profile
status once per second. Status is read-only and does not opt a viewer into a
profile. No builds or test suites run concurrently with measurements.

The matched 20-second CPU-profile runs gave:

| Observation               | Generated ETags           | ETags disabled            |
| ------------------------- | ------------------------- | ------------------------- |
| Profile results           | 14 successful, 3 HTTP 503 | 20 successful, 0 HTTP 503 |
| Maximum event-loop delay  | 481 ms                    | 155 ms                    |
| p99 event-loop delay      | 424 ms                    | 146 ms                    |
| Completed page requests   | 132                       | 236                       |
| Catalog response size     | 9,486,940 bytes           | 9,486,940 bytes           |
| Catalog p95 response time | 735 ms                    | 345 ms                    |

This is a closed-loop throughput comparison: the faster candidate completes
more requests. It is not a fixed arrival-rate production forecast. The identical
catalog size and disappearance of the hash frames establish that page content
was not removed to obtain the improvement.

The committed, bounded reproduction can run without an inspector:

```bash
node apps/web/scripts/probe-recommendation-runtime.mjs \
  --base=http://localhost:3062
```

Use `--origin` when the local build's canonical origin differs from its listening
port. `--allow-failures` records a control run without treating observed profile
failures as a failed command. The probe refuses non-loopback origins, rejects
redirects, and retains only status, timing, byte counts and cache headers. The
preview itself must use local dependencies.

An independent run of this committed probe (without CPU profiling) reproduced
3 failures in 17 profile calls on the control and zero failures in 19 calls on
the candidate. Catalog p95 fell from 734 ms to 346 ms. Both builds retained the
same catalog byte count and `s-maxage=60, stale-while-revalidate=31535940`.

The full Web suite passed 4,177 tests, plus all three real-Redis admission
regressions. The production build, scoped lint and script syntax checks passed.
Browser checks loaded home, the English inventory and Chosen Witness without
JavaScript errors; the inventory retained 1,000 rendered video entries and
playback progressed beyond 35 seconds. These are local results, separate from
post-deployment verification.

## What did not establish a fix

- An ad hoc custom server overriding `generateEtags` without rebuilding still
  emitted ETags: App Router compilation had retained the build configuration.
  Check the actual response header and profile, then rebuild for comparison.
- The first HTTP probe omitted `sec-fetch-site: same-origin` and was correctly
  rejected before admission. Those 403s are invalid evidence of recovery.
- Admin token introspection looked like a possible unrelated delay in source,
  but its credentials were absent in production. It was not changed.
- A successful isolated request, or a hidden recommendation row, does not
  establish healthy behavior under concurrent catalog traffic.

## Prevention and remaining scope

Small unit fixtures cannot reveal full-catalog hashing costs. Keep the load
probe alongside unit coverage, and inspect maximum delay as well as averages.
Profile large **cached** HTML and RSC payloads when a cheap API times out on the
same runtime. Inspect both the first failure and the subsequent backoff cluster.

The 9.5 MB catalog remains large; JSON decoding still consumes CPU. Do not
silently remove items or alter the inventory's filter/navigation semantics as
part of an admission fix. A future inventory payload reduction needs its own
behavior and accessibility checks.

This reproduction proves a Web starvation cause. It does not explain every
historical Admin transaction timeout. Confirm the deployed revision through
fixed production windows before closing `feat-496`.

Related: [browser recovery budgets](../ui-bugs/homepage-recommendation-recovery-budget-20260915.md)
and `docs/operations/watch-runtime-diagnosis-2026-09-14.md`.
