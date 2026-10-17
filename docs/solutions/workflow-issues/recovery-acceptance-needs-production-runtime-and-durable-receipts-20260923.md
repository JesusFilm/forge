---
title: "Recovery acceptance needs production runtime and durable receipts"
date: "2026-09-23"
category: workflow-issues
module: "Recommendation evidence acceptance"
problem_type: workflow_issue
component: testing_framework
severity: high
applies_when:
  - "Verifying cancellation, dependency recovery, or acknowledgement loss across browser and database boundaries"
  - "Turning isolated service tests into a joined Web/Admin acceptance fixture"
tags:
  [
    recommendations,
    recovery,
    browser,
    postgres,
    redis,
    cancellation,
    acceptance,
  ]
---

# Recovery acceptance needs production runtime and durable receipts

## Context

Feat-464's isolated Redis/PostgreSQL/Yoga controls and recorder tests covered
different boundaries. Joining Chrome, real Next Web/Admin routes and PostgreSQL
exposed fixture shortcuts that could falsely pass outage acceptance. The shipped
admission/retry implementation did not require another application change.

## Guidance

1. Use `next build`/`next start` when proving production limiter behavior. A
   development fallback can accept evidence during an outage and invalidate the
   control. Assert the expected failure before claiming recovery.
2. Provision an owned database with the full migration history. `prisma db push`
   creates model tables but omits migration-owned functions such as submission
   budgets. Missing fixture SQL is not a demonstrated application defect.
3. Give Web and Admin separate owned Redis instances. Pause or restart only the
   dependency whose boundary is being measured. Bind disposable services to
   loopback, record ownership, and remove only those services afterward.
4. For cancellation, wait until the real admission GET is pending, abort the
   caller, recover Redis, and await admission completion. Assert zero resolver
   calls and zero facts while recovery is still below the store deadline. Remove
   only the post-admission abort fence as a negative control: the test must fail.
5. Drop the socket only after the real commit to test acknowledgement loss.
   Record both server attempts and browser observations. Chrome may transparently
   repeat the POST before JavaScript sees an error; that is distinct from an
   application retry and still requires durable idempotency.
6. Verify original event identity, canonical digest, exact payload, sequence,
   browser receipt and replay-to-original binding. Stop the synthetic player
   clock before a snapshot; label a later post-unmount snapshot separately
   because departure events can legitimately add facts.

Use exactly representable binary fractions in a focused exact-payload fixture.
Keep decimal round-trip diagnostics separate: Prisma/PostgreSQL numeric JSON
representation can differ by a few ULPs. This is not permission to change the
incoming payload digest or weaken exact replay validation.

## Why this matters

HTTP 200 alone does not establish one durable write or browser acknowledgement.
A late resolver can also be masked by a timeout: recovering after the deadline
does not prove the cancellation fence. Independent counters and a narrowly
targeted negative control distinguish those causes.

## Example and limits

The added test in
`apps/admin/src/graphql/plugins/rate-limit-recovery.db.test.ts` recovered in
107 ms, below the 500 ms store deadline, with zero resolver calls and facts.
Removing only the post-admission abort check caused one resolver execution and
failed the assertion. The restored eight-test suite passed.

The joined local fixture passed eight scenarios: healthy, lost fact acknowledgement,
disconnect, silent stall, terminal binding, exhaustion, claim disconnect and lost
claim acknowledgement. It used real consumer-bearer authorization and signed
capabilities but a synthetic player/page shell. It does not prove the complete
Watch/Mux lifecycle, Admin user OAuth, or a naturally occurring production outage.
Keep those populations and any missing production coverage explicit.

## Related

- [Acceptance record and sanitized evidence](../../operations/recommendation-evidence-acceptance-2026-09-23.md).
- [Redis admission must bound late work](../runtime-errors/redis-admission-timeouts-must-bound-late-work-20260923.md): the shipped runtime mechanism.
- [Retry horizon](../logic-errors/playback-retries-exhaust-before-dependency-recovery-20260923.md): pacing and retry ownership.
- [Built runtime boundaries](../integration-issues/studio-calendar-built-runtime-boundaries.md): related deployment-shaped fixture guidance.
- [Production numeric audit](../../operations/recommendation-evidence-production-integrity-2026-09-10.md): retained numeric round-trip limits.
