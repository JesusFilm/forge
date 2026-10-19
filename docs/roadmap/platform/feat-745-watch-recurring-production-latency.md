---
id: "feat-745"
title: "Diagnose and repair recurring Watch production latency"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-10-19"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "performance"
  - "infrastructure"
---

## Problem

Watch repeatedly stalls despite HTTP 200 and Next cache HIT responses. Checkly times out across two regions. Container RAM and aggregate CPU headroom do not explain the incident. Deployment correlation is not yet causal attribution.

## Entry Points — Read These First

1. `docs/plans/2026-10-19-watch-production-latency-investigation.md`: evidence, access IDs, ordered investigation and acceptance.
2. `apps/web/cache-handler.mjs`, `apps/web/src/instrumentation.ts`, `apps/web/next.config.mjs`: cache hot path and startup.
3. `apps/web/railway.toml`, `apps/web/src/proxy.ts`, `packages/feature-flags/src/launchdarkly.ts`: deployment and request work.

## Grep These

`x-nextjs-cache`, `keyPrefix`, `revalidateTag`, `waitForInitialization`, `generateEtags`, `forgeWebCacheHandlerConfig`, `NEXT_CACHE_REDIS_PREFIX`.

## What To Build

Execute the linked investigation; attribute slow cache-hit latency, reproduce the mechanism, and prepare the smallest evidence-supported repair with a regression test and before/after performance measurements. Persist a sanitized incident report.

## Constraints

Read-only production diagnosis. No cache purge, restart, rollback, scaling, flag changes or manual deployment. Normal PR-to-main rollout. Preserve analytics and cache semantics. Do not fold separately scoped transient-renderer work from feat-700 into this task without justification and scope review.

## Verification

Comparable warm/cold production-mode measurements and a discriminating regression test; relevant package checks; trace and infrastructure evidence; explicit separation of local verification from pending production recovery. Follow disk admission rules for all heavy operations.

## Progress — 2026-10-19

Findings are in `docs/reports/2026-10-19-watch-production-latency-incident.md`
(revision 2, 18:45 UTC). Sanitized evidence and exact queries are in
`docs/reports/2026-10-19-watch-production-latency-evidence/`.

- Measured: the single Web main thread is ~99% runnable (17–33% of it waiting
  for a CPU). Every request class queues, including static files. 140–330
  requests are in flight, and 39% end as 499.
- Measured: the origin completes ~13 requests/s now against 25–30/s before
  onset. Arrival load is not observed, so a traffic surge is not ruled out.
- Matched pair: two cache HITs on `/watch`, same replica, 82 s apart, TTFB
  37.5 s vs 1.45 s. Where the 36 s goes inside the process is not yet
  measured.
- Leading hypothesis: host CPU contention on a near-capacity main thread. Not
  confirmed against the predecessor. More work per request (+39% CPU per
  completed request) is not excluded.
- Instrumentation in PR #2815: per-replica identity on gauges, `runtime-id` on
  runtime metrics, main-thread metric naming, sample-interval gauge, and
  `next.cache.get`/`next.cache.set` spans with outcome and codec time.

Still open (keep in progress):

- After PR #2815 deploys: split a kept slow-HIT trace with the new cache spans.
- Owner decision on a same-commit redeploy (recovery attempt, not a placement
  test) and on running more than one Web replica, after the listed
  prerequisites are verified.
- Production acceptance from the report, with thresholds re-baselined on an
  unaffected day.

## Takeover — 2026-10-20 NZDT

Tatai now owns the investigation. See
`docs/reports/2026-10-20-watch-investigation-takeover.md` for the PR review,
fresh production evidence and ordered experiments. The archived chat
**Diagnose Watch performance reports** already applied an authorized second
replica; PR #2816 preserves it and tracks the separate `feat-747` repair.
The earlier owner-decision item above is historical and does not mean scaling
is still unapplied.

Review found and fixed one telemetry crash path: exceptions from scheduler
metric/log hooks could escape the timer callback. Two regression cases were
observed red before the guards; the observability suite now passes 45/45.
Root cause, telemetry rollout and the full recovery acceptance remain open;
keep this ticket in progress. Current public HIT probes are much faster, but
short samples and unmatched traffic do not prove sustained recovery.
