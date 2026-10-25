---
title: "A budget/race helper must settle the caller's promise on every exit path — the already-aborted fast path orphans it"
date: 2026-08-19
category: best-practices
problem_type: best_practice
component: service_object
root_cause: async_timing
resolution_type: code_fix
severity: high
module: apps/mastra
applies_when:
  - "A shared helper races a caller-constructed promise against an AbortSignal (settleWithinBudget, Promise.race timeout wrappers, any outbound-timeout-shorter-than-caller-budget implementation)"
  - "The helper has a fast path that returns or rejects WITHOUT attaching a handler to the promise argument (already-aborted signal, cached short-circuit, pre-flight refusal)"
  - "Callers construct the in-flight promise in the argument position, so the helper is the only place a handler could ever be attached"
  - "A caller passes a long-lived or composed signal (AbortSignal.any of a turn signal and a budget signal) that can already be aborted at call time"
  - "The runtime registers no process-level unhandledRejection handler, so an escaped rejection is fatal for every tenant of that process"
symptoms:
  - "An in-flight promise passed as an argument is never awaited on the helper's early-return path, so its later rejection escapes as an unhandled rejection"
  - "Node's default posture kills the process, taking down a single-replica runtime that serves every unrelated agent and workflow"
  - "The hazard is unreachable — and so invisible to every existing test — until one caller passes a signal that can be aborted at call time"
  - "A client disconnect in a post-answer window is the production trigger, which no happy-path or timeout test exercises"
related_components:
  - assistant
  - testing_framework
tags:
  - unhandled-rejection
  - early-exit-cleanup
  - async-timing
  - abort-signal
  - budget-race
  - reliability
  - mastra
  - seeker
related:
  - docs/solutions/best-practices/settle-orphaned-companion-promise-streaming-early-exit-20260625.md
  - docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
  - docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md
  - docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md
  - docs/solutions/performance-issues/swr-cache-failure-backoff-manager-20260331.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
---

# A budget/race helper must settle the caller's promise on every exit path — the already-aborted fast path orphans it

## Context

`settleWithinBudget(promise, signal)` in `apps/mastra/src/mastra/budgets.ts:208-237`
is this app's shared implementation of the repo's
outbound-timeout-shorter-than-caller-budget law for **opaque** calls. Its docstring
(`apps/mastra/src/mastra/budgets.ts:199-207`) states the reason it exists: the pinned
`@mastra/pg` store runs no `statement_timeout`, so without the wrapper a slow — not
down — Postgres hangs a request past its wall-clock budget with no terminal outcome.
The helper resolves the passed promise, or rejects with `budget_aborted` when the
signal fires first.

Its shape matters more than its body. The signature takes **a promise the caller has
already constructed**, and every call site constructs it in the argument position:

- `apps/mastra/src/mastra/agents/seeker-route.ts:450-457` — the ai-chat send route's
  thread-ownership check.
- `apps/mastra/src/mastra/ai-chat-history-route.ts:702`, `:767`, `:786` — the feat-241
  history list and replay reads.
- `apps/mastra/src/mastra/seeker-follow-ups-persist.ts:241` — the feat-366 metadata
  persist.
- `apps/mastra/src/mastra/seeker-follow-ups-generate.ts:267-275` — the feat-366
  follow-ups generation, which wraps `seam({ ... })` directly in the argument slot.

Because the argument is evaluated first, the work promise is **live before the helper
executes its first statement**. The helper therefore owns it on every path, including
paths that never reach the race.

The pre-fix helper had one such path. Its fast path for a signal that was already
aborted at call time read:

```ts
if (signal.aborted) return Promise.reject(new Error("budget_aborted"))
```

That branch returns without attaching any handler to `promise`. The in-flight work is
orphaned. If it later rejects, the rejection is unhandled.

