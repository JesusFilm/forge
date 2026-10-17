# Recommendation retention: bounded phase admission

## Problem and evidence

The October 5 ordinary scheduled cycle had four transaction-expired failures despite later catch-up clearing all 21 overdue categories. The four wrapper errors name different reported operations. They do not establish the statement that consumed the five-second shared deadline. The current `phase` helper admits a transaction whenever even one millisecond remains, while deletion, the oldest-expired scan and terminal ledger write all use that same deadline.

## Investigation gate

1. Reproduce an avoidable late-phase failure against an owned PostgreSQL fixture, recording elapsed time at phase boundaries without production identifiers. The controlled fixture left 287 ms before a separate 500 ms contribution deletion; current code admitted it, then Prisma expired the transaction after 293 ms. Its earlier request and projection deletion stayed committed, the contribution stayed untouched, and the attempt was marked failed.
   The permanent regression uses a 4.3-second projection delay followed by a separate 0.9-second contribution delay to leave more room for the terminal ledger write across CI hosts while retaining a next operation longer than the remaining budget. It also checks an earlier expired standalone episode, request root, projection tail, and follow-up completion.
2. Independently reproduce a genuinely slow transaction admitted with sufficient time. It must remain failed after any change.
3. Trace how a partial safe yield reaches the scheduler, truthful committed counters, the success watermark and the next attempt. Reject a change that can repeatedly starve request roots or late privacy phases.

## Candidate scope if confirmed

Admit a new phase only with more than 750 ms remaining, checked both before requesting a connection and after obtaining the advisory lock. This threshold is above the locally observed 287 ms unsafe admission. It does not reserve time throughout an admitted operation: that operation receives the full remaining timeout and may genuinely exhaust it. Yield only **before** work starts. Persist a `SKIPPED` attempt with reason `budget_yield`, exact committed counters, unknown oldest/overdue state, and an explicit required continuation. Its result is distinct from a lock skip, which keeps the existing retry path. Do not advance the full-completion health watermark. Keep actual transaction/statement/oldest-scan/terminal-write timeouts failed, even if a prior prefix committed. Preserve five seconds, 29-day expiry, lock order, root and episode caps, scheduler cadence and all child data contracts. Avoid a new tracking table or identity-bearing logs.

A yielded result also sets the existing batch-continuation bit for compatibility with a replayed older scheduler step. That bit means the bounded pass is incomplete here; it does not claim the row cap was reached. The distinct `continuationRequired` and `purgeStatus` fields give new code the precise reason.

## Validation and release

Use an owned native PostgreSQL fixture for the late-admission path, rollback and retry continuation, then focused tests, format, typecheck and CI. An isolated success is not proof of production cure; actual Admin release and two later normal clean loaded cycles remain feat-554's acceptance gate. Parent owns independent review, merge, deployment verification and consolidated closeout.

Repeated pre-work yields remain possible under sustained arrivals or provider latency. The existing eight-batch/30-second pass and 60-second durable continuation bound each scheduling turn but cannot by themselves prove that a later privacy phase will always be reached. Keep oldest-expired age and the successful completion watermark in the live acceptance check; a persistent yield-only sequence is not a clean loaded cycle.
