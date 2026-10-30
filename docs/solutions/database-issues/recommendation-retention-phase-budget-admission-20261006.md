---
title: "Require minimum remaining time before admitting a retention phase"
date: "2026-10-06"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "background_job"
severity: "high"
symptoms:
  - "A loaded retention attempt reports a transaction deadline after committing an earlier deletion phase"
  - "The scheduler retries a failed attempt despite bounded work being able to stop safely between phases"
root_cause: "late_phase_admission"
resolution_type: "code_fix"
tags: [recommendations, retention, postgres, prisma, deadlines]
---

# Require minimum remaining time before admitting a retention phase

A five-second retention attempt can commit one transaction and begin the next
with too little time to finish that next transaction. The deadline must include
connection acquisition, advisory-lock acquisition, the operation, its durable
counter update, the oldest-expired scan and terminal ledger write. Checking for
positive time alone does not make a new phase safe. October 5 production errors
reported several operations, but did not identify the statement that consumed
the deadline.

An owned PostgreSQL fixture left 287 ms before a separate 500 ms deletion.
The old code admitted the deletion, timed out after 293 ms, and recorded a
FAILED attempt while preserving the earlier committed prefix. A native fixture
with a wider controlled gap proves the guard can stop before that next phase,
record exact committed counters as `SKIPPED` / `budget_yield`, leave the oldest
backlog unknown, and require bounded continuation. It does not prove the
production tail latency or a universal safe margin.

Check the minimum remaining time before requesting a connection, immediately
after acquisition before the first query, and after the advisory lock is acquired.
An admitted operation still receives the full
remaining timeout and can genuinely exhaust it; the threshold does not
guarantee terminal time. A pre-work yield can be recorded separately from a
lock skip and from a completed success; it must not advance the success
watermark or claim that the oldest-expired scan ran. Errors inside an admitted
transaction, in the oldest scan, or in the terminal ledger write remain FAILED.
The scheduler continues yielded work within its existing batch and time caps.
An incomplete pass needs an explicit continuation signal even when it did not
reach a row-count cap.

Repeated yields can still delay later phases if new work keeps arriving or
provider latency stays high. The eight-batch/30-second pass and one-minute
continuation bound each turn, not global starvation. Monitor oldest-expired age
and the successful completion watermark in real loaded cycles; a yield-only
sequence does not count as a clean cycle.

Test a genuine slow in-transaction timeout as well as the safe yield. Keep the
same deadline and deletion order; reducing the page or increasing a timeout
would answer a different question. After release, verify actual Admin roles and
two ordinary failure-free loaded cycles before calling retention reliable.

## October 27: exhausted pre-work budget and terminal acknowledgement

The admission guard must include zero and negative remaining time. Checking
`remaining <= 0` and throwing before the nonterminal minimum-budget guard made
an acknowledged committed prefix fail at the next phase boundary. A native
PostgreSQL regression delays return from a committed root transaction by 5.1
seconds: current main fails at admission, while the correction durably yields
with the root deleted, the projection tail untouched, exact committed counters
and no new success watermark. This isolates a boundary bug; it does not identify
the SQL responsible for historical production transaction-expiry errors.

The exhausted cleanup deadline cannot also fund yield finalization. Use a
separate one-second ledger-only transaction with a 500 ms acquisition wait,
positive database timeouts and no cleanup advisory lock. Compare-and-set the
RUNNING status, read and validate durable counters inside the transaction, and
report yield only after commit acknowledgement. A rejected acknowledgement
still propagates; a conditional failure fallback preserves any terminal state
already committed. Unit coverage includes lost acknowledgements for both yield
and success. The native suite also proves genuine in-transaction timeouts remain
failed while preserving earlier committed work.

## October 28: acquisition acknowledgement before the first query

One recorded phase had 1,444 ms remaining and spent 1,624 ms acquiring its
transaction before attempting the advisory-lock query. The post-lock guard is
too late for that boundary. Recheck the same nonterminal admission threshold
immediately on callback entry, before any query. This avoids dispatch into an
already exhausted transaction; acquisition rejection still propagates as a
real failure. Terminal admission remains unchanged.

The native PostgreSQL regression delays callback delivery until the real
transaction expires: without the guard, the first query produces P2028; with
the guard, the attempt durably yields without changing the success watermark.
The injected delay proves boundary behavior, not the provider's latency cause.
The other five October 28 failures occurred at different stages and remain
unexplained. Use the allowlisted `post_acquisition_admission` diagnostic stage;
old frozen parser bundles require refresh before future authorized use.
