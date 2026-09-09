---
title: Diagnose recommendation admission and finish production gates
type: fix
status: active
date: 2026-09-09
---

# Recommendation admission production gates

Continuation of content-discovery feat-464 after PRs #2211–#2213. The isolated
branch starts at `448f06be`; unrelated worktrees remain untouched.

## Investigation and decisions

Production context requests still fail as `admission_unavailable` on primary Web
revision `d7cefafc`. Retained traces show both approximately 250 ms and immediate
failures, but no Redis command spans. These observations do not distinguish
connection establishment, command latency, event-loop delay, Redis-clock deadline
rejection, or the subsequent one-second backoff.

First add failure-only diagnostics in
`apps/web/src/lib/recommendation-mutation-admission.ts`, covering configuration,
connection, backoff, loading, TIME and EVAL. Emit only internal fixed reason/stage
values and clamped durations. No raw errors, Redis URL, headers, bucket keys,
identifiers or capabilities. Logger failures remain isolated. Preserve existing
Redis behavior, admission limits, and all deadlines for this diagnostic release.

Use production observations from the diagnostic release to establish the causal
chain before choosing a behavioral repair. Test the confirmed mechanism with
deterministic timing and real Redis where applicable. Keep admission fail-closed
and the complete recommendation deadline at 1.5 seconds.

## Validation and release

- Cover connection/backoff, TIME/EVAL timeout, Redis deadline rejection, malformed
  clock/result, privacy and logger failure isolation. Run existing admission and
  recorder/route regressions and real Redis integration.
- Run Web/Admin tests, lint and typechecks; formatting and CI checks; real
  PostgreSQL concurrency and a fresh decoded browser Watch-to-Admin lifecycle.
- Review correctness, reliability, privacy, contracts and regression coverage.
  Commit, push and merge only after applicable checks pass, using normal main
  autodeployment. Diagnostic deployment is not a resolved admission incident.
- Resolve current primary deployments and scope metrics/logs by verified revision
  and environment. Run the two-hour post-fix canary with request numerator and
  denominator, exclusions, crawler rejection, definitive bindings, replay/conflict
  behavior and five-minute reconciliation cadence.
- Reconcile the historical and clean windows against authorized durable evidence;
  preserve uncertainty where historical provenance cannot identify machine roots.
- Verify installed monitors and obtain the fresh authorized current-pointer audit.
  The owner restricts Datadog work to existing read access; missing monitor
  installation remains an explicit unmet gate.
- Keep feat-464/459/447 in progress until their respective production gates pass.
  Keep `active-watch-proxy-v1` comparison-only; do not enable ranking, experiments,
  promotion or learning, and do not modify issues #2141–#2148.
