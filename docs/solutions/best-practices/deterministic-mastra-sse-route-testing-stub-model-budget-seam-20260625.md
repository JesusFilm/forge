---
title: "Deterministically test a memory-keyed Mastra SSE route — stub LanguageModelV3 for the real-memory smoke, budget seam for the timeout branch"
date: 2026-06-25
category: best-practices
problem_type: best_practice
component: mastra-agent-route-testing
root_cause: runtime-only-contracts-and-uninterceptable-timers-resist-mocked-tests
resolution_type: workflow_improvement
severity: medium
module: apps/mastra
tags:
  - testing
  - mastra
  - ai-sdk
  - stub-model
  - abortsignal
  - fake-timers
  - sse
related:
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
  - docs/solutions/best-practices/settle-orphaned-companion-promise-streaming-early-exit-20260625.md
---

## Context

Two facets of a memory-keyed Mastra SSE route (`apps/mastra`'s `/forge-seeker`,
`agents/seeker-route.ts`) resist ordinary mocked / fake-agent unit tests, so they
silently pass green even when broken:

1. **The runtime memory guard + end-to-end recall.** A memory-configured Mastra
   agent throws `AGENT_MEMORY_MISSING_RESOURCE_ID` at runtime if `agent.stream`
   gets a `threadId` without a `resourceId`. That guard lives in compiled
   `@mastra/core` (`chunk-*.js`), **not** the `.d.ts` — `AgentMemoryOption` marks
   `resource?` optional. So `typecheck` and any fake-agent that ignores `memory`
   can't catch a route that threads memory wrong, and can't prove turn-2 actually
   recalls turn-1.