**The bug was latent, not dormant by luck.** Every caller before feat-366 passes a
plain `AbortSignal.timeout(budgetMs)` — minted at `seeker-route.ts:402` (passed as
`budgetSignal` at `:456`), at `ai-chat-history-route.ts:700` and `:762`, and at
`seeker-follow-ups-persist.ts:199`. The right test is not how recently the signal was
minted but whether its deadline can have ELAPSED before the helper runs — and for
those callers it cannot in practice: the mint and the call sit in one near-synchronous
span, or the deadline (an 8 s read budget, a 90 s turn budget) dwarfs the gap. The one
prior edge is `ai-chat-history-route.ts:786`, which REUSES `:762`'s 8 s signal after an
awaited store read: a near-deadline race there could hand the helper an already-elapsed
signal, so the fast path was rare-but-reachable at that site all along — one more
reason the fix belongs in the helper (Guidance 6).

feat-366's generator is the first caller that composes the **caller's long-lived turn
signal**:

```ts
const budgetSignal = AbortSignal.timeout(budgetMs)
const abortSignal = input.turnSignal
  ? AbortSignal.any([input.turnSignal, budgetSignal])
  : budgetSignal
```

(`apps/mastra/src/mastra/seeker-follow-ups-generate.ts:229-232`.) Per WHATWG semantics,
`AbortSignal.any` returns an already-aborted composite when any input is already
aborted. Follow-ups generation runs in a new window of up to 2.5 s **after** the answer
stream finishes and before the terminal frame. A client disconnect that lands in that
gap makes `turnSignal` already-aborted when `generateSeekerFollowUps` runs, so the
composite is already-aborted, so the fast path is taken with a live provider call
behind it.

The generator did not start on the helper. The first feat-366 implementation carried
its own hand-rolled race/timeout scaffolding in both new modules; a reuse review pass
then replaced both with the shared `settleWithinBudget`. That simplification was
correct on its own terms — and it is precisely the step that moved a latent helper
branch onto a reachable input. The helper's source did not change; its reachable input
space did.

The finding came from a multi-persona code review of the feat-366 tree — reliability
persona, P1, confidence 75, confirmed by an independent validator. It was caught before
merge. **The defect never ran in production.**

## Guidance

**The law: a helper that accepts a caller-constructed promise must attach a terminal
handler to that promise on every exit path — including fast paths, validation
rejections, and any branch that returns before the race is constructed.**

1. **Enumerate the helper's exits, not its happy path.** The race body is usually
   correct, because writing `promise.then(resolve, reject)` is the whole point of the
   function. The defect lives in the branches added later for speed or for argument
   validation, where "return early" reads as free. It is not free: the argument already
   exists.

2. **Understand the ownership inversion — the caller cannot fix this.** The caller has
   no handle on the inner promise: it wrote it inline, and what it receives back is the
   helper's own rejected promise, which its `catch` handles correctly. The caller's code
   looks complete and its tests pass. Only the helper can settle what the helper
   orphaned. This is the inverse of the caller-side orphan in
   `docs/solutions/best-practices/settle-orphaned-companion-promise-streaming-early-exit-20260625.md`,
   where the handler owns both halves and places the settle itself.

3. **Reachability is a property of the CALL SITE's signal lifetime, never of the
   helper.** Ask whether the signal's deadline can have elapsed before the helper's
   first statement: minted and consumed in one synchronous span, or a deadline that
   dwarfs any intervening await, means the fast path is dead. A composed signal, a
   request signal, a turn signal, a short budget signal reused after an await, or any
   signal that outlives one call makes it live. feat-366 added two callers and shows
   both sides: `seeker-follow-ups-persist.ts:199` mints a local timeout signal and is
   deliberately not composed with the request signal, so it is safe; the generator
   composes and is not. Same helper, same change, opposite reachability.

