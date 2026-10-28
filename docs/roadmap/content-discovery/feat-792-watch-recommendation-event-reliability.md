---
id: "feat-792"
title: "Restore Watch recommendation event acknowledgements"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-10-27"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "recommendations"
  - "reliability"
---

## Problem

The supplied telemetry review reports that during 25 Oct 18:40–26 Oct 18:40
UTC, Watch recommendation event routes returned 7,108 HTTP 503s. The affected
routes record surface exposure,
playback, profile transitions and selection; these responses do not establish
that video playback failed. A sampled playback request reached Web's 3-second
Admin deadline while Admin's write was still running. Successful Admin exposure
writes later had sampled p50 1.415 seconds and p95 1.628 seconds, exceeding
Web's 900 ms exposure deadline. Admin's ten-connection main pool was full and
many acquisitions waited, but the cause of the shared database slowdown is
unconfirmed.

The exposure browser also aborts at 700 ms, before Web's 900 ms Admin deadline,
and removes facts from its queue before a receipt. Ambiguous failures can thus
both repeat writes and lose event coverage.

## Entry Points — Read These First

1. `apps/web/src/components/recommendations/WatchExposureBoundary.tsx` —
   exposure queue, delivery issuance and browser deadlines.
2. `apps/web/src/lib/recommendation-timeouts.ts` and
   `apps/web/src/lib/recommendations.ts` — Web-to-Admin budgets.
3. `apps/admin/src/services/recommendations/watch-surface-exposure.service.ts`
   — batched insertion, replay classification and duplicate accounting.
4. `docs/roadmap/topic-experiences/feat-688-watch-surface-deadline-order.md`
   — existing narrow deadline-order task.

## Grep These

`recommendationFetchWithRetry`, `recordWatchSurfaceExposureBatch`,
`RECOMMENDATION_SURFACE_EXPOSURE_UPSTREAM_TIMEOUT_MS`, `duplicateCount`,
`database.pool_acquisition`.

## What To Build

- Order the surface exposure and surface delivery browser deadlines after their
  Web upstream budgets, using measured Admin write latency and bounded transit
  headroom.
- Keep each exposure batch and its stable event IDs until Web returns matching
  accepted, repeat or replay receipts; report conflicts as coverage failures;
  serialize sends, retry transient failures with bounded backoff and preserve
  duplicate-safe Admin receipts. Avoid a burst of parallel writes when a page
  emits many facts.
- Validate failure, replay and page-departure behavior with focused tests.
- Investigate the common Admin/DB slowdown separately before attributing it
  to retention cleanup or claiming production recovery.

## Constraints

- Do not gate analytics or recommendations on consent, and do not delay player
  or page navigation for event recording.
- Do not infer a rolled-back write from a timeout. Preserve stable event IDs
  across retries and the existing Admin unique-event deduplication contract.
- Do not deploy directly. Use normal PR-to-main rollout and coordinate Admin
  production changes with the retention owner.

## Verification

- Run focused Web exposure, timing and route tests, Web typecheck/lint/format,
  and any Admin tests for a touched Admin path.
- After normal rollout, compare route 503 counts and sampled Admin mutation
  latency, main-pool waits and replay volume against pre-change intervals.
  Report database pressure attribution and event-recording recovery separately.

## 28 Oct residual selection follow-up

After the exposure receipt releases, a retained selection trace
`6ae103f2000000000dbf3f58af28f561` showed Web aborting its Admin request at
700 ms while Admin completed the selection at about 728 ms. The browser's
800 ms navigation deadline was also its request-abort deadline. Keep the
800 ms navigation cap, but allow the idempotent keepalive event request to
finish under a 2-second Web-to-Admin budget and a 3-second browser budget.
Page departure after navigation must not abort that request. Both recommendation
card surfaces use this rule; focused tests cover late acknowledgement and
single navigation. The separate intermittent Redis admission and SQL stalls
remain under investigation and must be measured during rollout before closing
this ticket.
