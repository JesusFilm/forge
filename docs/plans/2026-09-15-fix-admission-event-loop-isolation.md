---
title: "Isolate recommendation Redis admission from page processing"
type: fix
status: in-progress
date: 2026-09-15
roadmap: feat-496
---

## Confirmed residual and discriminating reproduction

Primary-host profile TIME timed out at 348 ms on its 250 ms budget at 01:16:23UTC,
trace4122266214311152701, after #2299. Cached page decoding occupies the same
Node event loop. Moving large page values across worker threads reduced stalls
but regressed catalog p95 from 330 ms to 457 ms, so that experiment was rejected.

Test the architectural seam instead: block the main event loop while Redis is
healthy. The current main-thread TIME/EVAL sequence should fail; the identical
sequence on a dedicated thread should complete inside its unchanged deadline.
Only tiny digested keys and an admission result cross the worker boundary.

## Scope and invariants

- Extract the existing Redis algorithm into one shared TypeScript module; retain
  Lua, limits, clock refresh, draining, connection backoff and injected tests.
- Build a Node worker with TypeScript as part of the normal Web build. Production
  admission uses one lazy worker; development and injected tests share the core.
- Bound pending requests and preserve 250 ms connection plus 250 ms command budget
  (500ms command for playback context). Worker queuing/startup consumes the total
  budget. Lua still rejects late mutations using Redis's own clock.
- Drain completed worker messages synchronously when the main watchdog fires, so
  a delayed main event loop does not discard work completed within the deadline.
- Fail closed on worker exit, overload or late work; never retry ambiguous writes.
- Keep homepage removed and flag off; no cache policy or mobile/TV changes.

## Verification

Real Redis red/green main-loop-block reproduction, no late bucket mutations,
limits, worker failure/queue handling, full Web tests/types/lint/build, built
mixed-page performance and browser playback/feedback, review and normal PR/main
production deploy. Record fixed production windows without claiming zero forever.

## Local verification completed

- Full Web suite: 4,270 passed. Final focused tests: 29 passed; real Redis: eight
  passed in the existing CI Redis entrypoint, including the blocked-loop proof.
- Full typecheck, lint and production build passed. The build includes both
  native worker files under `.next/admission-worker`.
- Matched source revisions show equivalent mixed-page throughput (294 versus
  296 requests over20 seconds), with no failed concurrent profile calls. The
  main loop still performs page processing; that work is isolated from admission.
- Fresh-build browser journey passed on its configured localhost origin: six
  cards, selection200,36 seconds playback, playback/evidence200, return/refetch
  six cards, zero browser exceptions. Use a separate local Redis prefix per
  preview build, and match its configured canonical origin; stale chunk references
  and origin403s invalidate the browser test setup.
- Sequential Compound Engineering review found no unresolved code findings.
  Production rollout and fixed-window observations remain pending.
