---
title: "Ship bounded playback recovery and Redis admission readiness"
type: fix
status: active
date: 2026-09-23
origin: docs/roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md
---

# Ship Bounded Playback Recovery

## Scope and Authority

The owner approved investigation, implementation, verification, and normal PR-to-main
merge, followed by a final `ce-compound` documentation pass. This supersedes the
diagnosis-only authorization in plan 002, not its historical evidence. Work remains
in the isolated feat-464 worktree. Production inspection is read-only.

## Requirements

- R1. Preserve exact-payload idempotency and fail-open watching while allowing a
  short dependency interruption to recover before the browser retires evidence.
- R2. Bound mandatory Redis admission before GraphQL execution. Never substitute
  process-local limiting in production or allow a timed-out admission to execute a
  resolver later. Do not promise cancellation after a resolver has already started.
- R3. Production readiness must check the mandatory Redis dependency, including a
  silent connection stall, and recover when Redis recovers.
- R4. Bound retries, request duration, pending dependency operations and cleanup.
  Preserve authorization, privacy, provenance, terminal errors and database schema.
- R5. Verify with real Redis/Postgres/HTTP controls, browser behavior, scoped CI,
  review passes and read-only release checks. Record limitations instead of claiming
  all historical intermittent failures or the entire feat-464 ticket are solved.

## Decisions

Keep three serialized fact attempts with waits of 1 and 8 seconds plus up to 25%
jitter; retain the 5-second browser request deadline and 30-second attempted-fact
age ceiling. Apply the same paced waits to exact-nonce claim retries. Stop scheduling
new attempts after unmount. Context issuance stays single-attempt: it creates a new
server-generated binding, and blindly retrying an ambiguous response can create an
orphan episode. A separate idempotent-issuance design is required before retrying it.

Bound each existing RedisStore get/set to 500ms. The unchanged limiter performs one
get and one set in sequence per field, with fields concurrent. Guard the entire
admission boundary with a monotonic 1-second deadline and the request abort signal
before and after admission. Preserve existing keys, identity rules and rate limits.
Retain at most 1024 unresolved Redis store operations per process; timed-out wire
operations keep their slot until they actually settle. A late store write may update
a rate-limit bucket but must not execute a business mutation. No global ioredis
timeout or offline-queue change.

Readiness retains Next preload and GraphQL initialization gates, then uses a bounded
Redis PING. Only one underlying health PING may remain outstanding. A ready socket
alone does not prove dependency availability. Development health remains unchanged.

## Implementation Units

### U1. Bound Redis admission and readiness

Files: `apps/admin/src/graphql/plugins/rate-limit.ts`, `apps/admin/src/infra/redis.ts`,
`apps/admin/src/infra/redis-availability.ts`, `apps/admin/src/app/api/health/route.ts`
and their colocated tests. Follow existing production/build/development fallback
rules, callback RedisStore API and Next readiness hook.

Execution note: test first. Verify stalled get and set, late settlement, abort,
capacity recovery, ordinary failures, healthy concurrent fields and Redis restart.
Update the owned Docker fixture to require zero durable writes after rejected
admission, while retaining post-commit lost-ack replay as a distinct control.

### U2. Complete browser recovery

Files: `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
and its tests, `apps/web/scripts/verify-playback-recovery-browser.mjs`.

Execution note: extend existing exact-payload tests before changing claim pacing.
Verify healthy behavior, recovery after an eight-second outage, terminal responses,
pending-fact bounds, unmount and unchanged consent/context semantics. Measure local
page-load controls and label synthetic player/API boundaries accurately.

### U3. Review and release

Run sequential `ce-code-review` passes per repository tool mapping. Run unit tests,
real dependency fixture, browser verifier, typechecks, lint, format and diff checks.
Reconcile with current main, create the PR, fix CI failures and merge normally.
Inspect deployment revision and health without triggering a deploy. A failed deploy
or meaningful regression blocks a success claim; an observation gap is not health.

### U4. Final compound documentation

At the end, run `ce-compound` using this task and repository learnings only. Record
causal proof, shipped behavior, verification, release outcome, rollback and residual
gates in the learning/report. Refresh related guidance narrowly. Commit and merge
the final documentation through the same normal PR flow, if the implementation PR
has already merged. Keep feat-464 in progress while its broader gates remain open.

## Risks and Non-Goals

- The shared limiter deadline can reject genuinely slow healthy Redis. Verify healthy
  controls and observe post-release errors; rollback the PR for a material regression.
- A server Request may not reflect a disconnected upstream on every host. The fixed
  admission deadline remains mandatory independent of abort propagation.
- No changes to delivery ranking, feat-496 latency work, timestamp validation,
  persistent browser capabilities, flags, data repair or alert-installation policy.
- A full deployed Watch/Mux/auth fault-injection test is not authorized. Local
  fixtures must state the exact real and simulated boundaries; production checks
  cannot prove recovery from an outage that did not occur in their sample.

## Plan Review

Sequential headless coherence, feasibility, security, scope and adversarial review
found two material constraints incorporated above: a Promise timeout cannot cancel
Redis wire work, so capacity tracks actual settlement; context creation is not
idempotent, so its ambiguous response must not be blindly retried. No unresolved
blocking plan findings remain. The main uncertainty is production latency under
the new admission budget, addressed by healthy controls and release observation.
