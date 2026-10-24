---
title: "Mastra model-entry fetch timeouts: p-retry retries non-APICallError aborts, and AbortSignal bounds the whole streamed body"
date: 2026-07-08
last_updated: 2026-08-19
category: best-practices
module: apps/mastra
problem_type: best_practice
component: assistant
severity: medium
applies_when:
  - "Adding a per-attempt AbortSignal.timeout fetch guard to a Mastra model-array entry (e.g. an opt-in primary/fallback model) without also setting maxRetries: 0 on that entry"
  - "Assuming @mastra/core's built-in retry loop only retries typed APICallError instances with isRetryable true — its shouldRetry falls through to true for any other error, including an undici TimeoutError DOMException from an aborted fetch"
  - "Passing a composed AbortSignal.timeout as fetch's signal for a streaming LLM response — it bounds the entire fetch including the body read, not just header arrival, so it can abort a healthy still-streaming response mid-token"
  - "Testing a Mastra model-entry timeout/abort path — vitest fake timers cannot intercept AbortSignal.timeout; use an exported factory (timeoutMs, fetchImpl=fetch) plus a stub fetch that captures the composed signal, with tiny real budgets"
  - "Deciding whether a Mastra model entry needs maxRetries: 0 when the deadline is the CALLER's abortSignal rather than an attempt-local fetch timeout — the caller-threaded signal reaches p-retry's signal: option and bounds attempts and fallback entries, but not an in-flight attempt (see the 2026-08-18 amendment)"
root_cause: wrong_api
resolution_type: code_fix
tags:
  - mastra
  - timeout
  - retry
  - abortsignal
  - model-fallback
  - streaming
  - p-retry
  - sse
---

# Mastra model-entry fetch timeouts: p-retry retries non-APICallError aborts, and AbortSignal bounds the whole streamed body

## Context

feat-237 (`docs/plans/2026-07-07-004-feat-seeker-gateway-model-plan.md`) wires the self-hosted JesusFilm AI gateway chat model as the seeker agent's env-gated opt-in primary, ahead of the free-Gemma OpenRouter fallback chain, guarded by a per-attempt `AbortSignal.timeout` fetch wrapper (KTD9 — the plan's key-technical-decision ID, which also appears in the code comments quoted below). The plan's own fact table asserted "per-entry `maxRetries` retries only retryable (408/429/5xx-class) errors" and shipped the gateway entry with `maxRetries: 1`. A multi-persona code review of the PR — three reviewers including an independent cross-model codex pass — flagged that assumption as wrong before it was confirmed by directly reading the installed `@mastra/core@1.36.0` dist. A fourth validator then empirically reproduced a second, unrelated hazard in the same guard: the timeout signal bounds the whole fetch, not just connection setup, so it can abort a healthy in-progress stream too. Both findings changed the shipped code and its tests.

## Guidance

**Rule 1 — a per-attempt fetch-timeout guard on a Mastra model-array entry must pair with `maxRetries: 0`.** `@mastra/core`'s model-execution loop wraps each entry's `doStream`/`doGenerate` call in `p-retry` with this `shouldRetry` (verified in `apps/mastra/node_modules/@mastra/core/dist/chunk-AM3IOVFX.js:17915-17945`):

```js
return await pRetry.default(
  async () => {
    /* ...doStream/doGenerate... */
  },
  {
    retries: modelSettings?.maxRetries ?? 2,
    signal: abortSignal,
    shouldRetry(context) {
      if (APICallError.isInstance(context.error)) {
        return context.error.isRetryable
      }
      return true
    },
  },
)
```

`shouldRetry` only special-cases `APICallError` (the typed 408/429/5xx-class HTTP error). Everything else — including the `TimeoutError` DOMException that `AbortSignal.timeout` produces on fire, which `@ai-sdk/provider-utils` passes through raw (undici) — falls to `return true` and gets retried up to `maxRetries` times. There is no distinct "timeout" branch. The fallback chain _below_ a model-array entry is Mastra's actual retry mechanism for a hanging entry; per-entry `maxRetries` on top of a timeout guard just multiplies the hang.

`apps/mastra/src/mastra/agents/seeker-agent.ts:156-166` encodes this as the entry's `maxRetries`:

```ts
// 0, NOT 1 (deviation from the plan's R1, review-verified): Mastra's
// per-entry retry (p-retry) retries ANY non-APICallError, so a KTD9
// timeout abort WOULD be retried — a hanging gateway would burn
// (retries+1) x the fetch timeout before failover, blowing the intent
// of the in-budget guarantee. With 0, a hang costs exactly one
// timeout window and the Gemma chain below IS the retry; a transient
// gateway 5xx also falls straight to Gemma, today's behavior anyway.
maxRetries: 0,
```

**Scope limit (2026-08-18, feat-366) — Rule 1 is a law about ATTEMPT-LOCAL timeouts.** A
deadline the model entry itself owns (a custom `fetch`'s own `AbortSignal.timeout` — the KTD9
guard above) is invisible to the retry loop, and everything in this rule applies. A deadline
threaded as the CALLER's own signal — `agent.generate(prompt, { abortSignal })`, or the same
option on `stream()` — reaches p-retry's `signal:` option and does not carry this hazard; it
needs no `maxRetries: 0` on that account. The discriminator a reader can apply without opening
a dist: does p-retry SEE your signal? It sees the caller's threaded signal; it never sees a
timeout composed inside a custom `fetch`. Mechanism, measurements, and the wall-clock
carve-out are in the dated amendment at the end of this doc — do not apply either shape's
conclusion to the other.

**Rule 2 — read the retry count from the live entry in a test, don't hardcode it.** `apps/mastra/src/mastra/agents/seeker-agent.test.ts:216-237`:

```ts
it("keeps the worst-case gateway occupancy strictly below the route turn budget (KTD9)", () => {
  mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
  mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = "true"

  const [gatewayEntry] = buildSeekerModelList()
  const worstCaseGatewayMs =
    ((gatewayEntry?.maxRetries ?? 0) + 1) * SEEKER_GATEWAY_FETCH_TIMEOUT_MS
  // Leave the Gemma fallback at least this much of the turn budget for a
  // full tool-calling turn after the gateway gives up (free-tier successes
  // measured 12-25s; feat-198 residual).
  const GEMMA_FALLBACK_ALLOWANCE_MS = 30_000
  expect(worstCaseGatewayMs).toBeLessThan(
    TIME_BUDGET_MS.chatTurn - GEMMA_FALLBACK_ALLOWANCE_MS,
  )
})
```

Reading `gatewayEntry?.maxRetries` from `buildSeekerModelList()`'s real output (not a literal `0` in the assertion) means a future bump of the entry's `maxRetries` re-enters this invariant and fails the test instead of silently widening the hang window.

**Rule 3 — test the abort MECHANISM, not the configured number.** The timeout wrapper is exported as an injectable factory precisely so the composed `AbortSignal` can be inspected directly (`seeker-agent.ts:58-70`):

```ts
export function createGatewayFetchWithTimeout(
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return (input, init) =>
    fetchImpl(input, {
      ...init,
      signal:
        init?.signal != null
          ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
    })
}
```

The `describe("createGatewayFetchWithTimeout (KTD9 abort mechanism)", ...)` block (`seeker-agent.test.ts:240-304`) covers three cases with **tiny real budgets** (vitest fake timers cannot intercept `AbortSignal.timeout` — see Related), a stub `fetchImpl` that only captures `init.signal`:

1. No caller signal → the composed signal fires after the real budget and `(signal.reason as DOMException).name === "TimeoutError"` — the exact class name `shouldRetry`/Mastra's fallback loop sees thrown, which is _why_ the entry pins `maxRetries: 0`.
2. A caller signal present → `caller.abort(...)` propagates through `AbortSignal.any` and the composed signal aborts immediately (route-side abort wins).
3. A caller signal present but never fired → the timeout still fires on its own schedule, same `TimeoutError` name.

## Why This Matters

