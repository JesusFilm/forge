---
title: "Page processing can time out healthy Redis admission on the same Node event loop"
date: "2026-09-15"
category: "performance-issues"
module: "Watch recommendation Redis admission"
problem_type: "performance_issue"
component: "service_object"
severity: "high"
symptoms:
  - "Redis TIME expires at 348 ms despite healthy private-network Redis."
  - "One failed gate produces backoff failures on concurrent recommendation requests."
root_cause: "async_timing"
resolution_type: "code_fix"
tags: ["redis", "recommendations", "node", "workers", "event-loop", "deadline"]
---

## Cause and evidence

After the ETag and conservative-clock fixes, primary-host profile trace
`4122266214311152701` still failed at 01:16:23 UTC on Web cc252f9d.
TIME logged 348 ms on its 250 ms command budget. The same release recorded a 559 ms
maximum event-loop stall. Redis uses the Railway private network. Large cached
HTML/Flight values still require synchronous JSON decoding and response encoding
on Web's page-rendering loop; its timers and Redis callbacks share that loop.

The discriminating real-Redis test sends TIME, then blocks the main loop for 350 ms.
The original algorithm fails closed with untouched counters. Running that exact
algorithm on a separate thread succeeds even while the main loop is blocked for 650 ms.
This isolates callback starvation from Redis slowness and the previous stale-clock
bug. The main thread cannot respond while blocked, but successful work completed
inside its deadline must not become an artificial 503 when it resumes.

## Fix and invariants

- `apps/web/src/lib/recommendation-redis-admission.ts` holds the existing shared
  implementation: atomic Lua, Redis-clock deadline, single proven-safe refresh,
  per-client/aggregate limits, connection backoff and active-admission draining.
- `recommendation-admission-worker.ts` runs that core on one Node thread. Only
  HMAC-derived keys, namespace, deadline and result cross the message channel.
- `recommendation-admission-worker-client.ts` shares one client through process
  global state, caps pending requests, and rejects worker failure or late work.
  The worker receives only its Redis configuration, without application session
  secrets, request headers or inherited instrumentation options.
- Existing 250 ms connection and 250 ms command limits (500 ms playback-context
  commands) remain. Thread startup/queueing consumes the 500/750 ms total ceiling.
  A queued request cannot begin work after that deadline. Unknown mutations are
  never retried; Lua still checks Redis time before incrementing either bucket.
- When the main watchdog fires, `receiveMessageOnPort` first drains results
  already completed within the original deadline. Otherwise a blocked loop could
  run its overdue timer before the queued success callback and recreate the bug.
  Timeout retires the worker only after concurrent admissions drain.
- The normal Web build separately compiles the native Node worker into
  `.next/admission-worker`. Use Node's runtime constructor so Turbopack does not
  infer a broad dynamic Web Worker import and bundle application tests/assets.
- Log a failure from the calling request's Promise continuation. A shared
  MessagePort listener inherits the context of the request that created it and
  can attribute subsequent failures to the wrong trace. An AsyncLocalStorage
  red/green test verifies that concurrent failures retain their own request IDs.

## Validation

Real Redis reproduces the original failure and the worker success, exact counter
increments, rate limits and separate privacy capacity. The original tests still
cover late initial/retried EVALs leaving no counters. Worker lifecycle tests cover
pending bounds, completed-after-deadline rejection, exit/backoff and concurrent
playback draining. Full build, performance and production evidence are recorded
in the linked plan and final operations report before marking recovery complete.

## Rejected alternatives and verification discipline

Decoded-page memoization improved common latency but retained large stalls.
Moving whole 23 MB cache values to a JSON worker reduced p99 loop delay 127→84 ms
but worsened catalog p95 330→457 ms and video p95 217→347 ms. Neither cache experiment
was shipped. Isolating the small admission operation avoids copying page payloads
between threads and leaves cache storage/invalidation unchanged.

Always rebuild the control from the same source/dependency versions: an initial
control had stale output (9.5 MB catalog), while the actual current page was 7.1 MB.
Discard that comparison. A clean six-minute production window also proved
insufficient: genuine profile failures recurred a minute later. Use actual route
populations, fixed revision windows, complete traces and fresh playback/API probes.
Give separately built local previews different cache prefixes: cached HTML from
another build can point at missing JavaScript chunks and invalidate browser results.

See `docs/plans/2026-09-15-fix-admission-event-loop-isolation.md` and
`redis-clock-sample-can-expire-admission-early-20260915.md`. The final deployment,
test populations and production observations are recorded in
`docs/operations/watch-runtime-recovery-2026-09-15.md`.
