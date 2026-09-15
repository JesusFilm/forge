---
title: "A delayed Redis clock sample can reject admission before its caller deadline"
date: "2026-09-15"
category: "performance-issues"
module: "Watch recommendation Redis admission"
problem_type: "performance_issue"
component: "service_object"
severity: "high"
symptoms:
  - "Profile HTTP 503 completes inside its 250 ms command budget."
  - "Admission logs report redis_deadline rather than timeout."
root_cause: "async_timing"
resolution_type: "code_fix"
tags: ["redis", "recommendations", "deadline", "clock-skew", "retry"]
---

## Cause and evidence

After the ETag CPU fix #2297, primary production trace
`6aa88db600000000152e8555b42ca02f` returned HTTP 503 in 184 ms. Admission logged
`stage=eval reason=redis_deadline durationMs=46 budgetMs=115`. The TIME response
consumed approximately 135 ms, but its timestamp had already been sampled on
Redis. Adding the caller's remaining 115 ms to that old sample produced a
conservative deadline that expired before the actual 250 ms caller budget.

This conservatism is necessary: Web and Redis clocks need not agree, and a
queued EVAL must not increment rate-limit counters after the caller times out.
A `redis_deadline` reply is distinct from a transport timeout: the Lua script
returns `unavailable` **before any bucket reads or mutations**.

## Fix

`apps/web/src/lib/recommendation-mutation-admission.ts` refreshes TIME and
retries EVAL once, only after that explicit no-mutation result. Both attempts
share the original monotonic start and command budget. Every later command
receives only the remaining budget. Exhaustion, a second expired sample, a rate
limit, invalid data, a connection failure, or a command timeout ends admission.
Unknown EVAL outcomes are never retried. Redis still checks its own deadline
before touching either bucket. Shared-client retirement and draining are
unchanged.

Do not substitute the application wall clock, increase timeouts, retry unknown
mutations, or proactively issue extra TIME calls based on an arbitrary latency
threshold. A slow outbound TIME can still provide a useful sample; unnecessary
refreshing consumes its remaining budget.

## Verification

The new real-Redis reproduction delays the first sampled TIME by 135 ms and the
first EVAL by 46 ms. It failed against the previous implementation and passes
with the fix: two TIME/EVAL attempts, one increment in each bucket.

The real-Redis suite also delays the _retried_ EVAL until after the caller
returns. Redis returns `unavailable` and both buckets remain absent. Existing
atomic-limit, separate privacy capacity, 160 ms playback TIME delay, and late
first-EVAL tests still pass. Unit tests cover one-retry maximum, exhaustion
before refreshing, original-budget timeout during refresh, and no retries for
rate limits, invalid replies, transport errors or ambiguous timeouts. The
focused suites pass 29 tests, including five against real Redis; all 4,262 Web
unit tests pass.

## Scope and future diagnosis

This fixes early expiration, not actual event-loop stalls beyond the command
budget. Later production logs at 00:17:54 UTC still showed a genuine EVAL timeout
on revision `4487a97c...`, requiring continued runtime observation. Never claim
all production timeouts are gone from a short successful smoke test or from a
hidden homepage block.

Use the failure stage/reason together with the complete trace and actual
primary host. Logs carry revision in `ddtags`; APM uses `@version`. Do not infer
zero failures from applying an APM field filter to logs. See the companion
`watch-etag-hashing-starves-recommendation-admission-20260915.md` and
`contextual-recommendations-repeat-catalog-work-20260915.md` learnings.