The failure envelope arithmetic, worked from the review-time constants in `seeker-agent.ts` (`SEEKER_GATEWAY_FETCH_TIMEOUT_MS` was `30_000` at review; raised to `55_000` pre-merge after the live smoke measured healthy gateway turns up to ~27s on routine questions). At the plan's original `maxRetries: 1`, worst-case gateway occupancy before Gemma failover would have been `(1 + 1) * 30_000 = 60_000ms` — plus `p-retry`'s default backoff (~1s) — against the route's `TIME_BUDGET_MS.chatTurn = 90_000ms` (`apps/mastra/src/mastra/agents/seeker-route.ts` / `apps/mastra/src/mastra/budgets.ts`). That leaves roughly 29s for the ENTIRE Gemma fallback chain (2 more model attempts, each potentially retried again, plus the `retrieveAnswer` tool call and generation) — not the "leave the Gemma fallback at least 30s" allowance the shipped invariant test enforces. A hanging (not failing, _hanging_) upstream at `maxRetries: 1` could burn two-thirds of the whole turn budget on one dead entry before the user's request even reaches the model that will actually answer. At `maxRetries: 0` the same hang costs exactly one timeout window, leaving the Gemma chain at least the invariant test's 30s allowance — the bound the test actually protects.

This is easy to get wrong at plan time because the natural (and here, explicitly plan-pinned) assumption is "retry logic only retries things that look retryable" — a reasonable prior for typed HTTP client libraries, and true for `APICallError.isRetryable`. But `shouldRetry`'s fallback branch (`return true`) makes that prior false for _any other thrown value_, and a custom `fetch`'s abort exception is exactly that "any other" case: it's a DOMException, not an `APICallError`, so it never reaches the `isRetryable` check at all. The only way to catch this class of bug is reading the actual retry-loop implementation in the installed dependency — which is what three independent reviewers converged on before this shipped, correcting the plan's fact table after the fact.

The second, related consequence (not a retry issue, a streaming-semantics issue): `AbortSignal.timeout` as the fetch `signal` bounds the _whole_ fetch call, including the streaming response body read — not just the time-to-first-byte. This was empirically reproduced on Node v24.16.0: a healthy stream emitting a fresh chunk every 500ms was still hard-aborted at the scaled deadline, because `@ai-sdk/provider-utils`' `postToApi` passes the composed signal straight into `fetch()` with no header-arrival clearing logic. Two consequences worth knowing before choosing this guard shape: (a) a whole-stream cap aborts healthy-but-slow answers, not just hangs — a real answer still generating tokens at t=30s gets cut off exactly like a truly dead connection would; (b) when the gateway had already streamed partial tokens to an SSE client before the abort, Mastra's fallback loop re-generates the _whole_ turn on the next model into the _same_ output stream with no model-boundary reset, so the client sees a concatenated ("Frankenstein") reply — half gateway tokens, half Gemma tokens, no separator.

## When to Apply

