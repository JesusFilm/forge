---
title: "Measure Prisma batch overhead without misattributing database waits"
date: "2026-09-23"
category: best-practices
module: "Recommendation persistence"
problem_type: best_practice
component: database
severity: high
applies_when:
  - "A large Prisma write approaches a transaction deadline while database execution appears small"
tags:
  [
    "prisma",
    "postgres",
    "pool",
    "async-local-storage",
    "recommendations",
    "latency",
  ]
---

# Measure Prisma batch overhead without misattributing database waits

Production candidate-evidence persistence approached the unchanged 650 ms
transaction deadline. An owned PostgreSQL reproduction showed substantial
application/adapter wall time beyond server parse, bind and execution. Replacing
hundreds of rows' scalar parameters with one bound JSON payload reduced
persistence p99 in paired 326-row runs from 474/540 ms to 241/285 ms. This proves
a local optimization, not the complete production incident cause or sub-200 ms
recovery. See the [evidence and limits](../../operations/watch-persistence-followup-2026-09-23.md).

## Preserve the data contract when changing a write path

`apps/admin/src/services/recommendations/candidate-evidence-persistence.ts` uses
typed `jsonb_to_recordset` inside the original issuance transaction. Keep FK,
unique, expiry and range checks; never substitute conflict skipping or detached
audit writes. Compare every persisted field against the old createMany on real
PostgreSQL, and verify whole-batch failure rolls back parent issuance too.

Two subtle differences need explicit treatment:

- Prisma supplies `@default(now())` at write construction. PostgreSQL `now()`
  would use transaction start. Preserve the original timestamp semantics.
- `JSON.stringify` converts NaN/Infinity to null. Reject non-finite numbers
  instead of bypassing nullable score constraints.

## Test the actual pool boundary

Prisma 6's native engine can enter the adapter without the caller's
AsyncLocalStorage context. Instrumenting pg.Pool does not automatically make
acquisition timings request-correlated. Saturate all ten leases through the real
adapter, observe the queued call, and keep unavailable correlation explicit.
Independent slow acquisition logs can identify pressure without fabricating a
zero wait or blaming an unrelated request. Acquisition also includes connection
establishment, so do not label its entire duration queue wait.

An observed pool must preserve callback and promise APIs and remain observed
after disconnect/reconnect. Do not call a subclass logger property `log`:
pg.Pool already uses that property internally. The factory creates a fresh owned
pool on each connect and disposes it on disconnect while preserving main/sync
singleton budgets across Next module graphs.

## Make failure evidence usable

Bound labels and payload sizes below the existing log transport envelope. Emit
sanitized error codes without raw Error inspection, SQL or identity payloads.
Record pending operations at service return and late resolution/rejection without
inferring whether an ambiguous mutation committed. Keep HTTP outcome counts
separate from HTTP 200 semantic fallback counts. Request wall times, nested
stages and process event-loop measurements overlap; none is exclusive database
execution or request CPU.

Do not weaken the durable capability budget to compensate for uncertain waits.
The [budget timing learning](separate-budget-function-time-from-driver-latency-20260922.md)
explains which parts of standalone commit and driver latency remain outside
server-function timing. Selection failures and delivery persistence failures
need separate causal evidence.

## Verify collection and retain failed operations

PR #2388's production check verified that JSON runtime events reach Railway
and Datadog as structured attributes with an empty message. Search Datadog with
`service:forge-admin @event:recommendation.runtime`; message-only filtering
can produce a false absence. Railway attribute values need JSON decoding too.
Match the span ID and the canonical retained trace ID when the log contains
only a decimal low-64-bit trace ID. Split primary-log windows before their
response cap, enforce half-open boundaries and reconcile with HTTP metrics.

