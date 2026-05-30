---
title: In-memory slot reservation for fire-and-forget background dispatch — wrap the entire callback in try/finally
date: 2026-05-06
last_updated: 2026-05-19
category: best-practices
problem_type: best_practice
component: nextjs-after-background-dispatch
root_cause: try-finally-only-wraps-await-not-sync-prelude
resolution_type: code_fix
severity: medium
tags:
  - fire-and-forget
  - idempotency
  - resource-leak
  - after
related:
  - docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
  - docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md
---

# In-memory slot reservation for fire-and-forget — wrap the entire callback in try/finally

## Problem

A request handler reserves an in-memory slot (idempotency map,
semaphore, claim token) **before** dispatching background work via
Next's `after()` (or any queue-style fire-and-forget). The slot is
released in the dispatch callback's `finally`. The naive shape is:

```ts
inFlightMap.set(key, { jobId, expiresAt: now + TTL_MS })
schedule(async () => {
  console.log(JSON.stringify({ event: "dispatch", ...payload })) // ← outside try!
  try {
    await args.dispatch(input)
  } finally {
    inFlightMap.delete(key)
  }
})
```

This looks correct but has a silent leak: if **anything before the
await throws synchronously** (a circular ref accidentally added to
the structured-log payload, a future side-effect the next maintainer
adds between the cb top and the dispatch, a getter that throws on a
proxy passed in `payload`), the `finally` never runs and the slot
sits in the map until the TTL prune.

For PR2's 5-minute TTL: a failed dispatch leaves the operator
unable to retry the same `(kind, assetId)` for **five full minutes**
with no observable signal beyond a stale "already_in_flight"
response. Worse on a shorter TTL: 30s blocks look like flakiness.

## Symptoms

- Operator: re-trigger returns `already_in_flight` with a
  `managerJobId` that never resolves to an artifact.
- Logs: the `event=dispatch` line is missing (the throw happened
  inside JSON.stringify) but no `dispatch.error` either (the catch
  doesn't see the sync throw because the surrounding wrapper only
  catches at the await boundary).
- TTL eventually prunes; symptom self-heals after `IN_FLIGHT_TTL_MS`.

## What didn't work

- **Logging before slot reservation.** Now the slot is never
  reserved if the log throws — but the request still returns
  `started` with a `managerJobId` that nobody is acting on.
- **Catching errors in the schedule wrapper only.** The wrapper's
  catch logs the throw but cannot release the slot (the slot
  release is inside the cb's own try/finally, not the wrapper's).

## Solution

Move the `try {` to the **first statement of the cb body**, above
every other line including the structured log:

```ts
inFlightMap.set(key, { jobId, expiresAt: now + TTL_MS })
schedule(async () => {
  // Wrap the ENTIRE callback body in try/finally so the in-flight
  // slot is released regardless of where in the cb a throw
  // originates (the dispatch itself, the structured-log
  // JSON.stringify above the await, or any future side-effect
  // added between them). A naive `try { await dispatch } finally
  // { delete }` only covers the await path.
  try {
    console.log(JSON.stringify({ event: "dispatch", ...payload }))
    await args.dispatch(input)
  } finally {
    inFlightMap.delete(key)
  }
})
```

Test discipline: write a `dispatch` that throws **synchronously**
(not a rejected promise) and assert a re-trigger immediately returns
`started` with a new `jobId`:

```ts
const throwingDispatch = vi.fn((): Promise<unknown> => {
  throw new Error("synchronous dispatch failure")
})
await processRequest({ dispatch: throwingDispatch, ... })
// Assert second trigger sees a fresh slot:
const second = await processRequest({ dispatch: vi.fn(async () => ({})), ... })
expect((await second.json()).results[0].status).toBe("started")
```

A test that only rejects the dispatch promise (`Promise.reject`)
covers the await branch but not the sync-throw path. Both are needed.

## Why this works

`try/finally` in JavaScript guarantees the `finally` runs whenever
control leaves the `try` block — including synchronous throws
**inside** the `try`. A synchronous throw **before** the `try` block
escapes the function entirely, bypassing the `finally`. Moving the
`try` to the first statement encloses every possible throw site.

This is not specific to `after()`. The same trap applies to:

- BullMQ / similar queue handlers reserving an in-memory cache
  before pushing
- Background workers that allocate a connection from a pool, do
  prep work, then await a long task
- React Query mutation `onMutate` hooks that flag UI state before
  `await mutate()`

## Prevention

**Rule:** For any fire-and-forget pattern where in-memory state is
reserved before dispatch and released on completion, the `try` MUST
be the first statement of the cb body — never bracket only the
await. Add a sync-throw test (not just an async-reject test) for
every reserve/release pair.

**Comparison with DB-row-based locks:** the manager backfill pattern
(`docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`)
uses a workflow status row as the lock — if the worker crashes
mid-task, the row stays held until a separate sweeper times it out.
The in-memory variant trades durability for simplicity. Both
patterns share the same release-on-settle invariant; only the
storage and recovery mechanism differ.

**Queue-backed variant:** when the "fire-and-forget" work becomes a
process-local queue, do not let the old short TTL govern queued or
running slots. A queued job can sit behind other work, and a running
Mux-heavy transcript job can outlive a 5-minute prune window. In that
shape, use a non-expiring active marker while the queue owns the job,
release it only in the queue runner's `finally`, and test that a stale
clock still returns `already_in_flight` while dispatch is unresolved.

Also keep the `after()` lifecycle attached to the accepted work. If
the request's `after()` callback only enqueues jobs and returns, later
queue drain promises become detached process work. Have the scheduled
callback await the queued jobs accepted by that request through
settlement, or document an explicit worker lifecycle that survives
request cleanup.

Finally, add backpressure before accepting new dispatchable jobs. A
concurrency cap protects the provider, but an unbounded queue shifts
the problem into manager memory. The queue-full path should reject
new work with a retryable response before reserving in-flight slots;
classification-only rows (`not_found`, `validation_failed`, and
`already_in_flight`) should still be returned normally because they
do not spend queue capacity.

**Cross-link to the dispatch-error-log path:** schedule wrappers
typically wrap the cb in `try/catch { console.error(...) }` so a
thrown dispatch doesn't crash Next. That wrapper is for
**observability** (so the throw shows up in logs), NOT for slot
release. Both layers are required:

```ts
function defaultSchedule(cb) {
  after(async () => {
    try {
      await cb()  // ← outer wrapper: catch + log for observability
    } catch (err) {
      console.error(JSON.stringify({ event: "dispatch.error", error: ... }))
    }
  })
}
// And inside cb:
schedule(async () => {
  try {                  // ← inner wrapper: slot release on every throw site
    console.log(...)
    await dispatch(...)
  } finally {
    inFlightMap.delete(key)
  }
})
```

## Worked instance

feat-119 PR2's `apps/manager/src/lib/admin-trigger-route.ts:470-497`.
The trap was caught by ce:review's reliability-reviewer (rel-1, conf
0.88) before it reached prod. The fix added the `try {` above the
`console.log` line and added the sync-throw test "releases the slot
when dispatch throws SYNCHRONOUSLY".

2026-05-19 follow-up: PR #981 extended the same helper with a bounded
admin-trigger dispatch queue after production transcript triggers hit
Mux `429 Too many requests`. The durable lesson is that slot
reservation, queue capacity, provider concurrency, and `after()`
lifecycle are one contract: reserve only after capacity is available,
hold the slot while queued/running, release in the runner `finally`,
and keep the scheduled background promise attached until accepted work
settles.