- Any Mastra `ModelWithRetries[]` array entry (or future custom-`fetch` provider construction anywhere in the codebase) that wraps its `fetch` in a per-attempt timeout guard: pair with `maxRetries: 0` on that entry, or explicitly size the timeout budget retry-aware (`(maxRetries + 1) * timeoutMs` fits inside the caller's ceiling with allowance for whatever runs after).
- **Not this rule:** a deadline you thread as the caller's own `agent.generate(prompt, { abortSignal })` / `stream({ abortSignal })` signal. `@mastra/core` passes that signal into p-retry's `signal:` option, so it gates every attempt and every backoff sleep and unwinds the fallback loop — the retry-multiplication hazard above does not apply, and `maxRetries: 0` is not required on that account. It still does not cut an attempt already in flight, so pair it with a caller-side `Promise.race` on the same budget whenever the deadline is a promise rather than a best effort. See the 2026-08-18 amendment below.
- Any streaming provider called through a custom `fetch` bounded by `AbortSignal.timeout` (or any single whole-request abort signal): understand that "timeout" here means "abort the entire response including the body stream," not "abort if headers never arrive." If healthy answers can legitimately run close to the cap, that's a design smell pointing toward a time-to-first-byte + idle-per-chunk guard instead of (or in addition to) a whole-stream cap.
- Any outbound call sized under an upstream caller's time budget (the general law from `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`) that ALSO sits inside a retrying framework you don't control: check the framework's actual retry-classification logic before assuming "non-retryable errors don't retry." Read the dist, don't infer from the type name.
- Any test asserting a computed timing/retry invariant: derive both operands (the retry count, the per-attempt timeout) from the real production code path (`buildSeekerModelList()`'s actual output here), not from literals copied into the test, so a later change to either constant is caught rather than silently invalidating the invariant.

## Examples

**Before (plan-pinned, review-corrected):**

```ts
// plan R1 — maxRetries: 1, based on the (wrong) assumption that only
// retryable APICallErrors are retried
return [
  {
    model: gateway.chat(
      env.AI_GATEWAY_CHAT_MODEL ?? "coding",
    ) as unknown as MastraModelConfig,
    maxRetries: 1,
  },
  ...gemmaFallbackChain,
]
```

```ts
// a naive test would hardcode the expected envelope instead of reading it
// from the real entry, so a maxRetries bump wouldn't be caught:
expect(2 * SEEKER_GATEWAY_FETCH_TIMEOUT_MS).toBeLessThan(
  TIME_BUDGET_MS.chatTurn,
)
```

**After (shipped, `apps/mastra/src/mastra/agents/seeker-agent.ts:142-166`):**

```ts
return [
  {
    model: gateway.chat(
      env.AI_GATEWAY_CHAT_MODEL ?? "coding",
    ) as unknown as MastraModelConfig,
    // 0, NOT 1 (deviation from the plan's R1, review-verified): ...
    // the Gemma chain below IS the retry.
    maxRetries: 0,
  },
  ...gemmaFallbackChain,
]
```

```ts
// apps/mastra/src/mastra/agents/seeker-agent.test.ts:216-237
const [gatewayEntry] = buildSeekerModelList()
const worstCaseGatewayMs =
  ((gatewayEntry?.maxRetries ?? 0) + 1) * SEEKER_GATEWAY_FETCH_TIMEOUT_MS
const GEMMA_FALLBACK_ALLOWANCE_MS = 30_000
expect(worstCaseGatewayMs).toBeLessThan(
  TIME_BUDGET_MS.chatTurn - GEMMA_FALLBACK_ALLOWANCE_MS,
)
```

plus the three mechanism tests in `describe("createGatewayFetchWithTimeout (KTD9 abort mechanism)", ...)` (`seeker-agent.test.ts:240-304`) asserting the composed signal's `reason.name === "TimeoutError"` and its `AbortSignal.any` composition with a caller signal — proving the abort actually fires as the class Mastra's retry loop classifies, not just that a number was passed to a constructor.

## Reproducing the two failure modes

Both recipes exercise the guard shape, not any particular model, so they
transfer to any future provider wired through a timeout-wrapping fetch.

**Mid-stream failover concatenation (flush-then-stall mock).** Run a ~40-line
local server on `:8099` that answers `POST /v1/chat/completions` with
`200 text/event-stream`, writes 2–3 chunks like

    data: {"id":"m1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Jesus "}}]}

then stops writing (socket open, never `[DONE]`). Start the runtime with
`MASTRA_STORAGE_BACKEND=memory SEEKER_ROUTE_ENABLED=true
MASTRA_SERVICE_API_KEYS=local-mastra-service-key`, a real
`OPENROUTER_API_KEY`, `AI_GATEWAY_SEEKER_ENABLED=true`,
`AI_GATEWAY_CHAT_API_KEY=anything`, and
`AI_GATEWAY_CHAT_BASE_URL=http://127.0.0.1:8099/v1`. Drive one turn — the
`/forge-seeker` route is service-bearer-gated and requires a
`{ prompt, threadId }` body:

    curl -N -H "Authorization: Bearer local-mastra-service-key" \
      -H "content-type: application/json" \
      -d '{"prompt":"Who is Jesus?","threadId":"stall-smoke-1"}' \
      http://localhost:4111/forge-seeker

Watch whether the terminal reply is `"Jesus <full Gemma answer>"`
concatenated, an error frame, or clean.

**Whole-stream abort on a healthy slow stream (shrink the constant).** Locally
lower `SEEKER_GATEWAY_FETCH_TIMEOUT_MS` (one line; revert after — the suite
still passes, since the invariant test only asserts an upper bound) and run a
real gateway turn. Pick a value above the gateway's observed time-to-first-byte
but below the full answer duration — too small a value fires pre-stream and
demonstrates clean failover instead of the mid-stream abort. Alternatively,
point the mock above at a chunk-every-400ms-for-45s stream.