4. **Reviewing a NEW CALLER includes re-auditing the shared helper's early exits against
   that caller's signal lifetime.** This is the step that would have caught it earlier.
   A helper that has been correct for months is correct only for the signal lifetimes it
   has been given so far. Adding the first composed-signal caller is a change to the
   helper's reachable behavior, even though the helper's source is untouched. A reuse or
   DRY refactor that moves a call site onto the shared helper is exactly such an event:
   the refactor diff touches no helper line and every existing helper test stays green,
   yet the helper's reachable input space now includes whatever the new call site can
   pass. Re-derive that input space — here, "can this caller hand over an
   already-aborted signal?" — as part of applying the reuse finding. Sequencing
   corollary: run reuse/simplify passes before the review pass, so reviewers read the
   post-refactor tree; here the reliability review read the refactored call site, which
   is how the orphan was caught at all.

5. **`promise.catch(() => {})` is the correct settle here, and the "signal where the
   swallow is your handling" rule does not add a log line.** On this branch the work has
   already been abandoned by contract — the caller asked for a budget the signal says is
   spent. The caller already emits the outcome: `generateSeekerFollowUps` maps the
   rejection to a fixed enum at `apps/mastra/src/mastra/seeker-follow-ups-generate.ts:295-299`
   (`aborted` / `timeout` / `generation_failed`). Do not log the swallowed error itself:
   it can embed the raw model reply (R9), which is religious-belief conversation content.

6. **Fix it in the helper, once.** One line in the shared helper hardens every current
   and every future caller. A guard added at one call site leaves the next composed-signal
   caller exposed and gives a false reading of coverage.

7. **A caller-side gate is economy, not the correctness fix — say so where you write it.**
   `apps/mastra/src/mastra/agents/seeker-route.ts:542-556` checks
   `!closed && !abortSignal.aborted` before invoking generation, so no paid provider call
   starts for an audience that has gone. Its comment records that the generator survives
   an already-aborted signal regardless. Without that sentence, a later reader deletes the
   helper's `catch` and trusts the gate, or deletes the gate and believes it removed the
   crash guard.

8. **Test the fast path with a live unawaited promise behind it — the obvious abort tests
   do not.** The pre-existing suite had abort coverage and none of it could go red: every
   case either aborted **after** the call started (so the race body owned the promise) or
   used a budget signal that fires later (so the fast path was never taken). The
   discriminating test needs three elements together: a signal that is already aborted at
   call time, a work promise that is still pending when the helper returns, and a
   rejection delivered **after** the helper's promise has settled. Register a process
   `unhandledRejection` listener, assert the helper rejects, reject the deferred late, then
   assert nothing escaped. Write it red-first: the pre-fix red is the runner reporting the
   escaped rejection, which pins the process-level symptom rather than only the helper's
   return value. Pair it with an anti-vacuous companion that proves the normal path still
   resolves, or a helper that rejects everything passes the guard.

