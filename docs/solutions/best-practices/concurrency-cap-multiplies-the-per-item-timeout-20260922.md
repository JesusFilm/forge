---
title: A concurrency cap multiplies the per-item timeout into the total
date: 2026-09-22
category: best-practices
problem_type: best_practice
component: cross-app-http-client
root_cause: per-item-timeout-mistaken-for-an-aggregate-budget
resolution_type: code_fix
severity: high
module: apps/web
tags:
  - timeout
  - concurrency
  - bounded-parallelism
  - fan-out
  - reliability
  - watch
  - testing-patterns
affected_files:
  - apps/web/src/lib/watch-history.ts
  - apps/web/src/lib/watch-history.test.ts
  - apps/web/src/lib/watch-progress-server.ts
  - apps/web/src/app/api/watch-progress/route.ts
related:
  - docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
  - docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md
  - docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
related_features:
  - feat-537
related_prs:
  - JesusFilm/Forge#2382
---

# A concurrency cap multiplies the per-item timeout into the total

## Problem

Two of this repo's existing laws, each correct alone, combine into a regression
that neither one warns about.

`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
says never fan out per-item work through a bare `Promise.all`: one rejection
aborts the batch.
`docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`
says bound the fan-out's width so it cannot hammer a rate limiter or a
connection pool.

Apply both to an unbounded fan-out and you get a **longer** worst case than you
started with, because a bare `Promise.all` was accidentally doing two jobs at
once. It ran every item concurrently, so one shared per-item timeout bounded the
whole batch; and it short-circuited on the first rejection, so a sick upstream
ended the batch immediately.

Both properties die together:

- Per-item `.catch()` removes the short-circuit. That is the point — it is what
  isolates one bad item — but nothing now ends the batch early.
- The concurrency cap serializes the items into `ceil(n / width)` rounds, and
  each round can spend the full per-item timeout.

Worst case goes from `1 × per-item timeout` to `ceil(n / width) × per-item
timeout`. In FGE-185 that was 200 ids at width 8 against a 15 s Apollo timeout:
**15 s became 375 s**, a 25× regression, introduced by a change whose stated
purpose was to make the surface more reliable.

The failure is worse than "slow". A handler that runs past the edge's ceiling
gets cut, the browser sees a non-OK response, and on this route
`watch-progress-client.ts` reads any non-OK as signed-out — the exact symptom
the fix existed to remove. The fix re-opened its own defect through a new door,
and did so only under the degraded conditions it was written for.

## Symptoms

- A fan-out that "only" added a concurrency cap starts holding request handlers
  for minutes under upstream degradation, where it used to fail fast.
- Edge 502/504/524 on a route whose own handler would have returned a graceful
  degrade, if it had ever finished.
- Timeout constants look correct in isolation — every individual call is bounded
  — and no single call site looks wrong.
- The batch keeps issuing fresh requests at a dependency that has already failed
  every item in the previous round.

## The rule

**A per-item timeout is not a budget once a concurrency cap exists.** Any
bounded-width fan-out needs its own aggregate wall-clock budget, sized:

- **above** the healthy worst case, `ceil(n / width) × healthy per-item latency`
  — otherwise a healthy full-size batch is truncated and you have traded an
  availability bug for a correctness one;
- **below** the nearest enforcing ceiling upstream (here Cloudflare's ~100 s,
  since Railway does not enforce Next's `maxDuration`).

Write both bounds down at the constant. The number is meaningless without them,
and the next person to change `width` or `n` has to redo the arithmetic.

## Implementation

Three parts, and the third is the one that is easy to miss:

```ts
// 1. Workers stop CLAIMING new work once the deadline passes.
while (nextIndex < inputs.length && !signal.aborted) {
  // 3. The pool also RACES the deadline, so it settles on time even if some
  //    client in the chain ignores the signal. Losing the race leaves a hole,
  //    which the caller's null filter drops — partial successes survive.
  const outcome = await Promise.race([task(inputs[index], signal), deadlineReached])
  if (outcome === DEADLINE_REACHED) return
  results[index] = outcome
}

// 2. The same signal reaches the actual client, so in-flight calls are
//    cancelled instead of running on for a response nobody will read.
client.query({ ..., context: { fetchOptions: { signal } } })
```

Part 3 is not belt-and-braces paranoia; it is what makes the guard **testable**.
A test stubs the client, and a stub does not honor an `AbortSignal` unless you
write it to. Without the race, the budget test hangs to the runner's timeout
rather than asserting — which is exactly how this was discovered.

Build the abort promise **once per pool**, not once per task: a per-task
listener on a 200-item batch piles up on one signal and trips Node's
max-listeners warning.

## The test that actually discriminates a sliding-window pool

Measured against four pool implementations — sliding window, chunked waves,
sequential loop, and bare `Promise.all`:

| Assertion                                 | sliding window | chunked waves | sequential | `Promise.all` |
| ----------------------------------------- | -------------- | ------------- | ---------- | ------------- |
| `maxInFlight === width`                   | pass           | **pass**      | fail       | fail          |
| input order preserved                     | pass           | **pass**      | **pass**   | **pass**      |
| item `width` starts before item 0 settles | pass           | **fail**      | fail       | pass          |

So the two obvious assertions cannot tell a sliding window from chunked waves,
and the order assertion discriminates almost nothing — it catches a
completion-order `results.push` regression and nothing else. This extends the
trap list in the bounded-parallelism doc, which already warns that `<= N` passes
on a sequential regression; `=== N` fixes that one and is still blind to
chunked waves.

**The discriminating test**: cap the pool at `width`, hold item 0 unresolved,
and assert item `width` _starts_ before item 0 settles. Under any round-based
pool it cannot, because the round does not end until every member of it has.

Two more test notes:

- `AbortSignal.timeout` cannot be driven by fake timers. Test budgets with a
  tiny **real** signal injected through an options parameter, then pin
  separately that production passes none — otherwise the default the whole
  guard rests on is never the thing under test.
- Assert a partial result, not just a fast one. "Settles within the budget" is
  satisfied by returning nothing at all.

## Why the existing rule did not reach the author

Both governing docs predate the bug by months, and both generalize by their own
text — but they are tagged and moduled to `apps/admin`, `useworkflow`, and
backfill vocabulary, with nothing pointing at `apps/web` or route handlers, and
neither was ever added to root `CLAUDE.md`'s Known Patterns list. A web-focused
search for "fan-out" or "Promise.all" found nothing. The rule existed and was
undiscoverable, which is the more expensive half of this learning: a law filed
under one app's vocabulary is a law that only that app obeys.

## Related

- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`
  is the per-call form of this. This doc is its aggregate form: that one asks
  whether _a_ call fits the caller's budget, this one asks whether _all of them
  in series_ do.
- The second guard FGE-185 needed was unrelated to timing and worth naming
  separately: `watch-progress-server.ts`'s helpers already answered an unhealthy
  upstream with an empty result, but only for a response that _arrived_ — their
  `AbortSignal.timeout`, a connection error, and a non-JSON body all reject,
  skipping the `if (!response.ok) return []` contract entirely. **A fail-soft
  branch on the response is not a fail-soft function.** Check every way the call
  can reject, not just every status it can return.