A first-hour timeout persisted after the bulk-write optimization. Its 220-row
insert remained pending at response time and rejected later with P2028.
`inFlight: 1, elapsedMs: 0` is an unfinished operation, not a zero-millisecond
success. Exclude pending operations from completed-operation percentiles while
retaining the failed request and late settlement separately. The 1,186 ms
driver span narrows the failure but does not identify PostgreSQL execution,
storage wait or application result handling. A good local paired benchmark
and successful production deployment are not evidence of complete recovery.

## Correlate PostgreSQL independently of the application loop

When one driver span remains ambiguous, add a generated diagnostic UUID and
transaction ordinal to the existing transaction setup SQL using
`set_config('application_name', tag, true)`, returning `pg_backend_pid()` in
the same statement. The tag must contain no viewer, token or ledger identity.
Bound the metadata, and test exact original-name restoration after commit and
rollback on the same pooled backend. The transaction-local setting avoids a
tag leaking to another request. See PostgreSQL's
[configuration functions](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SET).

Run `src/scripts/sample-recommendation-db-waits.ts` in a separate process. An
in-process timer would be blind during the scheduling pause being investigated.
Read-only `pg_stat_activity` sampling can distinguish a blocked INSERT from
PostgreSQL already idle in transaction waiting for the client. Classify SQL
server-side and export only bounded metadata, with explicit overhead/output
stop reasons and connection cleanup. Never label `queryAgeMs` as wait duration;
when idle, PostgreSQL's query start refers to the **last** statement. See
[activity state semantics](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW).

Real PostgreSQL tests should inject at least a database lock, a server delay
and an application-loop stall, then show the independent collector distinguishes
them. Those are instrument calibration, not proof of a historical incident.
The [bounded capture runbook and evidence](../../operations/watch-database-wait-correlation-2026-09-23.md)
record the real 220-row writes, rollback guarantees, setup overhead and remaining
natural-capture gate. Selection's standalone budget call is outside this
delivery transaction tag; do not generalize its evidence to selection.

## Distinguish a measured gap from the incident's cause

The deployed observer captured a natural INSERT that reached PostgreSQL's idle
state about 6 ms after query start while Admin's write wrapper measured 83 ms.
The same last statement was still idle 104 ms after finishing. This establishes
time outside PostgreSQL execution, but the idle interval can include later
application work or delay before dispatching the next statement. Without a
retained operation timeline, do not put that entire idle interval inside the
driver call or claim it reproduces a different historical timeout.

Keep CPU profiles bounded and restore temporary inspectors. Map compiled frames
through the deployed source map before naming a workload. Aggregate sample time
is not a contiguous pause: the captured GraphQL serialization frame accumulated
227 ms over 30 seconds, with a longest sampled burst of 8.6 ms. A profile of
successful traffic cannot establish the cause of an unobserved failure.

Record collector stop reasons and host placement. The first production
observer stopped at its 100 ms single-poll safety cap; later worker-hosted
collection had lower overhead. That is a measurement condition, not proof that
moving the observer fixed anything. Reconcile all primary delivery outcomes
with HTTP metrics, retain ordinary fallback reasons, and report selection HTTP
503 separately from HTTP 200 delivery timeouts. Close diagnostic connections
and verify cleanup independently before ending the investigation window.

## Keep source timing when a trace cannot be retrieved

Three subsequent 798–1,054 ms deliveries have short 8–27 ms evidence writes,
but no matching indexed APM spans. Aggregate stage durations and ingestion
timestamps cannot reconstruct their operation intervals. Preserve one UTC
observation start plus monotonic offsets in the bounded runtime event. Pair
the longest completed call's offset with its maximum duration, and retain the
specific start offset on a late-operation record after the response closes.
Test wall-clock corrections, repeated calls and unfinished/late operations.

The first call for a label is not necessarily its longest or a pending call.
An aggregate is not a complete timeline. Source timestamps remove ingestion
lag from alignment; they do not remove cross-host clock skew. Measure clock
offsets before attributing a timestamp gap to transport or scheduling, and use
same-clock durations wherever possible. See the
[source timing contract and validation](../../operations/watch-source-timing-2026-09-23.md).