9. **Pin it at both layers — and pin the wiring that makes the caller layer real.** The
   helper-level test proves the mechanism; the caller-level test proves this call site
   actually routes into it and still returns its documented outcome. Neither substitutes
   for the other: the helper test survives a call site that stops using the helper, and
   the caller test survives a helper that settles by accident. feat-366 carries a third
   pin one level up (`apps/mastra/src/mastra/agents/seeker-route.test.ts:2311`, "threads
   the route's REAL composed abort signal into generation as turnSignal") — before it,
   every route-level test injected a generation seam, so nothing proved the production
   wiring passes the composed signal at all (the mocked-shape-vs-real-contract
   discipline).

## Why This Matters

An orphaned rejection is not a leak here — it is a process kill.

- **Node's default posture terminates the process.** `--unhandled-rejections=throw` has
  been the default since Node 15.
- **This app installs no safety net.** A grep for `unhandledRejection` across
  `apps/mastra/src` returns hits only in test files
  (`apps/mastra/src/mastra/budgets.test.ts`,
  `apps/mastra/src/mastra/seeker-follow-ups-generate.test.ts`,
  `apps/mastra/src/mastra/agents/seeker-route.test.ts`,
  `apps/mastra/src/services/langfuse-prompt-client.test.ts`). There is no production
  `process.on("unhandledRejection")` handler anywhere in the app.
- **The blast radius is the whole runtime.** `apps/mastra` runs a single replica (a
  standing constraint recorded in `apps/mastra/CLAUDE.md`) and serves every Mastra agent
  and workflow in the system. One client that disconnects at the wrong moment would crash
  every concurrent request — seeker turns, history reads, embedding workflows, devotional
  runs.
- **The trigger is likely, not exotic.** The orphaned promise is `agent.generate()` invoked
  with an already-aborted signal. That call does not hang; it rejects promptly. So on the
  reachable path the orphan almost always **does** reject, and the crash follows the
  disconnect by milliseconds.
- **The failure would have been hard to attribute.** The crash surfaces with no request in
  flight to blame, in a process whose logs are enum-only by design, triggered by a client
  that is already gone.

The wider lesson is about how this class of defect hides. A `(promise, signal)` helper is
sound for as long as every caller hands it a freshly minted signal. Nothing in the helper,
its tests, or its call sites changes on the day someone passes a composed one. The helper
does not become wrong; it becomes **reachable**.

## When to Apply

Apply when all of these hold:

- A function accepts a promise (or a thunk whose invocation the caller writes at the call
  site) **plus** a deadline, signal, or other race participant, and
- it has any exit path that returns or throws **before** attaching a handler to that
  promise — an already-aborted fast path, an argument-validation rejection, a
  cached-answer short-circuit, a disabled-flag early return, and
- the runtime installs no global `unhandledRejection` handler (most server runtimes;
  `apps/mastra` explicitly none).

Also apply the review step in Guidance 4 whenever you add a **new caller** to any existing
helper of this shape — including by reuse refactor — especially the first caller that
passes a composed (`AbortSignal.any`), request-scoped, or otherwise long-lived signal.

Common shapes with the same hazard: `withTimeout(p, ms)`, `raceWithSignal(p, signal)`,
retry wrappers that reject on a closed circuit breaker, semaphore acquires that reject when
the queue is full, and any `Promise.race` helper that grew a fast path.

This is distinct from — and complementary to — the fire-and-forget slot-reservation law
(`docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`),
which releases a **reserved slot** on early exit. This one settles a **promise the caller
already created**.

## Examples

### Before — the orphaning fast path

```ts
export function settleWithinBudget<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("budget_aborted"))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("budget_aborted"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
```

The race body settles `promise` on both outcomes. The fast path settles nothing.

### After — the shipped fix (`apps/mastra/src/mastra/budgets.ts:212-222`)

```ts
if (signal.aborted) {
  // Settle the caller's promise before rejecting: the argument was already
  // constructed by the caller, so returning without attaching any handler
  // would orphan it, and its eventual rejection would escape as an
  // unhandled rejection — process-fatal under Node's default posture (this
  // app registers no global handler). First reachable with an
  // already-aborted signal via the feat-366 follow-ups generation path,
  // whose composed turn signal can fire before the call (review finding).
  promise.catch(() => {})
  return Promise.reject(new Error("budget_aborted"))
}
```

One added line. The comment carries the ownership argument and the reachability
provenance, so the line does not read as removable ceremony.

### The composition that armed it

```ts
const budgetSignal = AbortSignal.timeout(budgetMs)
const abortSignal = input.turnSignal
  ? AbortSignal.any([input.turnSignal, budgetSignal])
  : budgetSignal
```

(`apps/mastra/src/mastra/seeker-follow-ups-generate.ts:229-232`.) The call then passes
that composite alongside a promise built in place
(`apps/mastra/src/mastra/seeker-follow-ups-generate.ts:267-275`):

```ts
const raced = await settleWithinBudget(
  seam({
    prompt,
    abortSignal,
    requestContext: input.requestContext,
    tracingOptions: input.tracingOptions,
  }),
  abortSignal,
)
```

### Helper-layer regression test (`apps/mastra/src/mastra/budgets.test.ts:109-143`)

Named "settles the given promise on the ALREADY-ABORTED fast path — a late rejection cannot
escape unhandled (feat-366 review #1)". Its shape is the discriminating one from Guidance 8:

```ts
const escaped: unknown[] = []
const listener = (reason: unknown) => {
  escaped.push(reason)
}
process.on("unhandledRejection", listener)
try {
  const aborted = AbortSignal.abort()
  let rejectLater!: (error: Error) => void
  const doomed = new Promise<never>((_, reject) => {
    rejectLater = reject
  })
  await expect(settleWithinBudget(doomed, aborted)).rejects.toThrow(
    "budget_aborted",
  )
  rejectLater(new Error("late failure after the fast-path return"))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(escaped).toEqual([])
} finally {
  process.removeListener("unhandledRejection", listener)
}
```

`AbortSignal.abort()` guarantees the fast path. `doomed` is still pending when the helper
returns, so only the helper can have attached the handler. The rejection is delivered after
the assertion, so it can only be caught by a handler the helper attached. The anti-vacuous
companion follows at `:137-142`.

### Caller-layer companion (`apps/mastra/src/mastra/seeker-follow-ups-generate.test.ts:156-188`)

Named "never orphans the seam promise when the turn signal is ALREADY aborted (feat-366
review #1 — the settleWithinBudget fast path)". It drives the same shape through the
generator with a `generateSeam` whose promise rejects after the outcome resolves, and
asserts both halves of the contract: the documented outcome survives
(`outcome.reason === "aborted"`, `outcome.questions` empty) **and** nothing escaped.

### Defense in depth at the route (`apps/mastra/src/mastra/agents/seeker-route.ts:542-556`)

```ts
        if (
          followUpsEnabled &&
          !closed &&
          !abortSignal.aborted &&
          shouldGenerateFollowUps({ grounded, answer: full })
        ) {
```

The comment above it states the split explicitly: `!closed` and `!abortSignal.aborted` cover
two different disconnect shapes and exist so no paid provider call starts for an aborted
turn, while "the generator survives an already-aborted signal — the settleWithinBudget fast
path settles the seam promise". Economy and sibling-disconnect coverage, not the correctness
fix.

## Related

- `docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md` — the same
  settlement-path hazard family. Its fulfillment-only `void flight.then(release)` trap is
  the mirror image of this one (a handler attached to the wrong settlement path, rather than
  to no path), and it carries the fuller statement of the process-fatality rationale:
  Node's default terminates, and Mastra installs no handler of its own.
- `docs/solutions/best-practices/settle-orphaned-companion-promise-streaming-early-exit-20260625.md` —
  the caller-side twin. There a streaming handler orphans a companion promise it owns; here a
  shared helper orphans a promise its caller constructed and cannot reach. Read together for
  the placement rule: settle where the promise is reachable, which is not always where it was
  created.
- `docs/solutions/performance-issues/swr-cache-failure-backoff-manager-20260331.md` — prior
  art for the exact mechanism in `apps/manager`: its stale-serve early return attaches a
  `.catch()` to the background refresh it stopped awaiting. This doc records the third
  in-repo recurrence of the settle-on-early-exit mechanism — which is what promotes it from
  an incident note to a standing law.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` —
  the law `settleWithinBudget` implements, and the reason the helper exists at all.
- `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md` —
  the sibling early-exit-cleanup law for reserved slots rather than orphaned promises.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the
  META home for the test-discipline half; the route-level real-composed-signal pin in
  Guidance 9 is an instance.
- `docs/plans/2026-08-18-0406-feat-seeker-follow-up-questions-plan.md` — feat-366, whose KTD6
  budget mechanics introduced the first composed-signal caller and made the fast path
  reachable.
