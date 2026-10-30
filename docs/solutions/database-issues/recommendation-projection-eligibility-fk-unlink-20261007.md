---
title: "Keep retained projection evidence when its eligibility source expires"
date: "2026-10-07"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "retention"
severity: "high"
symptoms:
  - "Expired request-root deletion repeatedly fails with P0001"
  - "Published profile projection contribution survives beyond its source decision"
root_cause: "source_eligibility_decision_id SET NULL conflicts with the shared immutable-child trigger and paired-revision CHECK"
resolution_type: "migration_fix"
tags: [recommendations, retention, postgres, foreign-key, immutable-evidence]
---

# Keep retained projection evidence when its eligibility source expires

An expired request can cascade through a playback outcome to its eligibility
decision while a published profile projection contribution still has its own
retention lifetime. PostgreSQL then applies the contribution's
`source_eligibility_decision_id ON DELETE SET NULL` FK action. The existing
BEFORE UPDATE guard allowed nulling only `source_outcome_id`, so the FK update
raised P0001 and rolled back the request deletion. Merely permitting the ID
update would still fail the paired CHECK: `source_eligibility_revision` must
also become null when the ID is null.

The migration keeps the shared update guard and its original outcome cleanup.
For contributions only, it accepts the exact nested FK update when the old
decision has already been deleted, the eligibility ID is changing to null,
the revision has not otherwise changed, and every other column is identical.
The trigger then nulls the companion revision before PostgreSQL checks the
row. `pg_trigger_depth()` alone is insufficient evidence of the FK action:
the absence of the old decision and exact row comparison also matter. Direct
unlink, non-null reassignment, revision-only edits, mixed content edits, and
published interest updates remain rejected. The retained contribution keeps
its generation, kind, target, weight, digest, timestamps, expiry and all
other observation fields; the now-expired source links clear together. Serving
already fails closed when the source decision ID is absent.

Native PostgreSQL tests should exercise both direct decision deletion and the
full request purge path on a populated schema. Before the migration, the
request deletion must fail and roll back, with a durable FAILED attempt, zero
root credit and unchanged successful watermark. After the migration, the same
purge should commit exact root/descendant counters and retain the published
projection observation. Also test unrelated outcome unlink and selection
cascade behavior. A local passing fixture is not proof of a deployed repair or
of the earlier separate transaction-timeout failures being fixed. Two later
ordinary failure-free loaded cycles are still required for feat-554.
