---
title: "Settle a delayed companion promise on every early-exit path of a streaming handler — an unawaited rejection escapes unhandled"
date: 2026-06-25
category: best-practices
problem_type: best_practice
component: streaming-route-handler
root_cause: companion-promise-orphaned-when-drain-throws-before-its-await
resolution_type: code_fix
severity: medium
module: apps/mastra
tags:
  - streaming
  - unhandled-rejection
  - reliability
  - sse
  - mastra
  - early-exit-cleanup
related:
  - docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
  - docs/solutions/best-practices/deterministic-mastra-sse-route-testing-stub-model-budget-seam-20260625.md
---

## Context

A streaming route handler often obtains, from a single call, **two things at
once**: a primary stream to drain _now_, and a **delayed companion promise**
that resolves only at stream finish and is awaited in a _second phase_. In
`apps/mastra`'s `/forge-seeker` SSE route (`apps/mastra/src/mastra/agents/seeker-route.ts`),
`agent.stream(...)` returns a `MastraModelOutput` exposing both
`output.textStream` (drained in a `while` loop → `token_delta` frames) and
`output.toolResults` (a `Promise<ToolResultChunk[]>` resolved at finish, awaited
_after_ the loop to extract the `retrieveAnswer` `sources[]`).

The companion `await` sits **after** the drain loop, inside the same `try`. If
the drain throws — provider error, mid-stream failure, an aborted run — control
jumps to the outer `catch` **before** reaching `await output.toolResults`.
Whether that strands a _rejecting_ promise depends on the companion's nature
(see Guidance): for an **eagerly-created** companion (a live `Promise` that
exists whether or not you read it), it is now unawaited and its later rejection
escapes — and the Mastra runtime has **no global `unhandledRejection` handler**
to catch it, so it can destabilize the process. For a **lazy,
materialize-on-access** companion (Mastra's `toolResults`, below), a promise may
never have been created on that path, so the hazard is narrower than it looks.
Either way the rule is one shape: any companion promise you _bring into
existence_ must have a handler on every path it can reject through.

The trap is that the obvious test passes. A "toolResults rejects **after a good
drain**" test is green, because on the good-drain path the promise _is_ awaited
(inside its own inner `try/catch`). Only the **drain-throws-THEN-companion-
rejects** interleaving orphans an eager companion — a cross-path that a
single-axis test never exercises.

## Guidance

When a handler holds an object exposing a stream **plus** a delayed companion
promise, make sure any companion promise you _bring into existence_ has a handler
on every path it can reject through — where to place that handler depends on the
companion's nature:

1. **Match the placement to whether the companion is a _materialized_ promise.**
   The hazard is an unhandled rejection on a real `Promise` object, so the right
   placement turns on _when that object comes to exist_. `.catch()` returns a new
   promise; the original still rejects into your real `await`, so settling never
   swallows a value or error you meant to handle.
   - **Eagerly-created companion** (a plain `Promise` field, `Promise.reject(...)`,
     or any property that is already a live promise) — it exists, and can reject,
     whether or not you ever read it, so attach a terminal handler **as early as
     it exists**. This is the case where an early-exit truly orphans a live
     rejection.
   - **Lazy, materialize-on-access companion** — settle only on the paths where
     you actually read it, and do **not** eager-touch it. Mastra's
     `MastraModelOutput.toolResults` is this case. Verified against
     `@mastra/core@1.36.0` (ESM `chunk-AM3IOVFX.js`): the getter is
     `get toolResults() { return this.#getDelayedPromise(this.#delayedPromises.toolResults) }`,
     and `#getDelayedPromise` is `if (!this.#consumptionStarted) { void this.consumeStream(); } return promise.promise`.
     Two consequences. **(a)** The _first_ access triggers `consumeStream()`
     (idempotent — it early-returns once started), so eager-touching the getter
     kicks off consumption before you've even set up the reader. **(b)** The
     underlying `DelayedPromise.promise` getter creates its `Promise` _lazily and
     caches it_, and `reject()` only rejects a real promise `if (this._promise)` —
     so on a path where you never read `toolResults`, **no promise is ever
     materialized and a rejection produces no unhandled rejection at all.** Net:
     the happy-path `await` reads and handles it; an error path that never reads
     it has nothing to orphan. Eager-attach is the _wrong_ default here — it both
     forces early consumption and materializes a promise you then have to own.

   The shipped seeker handler does exactly the right thing for this companion:
   it reads `toolResults` only on the happy path (awaited), and keeps a defensive
   `void output?.toolResults.catch(() => {})` in the outer `catch` / `cancel()` as
   harmless belt-and-suspenders (on the error path it _creates_ the rejected
   promise just to handle it — net-neutral, not load-bearing for a lazy
   companion, but the right habit and load-bearing if the companion is eager).
   One nuance from consequence (a): this is net-neutral only once consumption has
   started (the happy and drain-throw paths, where the first `reader.read()`
   already kicked off `consumeStream()`). On a `cancel()` that fires in the narrow
   window after `output` resolves but before the first `read()`, the settle is
   itself the _first_ access and starts consumption — but the `abortSignal` makes
   that abandoned work short-lived, so the cost is bounded rather than zero.

2. **Hoist the output handle** to the enclosing (start/cancel) scope either way,
   so the value is reachable from `cancel()` and (for per-path settling) the
   outer `catch`. A block-scoped `const output = await agent.stream(...)` is
   unreachable from those.
3. **Signal where the swallow IS your handling — don't let a systematic
   companion failure vanish.** Wherever you settle a companion failure as your
   real handling — the extraction `try/catch` that degrades to empty `sources`,
   or the per-path settle in the outer `catch` that is the _only_ handler on the
   drain-throw path — emit an enum-level signal (`event=tool_results_extraction_failed
reason=extraction_failed`, as the shipped seeker route does). A bare
   `catch(() => {})` is crash-safety, not error reporting: a systematically-failing
   companion (a tool-wiring bug that rejects every run) otherwise vanishes — and
   note it vanishes precisely on the drain-throw cross-path this doc exists to fix,
   where the `catch`-path settle is the only thing that runs and the request's
   sole log is the generic stream `error` frame. Log the **reason enum only, never
   the raw error text** — the companion may carry RAG / attacker-influenced strings
   (a log-injection vector), so this follows the same plain-string, enum-only
   discipline as the route's other logs.
4. **Know the one window neither placement covers:** a rejection of the
   `agent.stream(...)` call itself, or a disconnect _while it is still in
   flight_. There, `output` is still `null`, so `output?.toolResults` is a no-op.
   The stream-call promise is awaited inside the `try`, so its **own** rejection
   is caught; the residual gap is the narrow "resolved after a cancel, then the
   companion rejects" race — acknowledge it rather than assuming `cancel()`
   covers all disconnects.
5. **Regression-test the cross-path**, not just the single axis: drive a primary
   stream that errors mid-drain **and** a companion promise that rejects, then
   assert nothing escapes while the terminal `error` frame still emits.
   Crucially, do **not** pre-attach `.catch` to the companion promise in the test
   fixture — the handler must own the settling, or the test proves nothing. The
   detection mechanism has sharp edges (see the test caveat under Examples): a
   process-global `unhandledRejection` listener can catch a _different_ test's
   rejection under a shared worker pool, and a fixed `setTimeout` flush is a
   guess, not a barrier.

## Why This Matters

An unawaited promise that later rejects leaks the promise, **masks the error**
that caused it, and makes failures non-deterministic — reason enough to settle it
regardless of process policy. On top of that it can crash the process:
`--unhandled-rejections=throw` is the Node default since v15, though deploy
wrappers, process managers, and frameworks sometimes downgrade it to `warn` or
install a global handler. Don't lean on that downgrade — the durable reasons hold
either way, and Mastra installs no handler of its own. Streaming handlers are
_structurally_ prone to this: the companion value (tool results, token usage,
final metadata) is deliberately delayed and awaited in a second phase that an
early throw skips. The same shape recurs anywhere a single call yields a stream
**and** a `Promise` field: AI SDK `streamText` (`.usage`, `.finishReason`),
`fetch` + a trailers promise, DB cursors with a separate "rows affected" promise.

## When to Apply

Apply when **both** hold:

- A handler obtains, from one call, a primary stream **plus** a delayed companion
  promise (awaited in a later phase), and
- there are early-exit paths (a throw in the drain, an abort, a consumer
  disconnect) **between** obtaining the object and awaiting the companion promise.

Especially when the runtime has no global `unhandledRejection` handler (most
server runtimes; Mastra explicitly none). Pair this with the related
**fire-and-forget slot-leak** guard ([[in-memory-slot-reservation-fire-and-forget-20260506]]):
both are early-exit-cleanup-in-async-callbacks rules — that one releases a
reserved slot, this one settles an orphaned promise.

## Examples

Before — the hazard when the companion is (or becomes) a live promise:

```ts
const stream = new ReadableStream({
  async start(controller) {
    try {
      const output = await agent.stream(prompt, { memory, abortSignal })
      const reader = output.textStream.getReader()
      while (true) {
        const { done, value } = await reader.read() // ← throws here
        if (done) break
        enqueue(tokenFrame(value))
      }
      const { sources } = extractSources(await output.toolResults) // ← never reached
      enqueue(resultFrame(sources))
    } catch {
      // If the companion is an eagerly-created/live promise, it is now unawaited
      // and its later rejection is unhandled — no global handler in the runtime.
      // (For a lazy materialize-on-access companion like Mastra's toolResults,
      // this path never read it, so nothing is orphaned — see Guidance.)
      enqueue(errorFrame(reason))
    } finally {
      controller.close()
    }
  },
})
```

Recommended for a lazy, materialize-on-access companion (Mastra's `toolResults`)
— read it only where you need it; do not eager-touch it; settle defensively on
the error path. This is what the shipped seeker handler does:

```ts
let output: SeekerStreamOutput | null = null
let reader: ReadableStreamDefaultReader<string> | null = null
const stream = new ReadableStream({
  async start(controller) {
    try {
      output = await agent.stream(prompt, { memory, abortSignal })
      reader = output.textStream.getReader()
      let full = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += value
        enqueue(tokenFrame(value))
      }
      try {
        // The ONLY place we read toolResults — awaited here, so it is handled.
        const { sources } = extractSources(await output.toolResults)
        enqueue(resultFrame(full, sources))
      } catch {
        // The swallow IS the handling here, so signal it (enum reason only, no
        // raw error text) — don't let a systematic companion failure vanish.
        logEvent("tool_results_extraction_failed", "extraction_failed")
        enqueue(resultFrame(full, [])) // degrade to ungrounded, not an error frame
      }
    } catch {
      // Drain threw before we read toolResults. For Mastra's lazy companion this
      // path never materialized the promise (nothing to orphan); the defensive
      // settle is harmless belt-and-suspenders — and load-bearing if the
      // companion were eager. If it is the sole settler, log it too (point 3).
      void output?.toolResults.catch(() => {})
      enqueue(errorFrame(reason))
    } finally {
      controller.close()
    }
  },
  cancel() {
    void reader?.cancel().catch(() => {})
    void output?.toolResults.catch(() => {}) // no-op if output is null; else touches (may start consumption on) a lazy companion — accepted on disconnect
  },
})
```

For an _eagerly-created_ companion (a live `Promise` that exists regardless of
whether you read it), attach the handler the instant it exists — an early exit
orphans it otherwise:

```ts
const companion = obtainEagerCompanion() // already a live, rejectable Promise
void companion.catch(() => {}) // attach now; covers every later exit path
```

Cross-path regression test — note the fixture's `Promise.reject(...)` is an
_eagerly-created_ companion on purpose: that is how you force the hazard
deterministically (a lazy getter would not orphan unless accessed). This test
fails only if the handler doesn't settle it:

```ts
it("settles a rejected toolResults when the textStream drain throws", async () => {
  const stream = () => ({
    textStream: new ReadableStream<string>({
      start(controller) {
        controller.enqueue("partial")
        controller.error(new Error("stream blew up mid-drain"))
      },
    }),
    // No `.catch` pre-attached — the route must own settling it.
    toolResults: Promise.reject(new Error("toolResults exploded late")),
  })
  const rejections: unknown[] = []
  const onRejection = (r: unknown) => rejections.push(r)
  process.on("unhandledRejection", onRejection)
  try {
    const body = await readSse(
      await handleRequest({
        /* ...stub agent... */
      }),
    )
    expect(body).toContain("event: error")
    await new Promise((resolve) => setTimeout(resolve, 10)) // flush rejections
  } finally {
    process.off("unhandledRejection", onRejection)
  }
  expect(rejections).toEqual([])
})
```

**Caveat on the detection mechanism.** A process-global
`process.on("unhandledRejection", …)` listener has two sharp edges the example
above glosses: under a shared test-worker pool it can catch a _different_
concurrently-running test's rejection (spurious failure) or leak yours into
another file's listener — pin the file to an isolated / single-fork pool when you
use it. And the fixed `await new Promise((r) => setTimeout(r, 10))` is a _guess_,
not a barrier: unhandled-rejection delivery is GC/microtask-timed, so on a loaded
runner a real orphan can arrive _after_ the assertion and the test passes green
while broken — defeating the "deleting the guard must fail a test" contract. More
robust: assert deterministically that the handler attached a settler (spy on the
companion-promise fixture and assert it was consumed), and use `vi.waitFor`
rather than a fixed sleep.

This is also a worked instance of the
[[mocked-shape-vs-real-contract-discipline-20260506]] rule: a test where **only
the cross-path can match** — deleting the handler's companion settle must fail a
test, or the guard is decorative.
