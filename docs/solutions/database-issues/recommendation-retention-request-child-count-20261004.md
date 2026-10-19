---
title: "Count retention children from indexed request parents"
date: "2026-10-04"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "background_job"
severity: "high"
symptoms:
  - "A loaded retention attempt exhausts its fixed deadline before request-root deletion"
  - "An eligibility child count scans large unrelated decision and outcome tables"
root_cause: "unbounded_database_read"
resolution_type: "code_fix"
tags: [recommendations, retention, postgres, prisma, query-plan]
---

# Count retention children from indexed request parents

## Serving must remain independent of cleanup

On October 19, the owner removed global retention health as a prerequisite for
recommendation delivery. Slow cleanup had caused `delivery.factory.ts` to read
`readRecommendationRetentionHealth` on every request; `manifest.service.ts`
then rejected issuance with `retention_overdue` before retrieval. The public
`watch-below-player-v1` component hid the resulting unavailable row. Improving
cleanup throughput alone left that availability dependency in place.

Delivery now reads its manifest/control without consulting cleanup health.
Cleanup and operator health reporting continue independently. Keep per-record
expiry, erasure, privacy-generation and video eligibility enforcement; global
health is not a substitute for those read-time checks. The authoritative owner
decision is in `docs/analytics-and-recommendation-policy.md`.

`delivery.factory.test.ts` exercises the real factory serving-state path and
delivery service with overdue data, a missing success watermark, and a failed
health probe. Each case returned no cards before the fix and now issues a
Watch card without reading global cleanup health. Retention and operational
health tests still verify that cleanup failures are reported truthfully.

## Indexed request-parent cleanup

Prisma emitted a `LEFT JOIN` from eligibility decisions to outcomes and content
actions, with an `OR` across the two parents' `request_id` filters. On an owned
fixture, the emitted SQL shape was captured with dummy IDs. A bounded read-only
production `EXPLAIN ANALYZE` of the equivalent shape on the oldest fifty
expired requests scanned roughly 225,000 decisions and 336,000 outcomes and
took 329 ms. An `EXISTS` approximation took 908 ms; neither read measured
deletion, locking or the full retention run.

Start each branch from its request-indexed parent and join to eligibility
decisions. `UNION` their decision IDs before counting, preserving the original
once-per-decision semantics. The equivalent bounded production plan took
2.55 ms on the same cohort. Parameterize the request ID array; do not build
SQL literals from IDs. Native PostgreSQL tests cover both parent branches,
a live unrelated selection decision, and exact child counts before expiry
deletes. The current schema makes an outcome and content-action link mutually
exclusive, but `UNION` also preserves count semantics if that changes.

At the measurement time, no decisions were content-action-linked, so a new
`content_action_id` index was not needed to explain the observed count query cost.
That observation did not establish that content-action cascades were indexed.
Local tests and read-only plans support the query change; only natural loaded
production cycles after deployment can establish that the complete five-second
retention run now passes.

## 2026-10-19: empty FK cascades also need an index

Retention later stalled at `recommendationContentAction.deleteMany`, leaving
delivery gated by `retention_overdue`. A bounded read-only production lookup
scanned 247,707 eligibility rows in approximately 92 ms despite finding no
content-action children. PostgreSQL performs that child lookup for each parent
deleted; a 100-action batch exhausted the approximately 2.5 seconds remaining.
An `EXPLAIN` of the child DELETE confirmed the sequential scan without executing
any production deletion.

Migration `0158_recommendation_content_action_eligibility_index` adds the missing
leading FK index. Index every revision: `is_current` is not a predicate in an
FK cascade. Zero matching children does not make the lookup free. Check indexes
for every inbound FK when investigating slow parent deletion, including nullable
references that currently have no matching children. Keep the existing retention
deadline and health gate; verify successful natural cleanup after deployment.

## 2026-10-19: audit the entire outcome cascade too

After migration 0158, production deleted 100 standalone actions and 50 request
roots, then failed in the next `recommendationRequest.deleteMany` transaction
(1,592 ms budget, 1,714 ms elapsed). An inbound-FK audit found two more missing
leading indexes on `recommendation_cowatch_contribution.source_outcome_id` and
`target_outcome_id`. The table held 234,653 rows (141 MB). Bounded read-only
lookups with no matching children took approximately 18 ms for the source and
40 ms for the target; the latter scanned the whole table. Its generation-leading
unique pair index does not bound lookups by an outcome alone.

Migration 0159 indexes both endpoints. The real-migration regression covers
250,000 unrelated pairs across 100 generations, empty lookups, and erasure of
100 outcomes with source-linked and target-linked children. Audit the full
inbound cascade graph, then check actual plans: a composite FK can already have
a selective index on a subset of its columns, while an index containing the
desired column after an unrelated leading column may still be expensive.
Continue verifying natural cleanup and serving recovery after each deployment;
fixing the first failing phase does not establish end-to-end retention health.

## 2026-10-19: include SET NULL references in the audit

Migration 0159 reduced production outcome lookups below 1 ms and let cleanup
reach profile generation erasure. That phase then timed out at
`recommendationProfileProjectionGeneration.deleteMany` (2,192 ms remaining,
2,219 ms elapsed). `recommendation_profile_projection_run.projection_id` lacked
an index: proving an empty reference scanned 71,122 runs (35 MB) in about 27 ms.
The `ON DELETE SET NULL` action repeats that lookup for every parent, just as a
delete cascade does. The production `EXPLAIN` of its child UPDATE also chose a
sequential scan; no production UPDATE was executed for diagnosis.

Migration 0160 adds the projection reference index. Its real-migration fixture
covers 100,000 unrelated completed runs, 100 parent erasures, and two linked
completed runs that survive with their reference cleared. Inspect all FK actions,
including `SET NULL`, and all retention phases when auditing a cleanup failure.

## 2026-10-19: successful cleanup can still be too slow to restore serving

After those indexes deployed, more than 200 natural cleanup runs succeeded with
no new failures. The public `watch-below-player-v1` row still received
`retention_overdue`: approximately 9,700 overdue standalone episodes remained,
and the pre-request phase admitted only five per run. Successful batches do not
establish serving recovery when the health gate also requires an empty overdue
backlog.

Measure throughput against the loaded native fixture before increasing a cap.
The current indexes allowed 25 episodes plus 12 request roots and 100 profile
runs in 2,551 ms, compared with five episodes in 1,199 ms. Retain the five-second
deadline and the original five-admission floor; admit up to 25 only while more
than three seconds remain for requests and the tail. A slower fixture admitted
23 and still completed those later phases in 2,543 ms. Tests should accept the
bounded variable page while requiring exact committed counts and eventual
clearance. If time stops a partial selection, explicitly request continuation;
checking only whether the selection filled its page can leave younger expired
records waiting for the next daily run.

Confirm recovery through the public frontend's recommendation request and
visible cards after normal deployment. Do not bypass the health gate to hide
the remaining backlog.