## Amendment (2026-08-18, feat-366): a caller-threaded `abortSignal` bounds the retry loop — the Rule 1 hazard is attempt-local

This amendment bounds Rule 1; it retracts nothing. Rule 1 holds for a timeout the model
entry itself owns — a custom `fetch`'s own `AbortSignal.timeout`, the KTD9 gateway guard.
That signal is **invisible to the retry loop**: p-retry only ever sees the signal the core
hands it as its `signal:` option, and the core sources that from the CALLER's options,
never from an entry's fetch wrapper. An attempt-local abort therefore throws a plain
non-`APICallError` into `shouldRetry`, falls to `return true`, and multiplies exactly as
Rule 1 describes. `maxRetries: 0` — or retry-aware budgeting — stays mandatory for that
shape.

A deadline threaded as the **caller's own** abort signal —
`agent.generate(prompt, { abortSignal })`, or the same option on `stream()` — does not
carry that hazard. It is the same `signal:` line Rule 1's snippet already quotes; the
implication was simply never drawn. Verified in the installed dist
(`apps/mastra/node_modules/@mastra/core/dist/agent-0y2cApTZ.js:24675-24700`, `@mastra/core`
1.55.0):

```js
const abortSignal = options?.abortSignal // :24681 — the CALLER's option
return await (
  await import("p-retry")
).default(
  async () => {
    return await (
      methodType === "stream" ? model.doStream : model.doGenerate
    ).bind(model)({
      ...toolsAndToolChoice,
      prompt,
      providerOptions,
      abortSignal /* … */, // :24687
    })
  },
  {
    retries: modelSettings?.maxRetries ?? 2,
    signal: abortSignal, // :24695 — AND into p-retry
    shouldRetry(context) {
      /* unchanged — see Rule 1 */
    },
  },
)
```

`options` is the caller's `generate`/`stream` options object, threaded unchanged through
`#execute` (`:36616`, rest-spread) → `createAgenticExecutionWorkflow` (`:27649`) →
`createLLMExecutionStep` (`:25691`) → `execute` (`:24624`). An entry-owned fetch wrapper's
timeout never reaches this option — that is the scope boundary in the other direction.

`p-retry` 7.1.1 (the copy `@mastra/core` resolves, at
`node_modules/.pnpm/p-retry@7.1.1/node_modules/p-retry/index.js`) gates on that signal at
four points: `throwIfAborted` before the attempt loop (`:185`), before and after
**every** attempt (`:195`, `:199`), and around the backoff sleep (`:127`, `:150`) — and the
sleep itself registers an `abort` listener that rejects with `options.signal.reason`
(`:129-148`), so a sleep already in progress does not outlive the deadline. Note
`shouldRetry` runs before those gates: the caller signal does not make the abort
"non-retryable"; it stops the loop around it.

The fallback loop unwinds instead of advancing — by a **bail, not a throw**. The per-entry
callback catches the error and, on `isAbortError(error) && options?.abortSignal?.aborted`,
**returns** `{ callBail: true, … }` (`:26141-26159`); `executeStreamWithFallbackModels`
(`:25665-25690`) treats a resolved callback as done and breaks before the next entry runs.
The guard requires the **caller's** signal to be aborted — which is precisely why an
attempt-local timeout abort does not take this branch and instead advances to the next
entry, exactly as Rule 1's "the fallback chain IS the retry" says. Consequence worth
knowing: on this core an aborted `generate` **resolves** (bail), it does not reject — a
consumer that only catches sees neither.

**Measured, not inferred** (2026-08-18; `@mastra/core` 1.55.0 + `p-retry` 7.1.1, Node
v24.16.0 — a real `Agent` over two mock entries, `maxRetries: 2` each, every attempt
throwing the same `TimeoutError` DOMException a fetch-timeout abort produces):

| caller signal              | entry-1 attempts              | entry-2 attempts                | elapsed  | outcome  |
| -------------------------- | ----------------------------- | ------------------------------- | -------- | -------- |
| none (attempt-local only)  | 3, at t = 33 / 1034 / 3037 ms | 3, at t = 3044 / 4046 / 6050 ms | 6,056 ms | throws   |
| `AbortSignal.timeout(150)` | 1, at t = 3 ms                | **0**                           | 155 ms   | resolves |

