---
title: "Shadow cohort receipts must survive retained-row loss"
date: "2026-09-29"
category: "logic-errors"
module: "Admin Recommendations"
problem_type: "logic_error"
component: "service_object"
severity: "high"
symptoms:
  - "An empty sample could be retried against a different population"
  - "Deleting a sampled request could allow a favorable terminal decision"
root_cause: "async_timing"
resolution_type: "code_fix"
tags: [recommendations, shadow-evaluation, retention, denominators, concurrency]
---

# Shadow cohort receipts must survive retained-row loss

## Problem

A governed shadow evaluation needs a fixed population. Counting its remaining
run rows at publication is insufficient: request deletion can cascade those rows
away. An empty initial sample also needs a receipt, or a retry can silently sample
new requests. Both change the denominator after the protocol was fixed.

The initial terminal guard read runs before acquiring dependency locks. A request
could disappear and revoke the composition protocol between that snapshot and
publication. Checking only the remaining rows did not detect the lost member.
This was found and repaired before the combined live integration release.

## Solution

`apps/admin/src/services/recommendations/shadow-evaluation/service.ts` records
`sampledAt` and `sampledCount` atomically with the initial runs under the evaluation
advisory lock. Migration 0108 makes both fields immutable after that receipt.
Retries reuse the receipt, including a zero count. Eligibility filtering happens
before stable request hashing, so unrelated cohort members cannot consume the
sample and then be replaced after their results are known.

`shadow-evaluation/cowatch-readiness.ts` locks the graph, composition protocol and
manifest before re-reading current authority and retained run count. The count
must equal the immutable receipt, and the locks remain held through terminal
publication. Lost roots produce an inconclusive result instead of a smaller
passing cohort. Expiry and privacy invalidation remain effective independently.

## Verification

`shadow-evaluation/live-trial.db.test.ts` deletes a sampled request after the
initial terminal snapshot and before the publication fence. The same regression
fails against the old guard with `promote_to_experiment`, then passes against the
fixed guard with `inconclusive`. It also verifies empty-cohort retry stability and
database rejection of receipt edits. These are synthetic owned PostgreSQL tests,
not production observations.

## Reuse

When approval depends on retained child rows, persist the original population
receipt separately from those children. Lock the authority roots before the
final count and policy checks. A passing aggregate cannot stand in for proof that
all preregistered members are still represented.
