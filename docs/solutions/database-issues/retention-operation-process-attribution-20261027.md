---
title: "Attribute retention failures to an operation and its executing process"
date: "2026-10-27"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "background_job"
severity: "high"
symptoms:
  - "P2028 reports only a phase containing both SELECT and guarded UPDATE"
  - "Container memory appears healthy while the actual invocation's heap and pauses are unknown"
root_cause: "diagnostic_attribution_gap"
resolution_type: "diagnostic_improvement"
tags: [recommendations, retention, diagnostics, prisma, privacy]
---

# Attribute the operation and executing process before changing behavior

The r2932-w01 second pass failed with 796 ms admitted and 816 ms inside decision
unlink. Current indexed SELECT/UPDATE plans and local actual-helper fixtures did
not reproduce the stall. This is an attribution gap, not proof of another bad
selector or a GC cause. The true failure and its committed prefix remain intact.

The operator CLI runs a separate short-lived Node process inside the worker
container. PID1's V8 limit, a fresh diagnostic subprocess's heap, and shared
cgroup memory cannot describe that CLI's heap or event loop. Explicit entry-point
context plus measurements taken inside the executing helper avoid that error.
Scheduled-job measurements are still process-wide and can include concurrent
work. Heap growth, event-loop delay and process CPU alone do not prove GC.

`retention-operation-diagnostics.ts` owns a short-lived histogram and bounded
start/end runtime observations for decision unlink. The helper reports SELECT
and UPDATE boundaries and Prisma-await wall times without changing either query. Its `complete` boundary
means the helper returned; the existing phase envelope separately identifies
counter-update or commit-acknowledgement failure. Selected/unlinked observations
are tentative operation counts, not committed counts; durable ledgers remain
authoritative. No-sample loop delay is null rather than evidence of zero delay.

Finish and dispose the observation in `finally` before transaction completion.
Telemetry failures must not replace the operation's original exception or alter
ledger rollback/terminalization. Never serialize errors, SQL, parameters, business
IDs or process arguments. Keep the code-owned enum/numeric schema, four-entry
phase history, existing limiter and 8 KiB parser cap. The version-two parser also
accepts old version-one evidence, and pre-decision failures remain version one; frozen operator/parser bundles require their
own later review before consuming a changed deployed diagnostic schema.

The real CLI flushes stderr after a failed pass before `process.exit`. Test that
path in a subprocess using only mocked DB/job imports, rather than assuming a
console spy proves delivery. Also test SELECT, UPDATE and lost commit
acknowledgement separately, actual local event-loop delay, successful/empty pages,
sampler failures/disposal, hostile fields and parser bounds.

This diagnostic work does not change the five-second deadline, admission floor,
page sizes, current-reference/expiry guards or failure classification. It does
not identify the original production cause, establish CPU efficiency, authorize
cleanup or earn ordinary daily-cycle credit.
