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
