---
title: "Bound standalone playback cleanup before request retention"
date: "2026-10-04"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "background_job"
severity: "high"
symptoms:
  - "Scheduled retention repeatedly exhausts its five-second deadline before deleting expired request roots"
  - "Standalone playback episodes shrink while expired requests and their children accumulate"
root_cause: "unbounded_pre_root_work"
resolution_type: "code_fix"
tags: [recommendations, retention, postgres, playback, batching]
---

# Bound standalone playback cleanup before request roots

The root batch size of 100 also selected 100 request-free playback episodes.
Each episode needs a separate transaction with full dependency discovery,
authority locking, recheck and cascade. On October 3, production attempts
committed 24–56 episode deletions, then exhausted the unchanged five-second
whole-run deadline. No expired request roots were reached. Transaction timeout
and already-closed errors in the workflow ledger corroborated that phase; a
healthy HTTP process did not imply healthy recommendation issuance.

Select at most ten standalone episodes before the request-root loop. Keep each
episode's existing atomic transaction and 50,000-dependency guard. Grouping ten
independently safe closures into one transaction could introduce a new overflow
failure for the oldest page. A full episode page must request catch-up even if
request roots are not yet overdue. Preserve the 29-day expiry and five-second
deadline.

An owned PostgreSQL regression with 100 expired episodes, facts, outcomes and
source lineage used a local-only 40 ms per-row deletion cost. The unchanged code
failed at the deadline before root progress; the bounded version deleted ten
episodes and twelve expired request roots on its first pass, then drained the
remaining episodes through continuation. The local cost models the failure mode,
not production throughput. The existing scheduler allows eight batches per
pass and a 60-second catch-up interval; ten episodes per batch gives a
theoretical ceiling of 80 per minute before runtime overhead. Newly created
episode counts do not measure how many records are becoming expired. Verify
natural post-release backlog and serving recovery from comparable readings.
Two subsequent normal failure-free loaded cycles remain the feat-554
acceptance gate; local fixtures and recovered cycles do not satisfy it.
