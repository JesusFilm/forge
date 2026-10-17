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
`content_action_id` index was not needed to explain the observed query cost.
Revisit that FK/index when action-linked decisions actually accumulate.
Local tests and read-only plans support the query change; only natural loaded
production cycles after deployment can establish that the complete five-second
retention run now passes.