Row 1 is Rule 1's hazard measured end to end: `(maxRetries + 1) × entries` provider calls
plus p-retry's 1 s/2 s backoffs. Row 2 is the same error class under a caller-threaded
deadline — one attempt, the backoff sleep cut mid-flight, the second entry never invoked.

**What this shape bounds, and what it does not.** It bounds the attempt COUNT and the
fallback-entry count — the multiplication Rule 1 exists to prevent, which therefore does
not apply. It does **not** by itself bound WALL-CLOCK: `throwIfAborted` is only checked
_between_ attempts, so a single in-flight attempt that ignores its `abortSignal` runs to
its own completion — same harness, one hanging attempt, caller deadline 150 ms:

| provider honors `abortSignal` | entry-1 attempts | entry-2 attempts | elapsed  |
| ----------------------------- | ---------------- | ---------------- | -------- |
| yes                           | 1                | 0                | 159 ms   |
| no                            | 1                | 0                | 5,012 ms |

Real fetch-based providers honor the signal, so the top row is the normal case. The bottom
row is why a caller-side `Promise.race` on the same budget stays the right
belt-and-suspenders wherever the deadline is a product promise rather than a best effort.
`apps/mastra/src/mastra/seeker-follow-ups-generate.ts` is the in-tree consumer of the
bounded shape: it composes its own `AbortSignal.timeout(budget)` with the turn's
already-composed signal via `AbortSignal.any`, passes the result to `agent.generate`, AND
races the same budget through the shared `settleWithinBudget`. The authoritative prose is
the feat-366 plan's "Budget mechanics" Sources bullet and KTD6
(`docs/plans/2026-08-18-0406-feat-seeker-follow-up-questions-plan.md:104`, `:118`; its
"unwinds instantly" phrasing describes the no-further-attempts bound — the wall-clock
carve-out above is the precise form).

Two citation notes. Rule 1's dist quote cites `chunk-AM3IOVFX.js:17915-17945` — that is
the `@mastra/core` 1.36.0-era chunk; at 1.55.0 the same block (its `shouldRetry` shape
unchanged) lives at `agent-0y2cApTZ.js:24675-24700`. On future bumps, relocate dist
citations by symbol (`pRetry`, `shouldRetry`), never by chunk path. And like every dist
fact in this doc, this amendment is version-pinned — **re-verify on `@mastra/*` and
`p-retry` bumps**. The race is what makes not re-verifying survivable.

## Related

- `docs/solutions/conventions/mastra-inline-gateway-construction-createrequire.md` — the inline gateway-construction convention (createRequire shim, `.chat()` pinning, gateway-constants) this timeout wrapper lives inside.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — the general law this refines: this learning adds the "the outbound call also sits inside a retrying framework — check ITS classification logic, don't assume" row for the `fetch`/`AbortSignal.timeout` mechanism.
- `docs/solutions/best-practices/deterministic-mastra-sse-route-testing-stub-model-budget-seam-20260625.md` — the fake-timer fact (`AbortSignal.timeout` schedules outside vitest's fake-timer reach) that forces the mechanism tests here onto tiny real budgets.
- `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md` — sibling application of "test the abort MECHANISM, not just the configured value/return value," on the byte-cap axis instead of the time axis.
- `docs/solutions/integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md` — the seeker model-router chain (`buildSeekerModelList`, OpenRouter Gemma fallback) that this timeout/retry hardening sits on top of.
- `docs/roadmap/ai-chat/feat-237-seeker-gateway-model.md` — the change that surfaced both risks; its Resolution's residual-risk entries track their unverified status (the whole-stream cap was kept for the dogfood trial — revisit toward a TTFB-plus-idle guard only if dogfood shows gateway turns nearing the cap or concatenated replies).
- `docs/plans/2026-08-18-0406-feat-seeker-follow-up-questions-plan.md` — feat-366, the seeker follow-ups generator whose caller-signal deadline produced the 2026-08-18 amendment above; its "Budget mechanics" Sources bullet and KTD6 carry the authoritative verification prose, and `apps/mastra/src/mastra/seeker-follow-ups-generate.ts`'s header comment carries the same hand-verification stamp.