2. **The timeout-reason branch of an `AbortSignal.timeout` budget.** The route
   classifies an error as `timeout` vs `generation_failed` by reading
   `budgetSignal.aborted`, where `budgetSignal = AbortSignal.timeout(budgetMs)`.
   You cannot advance fake time to trip it: **vitest/sinon fake timers do not
   intercept `AbortSignal.timeout`** (verified — after
   `vi.useFakeTimers(); AbortSignal.timeout(1000); await vi.advanceTimersByTimeAsync(1000)`
   the signal's `aborted` is still `false`).

Both need deterministic, network-free coverage or a `@mastra/core` bump (or a
mis-wired memory thread) ships green.

## Guidance

### Part A — real-memory smoke with a hand-stubbed model

Build a **fresh** `Agent` with the real memory and a stub model; route it through
the handler's `getMastra` seam:

- `new Agent({ id, name, instructions, model, tools, memory: getSeekerMemory() })`.
  Use the **real** `getSeekerMemory()` (an `InMemoryStore` — no network, no DB).
- For `model`, use `MockLanguageModelV3` from `ai/test` with a `doStream` that
  returns a **fresh** `simulateReadableStream` per call (streams are single-use,
  so two turns need a function form, not a shared value).
- **Do not** use `@mastra/core` internal model-swap APIs (`Agent.__updateModel`,
  `InnerAgentExecutionOptions.model` — both `@internal`), and **do not** reuse the
  exported singleton agent's hardcoded model (it hits OpenRouter). Build a new
  Agent so the test harness is not coupled to internal surfaces.
- **Fail-loud:** do **not** wrap construction in `try/catch`-skip. If a future
  `@mastra/core`/`ai` shape change breaks the stub, the test must **FAIL**, never
  silently become a no-op — that is the whole point of the smoke.
- Drain the **full** SSE response of turn 1 before starting turn 2 so the
  in-memory save-queue flushes, then assert the model saw turn-1's content on
  turn 2 (recall happened end-to-end through `route → agent.stream({ memory }) →
getSeekerMemory`).

Two `ai@6` / `@ai-sdk/provider@3` gotchas that waste time if unknown:

- **`finishReason` is an object, not a string.** v3
  `LanguageModelV3FinishReason` is `{ unified: "stop" | "length" | …; raw: string
| undefined }`. A bare `finishReason: "stop"` fails typecheck. v3 `usage` is
  also nested: `{ inputTokens: { total, noCache, cacheRead, cacheWrite },
outputTokens: { total, text, reasoning } }`.
- **Don't import the stream-part type from `@ai-sdk/provider` directly** — under
  pnpm several provider versions resolve and a bare import is version-ambiguous.
  **Derive it from the mock's own signature** instead, and pass it as the
  `simulateReadableStream` generic so chunk literals don't widen.

### Part B — budget seam for the timeout branch

Because `AbortSignal.timeout` is uninterceptable by fake timers, expose a small
**injectable budget seam** on the handler input (`budgetMs?: number`, defaulting
to the real `TIME_BUDGET_MS.chatTurn`). Tests pass a tiny value with a fake agent
whose stream errors on abort. The determinism comes from the **abort→error
wiring** — the stub errors synchronously the moment the signal fires — **not**
from real timers being precise: a tiny `budgetMs` (e.g. 5ms) just keeps the test
fast, and even a late fire still classifies as `reason="timeout"`, so the
_outcome_ cannot flake.

Be honest about what the seam costs. Unlike `getEnabled` / `getModelKey` — which
default to real production functions the route actually invokes — `budgetMs` has
**no production caller**; it is only ever overridden in tests. So it is a
testability-driven addition to the handler's public input, not a free
generalization. That is often the right trade, but accept it as one: **bound the
value** (reject `0`/negative so a caller can't brick the route), and weigh the
alternative of injecting the signal/clock itself (a `getBudgetSignal` seam),
which keeps the timeout _policy_ internal while staying interceptable.

## Why This Matters

These are exactly the two facets that `typecheck` + ordinary mocks **cannot**
cover — the concrete Mastra instance of the
[[mocked-shape-vs-real-contract-discipline-20260506]] meta-rule. Without Part A,
a route that drops `resourceId` (or threads the wrong thread key) passes every
fake-agent test and only fails in production under the runtime guard. Without
Part B, the `timeout` classification branch is never executed by any test, so a
regression there is invisible. Both techniques are network-free and run in CI;
the next memory-keyed Mastra route (feat-205 and beyond) needs the same recipe,
and re-deriving the v3 stream shape + the fake-timer limitation from scratch is a
half-day each time.

## When to Apply

- **Part A:** any `apps/mastra` agent route that attaches `Memory` and needs to
  prove the resourceId/threadId contract and recall — not just that the option
  was threaded (a fake-agent assertion), but that the **runtime** accepts it.
- **Part B:** any handler whose error classification depends on an internal
  `AbortSignal.timeout` you cannot reach from the test, when you need the
  timeout-side branch covered deterministically.

## Examples

Stub model factory (fresh single-use stream per call; v3 object shapes):

```ts
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"

const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

// Derive the stream-part type from the mock's own doStream signature — no
// version-ambiguous `@ai-sdk/provider` import.
type DoStreamReturn = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type StreamPart = DoStreamReturn extends { stream: ReadableStream<infer P> }
  ? P
  : never

function mockModel(replyText: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<StreamPart>({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: replyText },
          { type: "text-end", id: "0" },
          // finishReason is an OBJECT in v3, not the string "stop":
          {
            type: "finish",
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: MOCK_USAGE,
          },
        ],
      }),
    }),
  })
}
```

Real-memory recall assertion (turn 2 sees turn 1):

```ts
const model = mockModel("ASSISTANT_REPLY")
const agent = new Agent({
  id: "smoke",
  name: "Smoke",
  instructions: "...",
  model,
  tools: { retrieveAnswer: retrieveAnswerTool },
  memory: getSeekerMemory(),
})
const mastra = { getAgentById: () => agent }

await readSse(
  await handleRequest(
    baseInput(mastra, {
      readJson: async () => ({
        prompt: "MARKER_ALPHA remember this",
        threadId: "t1",
      }),
    }),
  ),
)
await readSse(
  await handleRequest(
    baseInput(mastra, {
      readJson: async () => ({ prompt: "what did I say?", threadId: "t1" }),
    }),
  ),
)
// Recall flowed route → agent.stream({ memory }) → getSeekerMemory:
expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt)).toContain(
  "MARKER_ALPHA",
)
```

Budget seam for the timeout branch (real timers, deterministic):

```ts
// vitest fake timers do NOT trip AbortSignal.timeout, so use a tiny real budget.
const stream = (_p: string, opts: StreamOpts) => ({
  textStream: new ReadableStream<string>({
    start(controller) {
      opts.abortSignal?.addEventListener("abort", () =>
        controller.error(new Error("aborted by budget")),
      )
    },
  }),
  toolResults: Promise.resolve([]),
})
const body = await readSse(
  await handleRequest(baseInput(makeMastra({ stream }), { budgetMs: 5 })),
)
expect(body).toContain('"reason":"timeout"')
```

Note the fixture resolves `toolResults` (`Promise.resolve([])`) on purpose. This
budget test **is** a "drain aborts → companion may reject" interleaving — the
exact shape of [[settle-orphaned-companion-promise-streaming-early-exit-20260625]].
If you make the fixture more realistic by rejecting `toolResults` on abort (the
companion doc notes Mastra commonly rejects it when the run errored), the test
harness itself must apply the companion-settle guard or it reintroduces the
orphaned-rejection hazard inside your own test.
