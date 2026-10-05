---
title: "Separate recommendation storage recovery from new-write efficiency"
date: "2026-10-02"
module: "apps/admin recommendation persistence and retention"
problem_type: "performance_issue"
component: "database"
severity: "high"
symptoms:
  - "Large batches delete rows but filesystem free space does not rise"
  - "Short relation-growth samples are mistaken for a monthly forecast"
root_cause: "measurement_conflation"
resolution_type: "operational_clarification"
tags: [recommendations, postgres, retention, storage, capacity]
---

# Measure the storage operation that actually occurred

Recommendation stage-row `DELETE` leaves its PostgreSQL relation files
allocated for reuse. The historical finite campaign removed 342,235 rows but
did not recover that file allocation. After the owner separately authorized
bulk disposal, a restrictive truncate of the remaining stage relation changed
its allocation from 16,431,259,648 to 24,576 B. Direct PGDATA-bound free space
increased by 16,144,224,256 B across the operation, while WAL and other writes
also changed. These are two distinct measured quantities; neither should be
added to prior index recovery.

New-write optimizations require different evidence. Use equal-input native
database fixtures to measure their marginal heap/index/TOAST and WAL effects,
then verify the deployed writer shape with bounded production samples. Packed
served items, shared vectors, shorter exposure IDs and first-empty projection
omission passed those checks. A production relation size mixes old and new rows,
retention, vacuum and concurrent application work, so it cannot by itself
establish an optimization's causal monthly savings. Keep exact snapshots,
identity/attribution and erasure rules when reducing storage.

Daily retention health is a separate reliability axis. A failed run that later
recovers proves eventual catch-up, not failure-free loaded throughput. Use the
durable retention ledger for committed roots/descendants and workflow start and
finish for elapsed time. A retention `completed_at` captured as the expiry
cutoff is not an elapsed-time endpoint. Check real expired backlog, lock skips,
WAL and direct free space across normal loaded cycles before claiming repeatable
headroom. See `docs/reports/2026-10-02-recommendation-storage-efficiency-closeout.md`
for the October 2 acceptance boundary.
