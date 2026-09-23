---
title: "Playback retries can exhaust before a brief dependency outage recovers"
date: "2026-09-23"
category: "logic-errors"
module: "Watch playback fact delivery"
problem_type: "logic_error"
component: "frontend_stimulus"
severity: "medium"
symptoms:
  - "A transient playback 503 burst permanently drops the initial playback facts"
  - "Redis reconnects successfully but retired browser event IDs never return"
root_cause: "async_timing"
resolution_type: "code_fix"
tags: [recommendations, playback, redis, retry, idempotency, timers, recovery]
---

# Playback retries need a recovery horizon

## Problem

Three bounded attempts did not guarantee useful recovery. Immediate playback 503s
used up all retries at 0, 100 and 300 ms, then permanently retired the facts.
An approximately eight-second Redis interruption could therefore leave missing
recommendation input even though Redis reconnected normally.

## Symptoms and cause

One retained production trace failed in Admin's mandatory GraphQL Redis limiter
before the playback resolver. A local real-Redis restart reproduces that error,
zero writes during disconnection, automatic reconnection and accepted exact replay.
The infrastructure trigger was a recorded automatic Redis update. This does not
attribute every historical playback failure or prove which requests lost facts.

The recorder's retry timing is the recoverability defect. Admission intentionally
fails closed; enabling an in-memory limiter or an unbounded Redis offline queue
would change enforcement, not repair bounded browser recovery.

## What did not work

- Looking only at health 200 misses unavailable mandatory dependencies: importing
  the GraphQL module does not exercise its Redis-backed limiter.
- Treating caller timeout as proof of no write fails during a silent TCP stall.
  The real fixture commits after caller abort; exact replay returns one stored fact.
- A React-only test proves retry scheduling, not Redis recovery. Conversely, a
  Redis restart test does not prove the browser still retains facts when it recovers.

## Solution

`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
keeps three serialized attempts, with 1,000 ms and 8,000 ms waits plus up to 25%
jitter. The last attempt starts at 9-11.25 seconds for immediate failures. Request
timeouts, queue/body/per-kind budgets and immutable event IDs/payloads are unchanged.
Retire attempt and monotonic-age metadata when a fact is acknowledged or dropped.

An armed retry timer gates every drain entry, including drains requested by new
player events or completion callbacks. Checking only the timer callback itself
would let a `pause` or `seeked` event defeat backoff. Attempted facts at least
30 seconds old are retired before another send; use `performance.now()` so a
device-clock correction cannot extend or prematurely expire the recovery age.

Unmount cancels the retry timer, and a late failed request cannot arm another.
Terminal page-exit keepalive remains a separate best-effort send, including during
backoff, without accelerating earlier failed facts. No capability is written to
persistent storage, no profile/consent rule changes, and known terminal rejections
remain terminal. The release continuation also paces exact-nonce claim retries
with the same waits and stops new attempts after unmount. Initial context issuance
remains single-attempt because creating a new binding is not an idempotent retry.

## Why this works

The browser still owns identical facts when the dependency can accept them again.
An ambiguous earlier request can safely converge through the server's existing
event-ID plus payload-digest replay contract. Longer spacing, not extra attempts,
provides the recovery horizon. This does not eliminate the Redis outage or promise
delivery after navigation, page termination, long outages or rejected capabilities.

## Prevention and proof

- Fail an eight-second outage regression on the baseline before implementing the
  timing change. Assert actual attempt times and byte-identical request bodies.
- Test both delays, missing/malformed receipts, exhaustion, new events during
  backoff, monotonic expiry, wall-clock jumps and unmount before/after settlement.
- Keep the real Redis/Postgres fixture: restart, silent stall, caller abort, lost
  acknowledgement, exact replay, and cleanup of owned loopback-only resources.
- Run `node apps/web/scripts/verify-playback-recovery-browser.mjs`. The Chrome
  fixture compares baseline/current recorders through real HTTP with a synthetic
  API/player. Keep its scope distinct from authenticated full-stack verification.
- Snapshot browser measurements before navigation. Retaining mutable arrays lets
  later pagehide keepalives silently alter an earlier request-count result.
- Measure healthy startup/request count and bundle size; do not add a network or
  dependency-readiness wait to player startup to repair telemetry.

The release continuation also bounds shared Redis admission before resolver
execution and adds Redis-aware readiness. These do not cancel already-running
transactions or promise infrastructure availability. Initial context issuance
recovery and broader production acceptance remain separate gates. See the
[investigation and verification report](../../operations/watch-intermittent-evidence-investigation-2026-09-23.md#release-continuation)
for the current release outcome.

## Related

- [Accepted source-neutral short-watch feedback](source-neutral-playback-recent-history-20260915.md) describes how accepted facts affect recommendations; it cannot recover facts never delivered.
- [Recommendation boundary pattern](../architecture-patterns/production-recommendation-boundary-hardening-pattern.md) covers immutable replay, privacy and lifecycle constraints.
- [Next startup readiness](../performance-issues/next-background-preload-can-outlive-readiness.md) covers module initialization, not runtime dependency availability.
- [feat-464](../../roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md) retains the broader production acceptance gates.
