---
module: PrecomputedRecommendations
problem_type: integration_issue
component: manual-subscription-catalog
date: 2026-10-15
symptoms:
  - One receipted invalid model response permanently blocks source resume
root_cause: Producer treats every rejected member as an unrecoverable source failure
resolution_type: code_fix
severity: medium
tags: [recommendations, subscription, durable-receipts, retries]
---

# Bound retries by durable page history

The v6 catalog stopped after 148 successful comparison calls and one rejected
response. The rejected call had recorded usage and applied no choices, but
`sourceProgress` refused every `rejected_unapplied` row forever.

Admin's `precomputed_edge_batch_call` constraint requires a finish timestamp,
input/output usage, and receipt digest for every terminal call. The producer can
therefore distinguish a terminal rejected result from pending unknown usage
without inventing a consumption outcome. Its unchanged server contract permits
a fresh call at the next unapplied rank, retaining the old receipt.

Allow one retry per source/page, counting rejected terminal rows across process
restarts. After a live failure, read status again and require the exact call ID
and all actual member sources to be rejected and unapplied. A new UUID returns
through normal admission, pacing, capacity, model and output validation. The
producer never retries failed, stale, pending, incomplete or mismatched receipts;
reviewed unknown-usage recovery IDs keep their separate explicit path.

Only applied pages advance rank coverage. Historical rejections must not poison
an already completed page or prevent source finalization. Tests cover successful
retry, restart, durable exhaustion, allowance refusal, receipt mismatches and
finalization with an older rejected record. Raw rejected model output is not
retained, so this recovery fix does not establish which field was invalid.
