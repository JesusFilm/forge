import { Agent } from "@mastra/core/agent"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { describe, expect, it, vi } from "vitest"

import type { Memory } from "@mastra/memory"

import { buildAiChatMemory } from "../ai-chat-memory"
import type { AiChatOwnershipMemory } from "../ai-chat-thread-ownership"
import { retrieveAnswerTool } from "../tools/retrieve-answer"

import {
  handleSeekerRouteRequest,
  SEEKER_DEFAULT_RESOURCE_ID,
  type SeekerRouteHandlerInput,
  type SeekerRouteMastra,
} from "./seeker-route"

const SERVICE_KEYS = ["test-service-key"] as const
const AUTH = "Bearer test-service-key"

// --- fake-agent harness -----------------------------------------------------

function textStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

type StreamOpts = {
  maxSteps?: number
  abortSignal?: AbortSignal
  memory?: { thread: string; resource: string }
}
type ToolResultChunk = { payload?: { toolName?: string; result?: unknown } }

type MakeMastraOpts = {
  chunks?: string[]
  toolResults?: ToolResultChunk[]
  toolResultsReject?: boolean
  stream?: (prompt: string, opts: StreamOpts) => unknown
}

function makeMastra(opts: MakeMastraOpts = {}): {
  mastra: SeekerRouteMastra
  streamCalls: Array<{ prompt: string; opts: StreamOpts }>
  agentLookups: string[]
} {
  const streamCalls: Array<{ prompt: string; opts: StreamOpts }> = []
  const agentLookups: string[] = []
  const stream =
    opts.stream ??
    ((prompt: string, o: StreamOpts) => {
      streamCalls.push({ prompt, opts: o })
      return {
        textStream: textStream(opts.chunks ?? []),
        toolResults: opts.toolResultsReject
          ? Promise.reject(new Error("toolResults exploded"))
          : Promise.resolve(opts.toolResults ?? []),
      }
    })
  const mastra: SeekerRouteMastra = {
    getAgentById: (id: string) => {
      agentLookups.push(id)
      return { stream }
    },
  }
  return { mastra, streamCalls, agentLookups }
}

// Permissive ownership fake (feat-208): no existing thread, zero threads for
// the resource → the gate always passes. Gate-specific tests override it.
function permissiveOwnershipMemory(): AiChatOwnershipMemory {
  return {
    getThreadById: async () => null,
    listThreads: async () => ({ total: 0 }),
  }
}

function baseInput(
  mastra: SeekerRouteMastra,
  over: Partial<SeekerRouteHandlerInput> = {},
): SeekerRouteHandlerInput {
  return {
    authHeader: AUTH,
    getServiceKeys: () => SERVICE_KEYS,
    readJson: async () => ({ prompt: "hi", threadId: "thread-1" }),
    getMastra: () => mastra,
    getEnabled: () => true,
    getModelKey: () => "model-key",
    getMemory: permissiveOwnershipMemory,
    ...over,
  }
}

async function readSse(res: Response): Promise<string> {
  return await res.text()
}

// retrieveAnswer tool result fixture, mirroring the tool's
// `{ status, sources }` output shape with the source field set the tool emits.
function retrieveAnswerChunk(
  status: "ok" | "empty" | "unavailable",
  sources: Array<Record<string, unknown>>,
): ToolResultChunk {
  return {
    payload: { toolName: "retrieveAnswer", result: { status, sources } },
  }
}

// ===========================================================================
// Precondition ladder (fake agent)
// ===========================================================================

describe("handleSeekerRouteRequest — precondition ladder", () => {
  it("returns 404 when the route is disabled, never touching bearer/agent (KTD7)", async () => {
    const { mastra, agentLookups } = makeMastra()
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getEnabled: () => false,
        // A bad bearer + bad body would 401/400 if the gate ran second — prove
        // the enable gate short-circuits BEFORE either.
        authHeader: "Bearer wrong",
        readJson: async () => ({}),
      }),
    )
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(agentLookups).toHaveLength(0)
  })

  it("returns 401 without a valid bearer, never invoking the agent (AE1)", async () => {
    const { mastra, agentLookups } = makeMastra()
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, { authHeader: "Bearer wrong" }),
    )
    expect(res.status).toBe(401)
    expect(agentLookups).toHaveLength(0)
  })

  it("returns 400 when threadId is missing (AE2)", async () => {
    const { mastra, agentLookups } = makeMastra()
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, { readJson: async () => ({ prompt: "hi" }) }),
    )
    expect(res.status).toBe(400)
    expect(agentLookups).toHaveLength(0)
  })

  it("returns 400 when prompt is missing", async () => {
    const { mastra } = makeMastra()
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, { readJson: async () => ({ threadId: "t" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for empty-string prompt or threadId", async () => {
    const { mastra } = makeMastra()
    const emptyPrompt = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({ prompt: "", threadId: "t" }),
      }),
    )
    expect(emptyPrompt.status).toBe(400)
    const emptyThread = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({ prompt: "hi", threadId: "" }),
      }),
    )
    expect(emptyThread.status).toBe(400)
  })

  it("returns 400 when resourceId is present but not a string", async () => {
    const { mastra } = makeMastra()
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({ prompt: "hi", threadId: "t", resourceId: 42 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 503 when the model key is missing, never opening a stream (AE6)", async () => {
    const { mastra, agentLookups } = makeMastra({ chunks: ["x"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, { getModelKey: () => undefined }),
    )
    expect(res.status).toBe(503)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = JSON.parse(await res.text()) as { reason?: string }
    expect(body.reason).toBe("model_key_missing")
    expect(agentLookups).toHaveLength(0)
  })
})

// ===========================================================================
// Memory keying (fake agent — proves the route THREADS the option)
// ===========================================================================

describe("handleSeekerRouteRequest — memory keying", () => {
  it("supplies the constant default resource when no resourceId is given (AE3b)", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["ok"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({ prompt: "hi", threadId: "thread-A" }),
      }),
    )
    await readSse(res)
    expect(streamCalls).toHaveLength(1)
    // The dogfood fallback is a non-`user:` resource, so titling is disabled
    // per-call (feat-241/KTD12).
    expect(streamCalls[0].opts.memory).toEqual({
      thread: "thread-A",
      resource: SEEKER_DEFAULT_RESOURCE_ID,
      options: { generateTitle: false },
    })
  })

  it("passes a provided resourceId straight through as the partition key (R8)", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["ok"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({
          prompt: "hi",
          threadId: "thread-A",
          // Deliberately NOT `user:`-prefixed — an opaque caller-chosen id.
          resourceId: "user-123",
        }),
      }),
    )
    await readSse(res)
    // The resource value is never validated or rewritten; the ONLY prefix
    // branch is the sanctioned feat-241 titling scope (options), never the
    // partition key itself.
    expect(streamCalls[0].opts.memory).toEqual({
      thread: "thread-A",
      resource: "user-123",
      options: { generateTitle: false },
    })
  })

  it("keeps titling enabled (no per-call override) for a user: resource (KTD12)", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["ok"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({
          prompt: "hi",
          threadId: "thread-A",
          resourceId: "user:sub-42",
        }),
      }),
    )
    await readSse(res)
    // No options key at all — the Memory-level generateTitle config applies.
    expect(streamCalls[0].opts.memory).toEqual({
      thread: "thread-A",
      resource: "user:sub-42",
    })
  })

  it("normalizes an empty-string resourceId to the default (R8: not rejected)", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["ok"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({
          prompt: "hi",
          threadId: "thread-A",
          resourceId: "",
        }),
      }),
    )
    expect(res.status).toBe(200)
    await readSse(res)
    expect(streamCalls[0].opts.memory).toEqual({
      thread: "thread-A",
      resource: SEEKER_DEFAULT_RESOURCE_ID,
      options: { generateTitle: false },
    })
  })

  it("threads distinct threadIds without cross-session bleed (AE3)", async () => {
    // Fake agent backed by a shared keyed map: it records the threadId it saw
    // and, on each call, reports which threads it has seen so far. Thread B's
    // call must carry its OWN thread key, never thread A's.
    const seenByThread = new Map<string, string>()
    const stream = (_prompt: string, opts: StreamOpts) => {
      const thread = opts.memory?.thread ?? "?"
      seenByThread.set(thread, thread)
      return {
        textStream: textStream([`saw:${thread}`]),
        toolResults: Promise.resolve([] as ToolResultChunk[]),
      }
    }
    const { mastra } = makeMastra({ stream })

    const resA = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({ prompt: "a", threadId: "thread-A" }),
      }),
    )
    const bodyA = await readSse(resA)
    const resB = await handleSeekerRouteRequest(
      baseInput(mastra, {
        readJson: async () => ({ prompt: "b", threadId: "thread-B" }),
      }),
    )
    const bodyB = await readSse(resB)

    expect(bodyA).toContain("saw:thread-A")
    expect(bodyB).toContain("saw:thread-B")
    expect(bodyB).not.toContain("saw:thread-A")
  })
})

// ===========================================================================
// Streaming + sources (fake agent)
// ===========================================================================

describe("handleSeekerRouteRequest — streaming + sources", () => {
  it("streams token_delta frames then one grounded result with projected sources (AE4)", async () => {
    const { mastra } = makeMastra({
      chunks: ["Hel", "lo"],
      toolResults: [
        retrieveAnswerChunk("ok", [
          {
            text: "passage one",
            sourceName: "John 3:16",
            title: "The Gospel of John",
            url: "https://example.org/john",
            score: 0.9,
            // internal field the route must NOT pass through (KTD4)
            chunkId: "secret-internal-id",
          },
          {
            text: "passage two",
            sourceName: "Romans 5:8",
            title: null,
            url: "https://example.org/romans",
            score: 0.8,
          },
        ]),
      ],
    })
    const res = await handleSeekerRouteRequest(baseInput(mastra))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const body = await readSse(res)

    expect(body).toContain('event: token_delta\ndata: {"text":"Hel"}')
    expect(body).toContain('event: token_delta\ndata: {"text":"lo"}')

    // Exactly one result frame; parse its JSON to assert structure precisely.
    const resultMatch = body.match(/event: result\ndata: (.+)\n\n/)
    expect(resultMatch).not.toBeNull()
    const result = JSON.parse(resultMatch![1]) as {
      text: string
      grounded: boolean
      producedBy: string
      sources: Array<Record<string, unknown>>
    }
    expect(result.text).toBe("Hello")
    expect(result.grounded).toBe(true)
    expect(result.producedBy).toBe("seekerAgent")
    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toEqual({
      sourceName: "John 3:16",
      title: "The Gospel of John",
      url: "https://example.org/john",
      score: 0.9,
      snippet: "passage one",
    })
    // Internal field stripped by the allowlist projection (KTD4).
    expect(result.sources[0]).not.toHaveProperty("chunkId")
    expect(result.sources[1].title).toBeNull()
  })

  it("reports grounded:false and empty sources when retrieval returned empty", async () => {
    const { mastra } = makeMastra({
      chunks: ["no grounded answer"],
      toolResults: [retrieveAnswerChunk("empty", [])],
    })
    const res = await handleSeekerRouteRequest(baseInput(mastra))
    const body = await readSse(res)
    const result = JSON.parse(body.match(/event: result\ndata: (.+)\n\n/)![1])
    expect(result.sources).toEqual([])
    expect(result.grounded).toBe(false)
  })

  it("uses the LAST retrieveAnswer chunk when multiple are present", async () => {
    // Guards the documented "LAST wins" extraction: with two retrieveAnswer
    // results in one turn, only the final one's sources/status reach the wire.
    // A FIRST-wins regression would pass every single-chunk test but fail here.
    const { mastra } = makeMastra({
      chunks: ["answer"],
      toolResults: [
        retrieveAnswerChunk("empty", []),
        retrieveAnswerChunk("ok", [
          {
            text: "final passage",
            sourceName: "Final Source",
            title: null,
            url: "https://example.org/final",
            score: 0.7,
          },
        ]),
      ],
    })
    const res = await handleSeekerRouteRequest(baseInput(mastra))
    const body = await readSse(res)
    const result = JSON.parse(body.match(/event: result\ndata: (.+)\n\n/)![1])
    expect(result.grounded).toBe(true)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].sourceName).toBe("Final Source")
  })

  it("reports grounded:false when no retrieveAnswer tool result is present", async () => {
    const { mastra } = makeMastra({
      chunks: ["answered from memory"],
      toolResults: [{ payload: { toolName: "someOtherTool", result: {} } }],
    })
    const res = await handleSeekerRouteRequest(baseInput(mastra))
    const body = await readSse(res)
    const result = JSON.parse(body.match(/event: result\ndata: (.+)\n\n/)![1])
    expect(result.sources).toEqual([])
    expect(result.grounded).toBe(false)
  })

  it("still emits a result (not an error) when toolResults rejects after a good drain", async () => {
    const { mastra } = makeMastra({
      chunks: ["full answer"],
      toolResultsReject: true,
    })
    const res = await handleSeekerRouteRequest(baseInput(mastra))
    const body = await readSse(res)
    expect(body).not.toContain("event: error")
    const result = JSON.parse(body.match(/event: result\ndata: (.+)\n\n/)![1])
    expect(result.text).toBe("full answer")
    expect(result.sources).toEqual([])
    expect(result.grounded).toBe(false)
  })

  it("cancels the agent textStream when the caller disconnects (AE5)", async () => {
    let innerCancelled = false
    const innerStream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("partial")
      },
      // Block forever after the first chunk so the route's read loop suspends.
      pull() {
        return new Promise<void>(() => {})
      },
      cancel() {
        innerCancelled = true
      },
    })
    const mastra: SeekerRouteMastra = {
      getAgentById: () => ({
        stream: () => ({
          textStream: innerStream,
          toolResults: Promise.resolve([] as ToolResultChunk[]),
        }),
      }),
    }
    const res = await handleSeekerRouteRequest(baseInput(mastra))
    const reader = res.body!.getReader()
    await reader.read() // consume the first token_delta frame
    await reader.cancel() // downstream disconnect → route cancel() → inner cancel
    expect(innerCancelled).toBe(true)
  })

  it("does not throw an unhandled rejection when the consumer disconnects before the terminal frame", async () => {
    // The route reaches its terminal `result` enqueue (and finally close) on a
    // controller the consumer already closed. The `closed` guard must turn both
    // into no-ops; without it, the enqueue throws from inside start() and can
    // surface as an unhandled rejection.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let pulls = 0
    const innerStream = new ReadableStream<string>({
      async pull(controller) {
        pulls += 1
        if (pulls === 1) {
          controller.enqueue("partial")
          return
        }
        await gate // suspend until the test releases, after the consumer cancels
        controller.close() // end the stream → route proceeds to the terminal enqueue
      },
    })
    const mastra: SeekerRouteMastra = {
      getAgentById: () => ({
        stream: () => ({
          textStream: innerStream,
          toolResults: Promise.resolve([] as ToolResultChunk[]),
        }),
      }),
    }
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on("unhandledRejection", onRejection)
    try {
      const res = await handleSeekerRouteRequest(baseInput(mastra))
      const reader = res.body!.getReader()
      await reader.read() // consume the token_delta frame
      await reader.cancel() // consumer disconnects → controller closed, `closed`=true
      release() // let the route run to its terminal enqueue on the closed controller
      // Flush microtasks + a macrotask so any unhandled rejection would surface.
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off("unhandledRejection", onRejection)
    }
    expect(rejections).toEqual([])
  })

  it("emits error reason=generation_failed when the stream throws (no budget abort)", async () => {
    const { mastra } = makeMastra({
      stream: () => {
        throw new Error("provider exploded")
      },
    })
    const res = await handleSeekerRouteRequest(baseInput(mastra))
    expect(res.status).toBe(200)
    const body = await readSse(res)
    expect(body).toContain("event: error")
    expect(body).toContain('"reason":"generation_failed"')
    // R12: no raw exception text on the wire.
    expect(body).not.toContain("provider exploded")
    expect(body).not.toContain("message")
  })

  it("settles a rejected toolResults when the textStream drain throws (no unhandled rejection)", async () => {
    // Mid-stream failure: the textStream errors mid-drain AND toolResults rejects.
    // The drain throw jumps to the outer catch BEFORE the inner `await
    // output.toolResults`, so the route must settle that orphaned promise itself
    // — otherwise its rejection escapes as an unhandled rejection (there is no
    // global handler in the runtime). Without the fix this test fails; with it,
    // the rejection is swallowed and an `error` frame is still emitted.
    const stream = () => ({
      textStream: new ReadableStream<string>({
        start(controller) {
          controller.enqueue("partial")
          controller.error(new Error("stream blew up mid-drain"))
        },
      }),
      // No `.catch` pre-attached — the route owns settling it.
      toolResults: Promise.reject(new Error("toolResults exploded late")),
    })
    const { mastra } = makeMastra({ stream })

    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on("unhandledRejection", onRejection)
    try {
      const res = await handleSeekerRouteRequest(baseInput(mastra))
      const body = await readSse(res)
      expect(body).toContain("event: error")
      expect(body).toContain('"reason":"generation_failed"')
      // Flush microtasks + a macrotask so any unhandled rejection would surface.
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off("unhandledRejection", onRejection)
    }
    expect(rejections).toEqual([])
  })

  it("emits error reason=timeout when the budget aborts the stream", async () => {
    // Tiny budget + a stream that errors on abort → deterministic timeout
    // branch without faking AbortSignal.timeout.
    const stream = (_prompt: string, opts: StreamOpts) => ({
      textStream: new ReadableStream<string>({
        start(controller) {
          opts.abortSignal?.addEventListener("abort", () =>
            controller.error(new Error("aborted by budget")),
          )
        },
      }),
      toolResults: Promise.resolve([] as ToolResultChunk[]),
    })
    const { mastra } = makeMastra({ stream })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, { budgetMs: 5 }),
    )
    const body = await readSse(res)
    expect(body).toContain("event: error")
    expect(body).toContain('"reason":"timeout"')
    expect(body).not.toContain("message")
  })
})

// ===========================================================================
// Real-memory smoke (fresh Agent + real getSeekerMemory + stub model)
//
// Exercises the SAME runtime memory-prep guard (AGENT_MEMORY_MISSING_RESOURCE_ID
// + thread get-or-create) and recall path the exported seekerAgent would, with
// NO network: a stub MastraLanguageModel (MockLanguageModelV3) yields a fixed
// text stream. This is the only test that proves the runtime contract typecheck
// + fake-agent tests cannot. Fail-loud: if the stub model cannot be installed
// (a future @mastra/core shape change), construction throws and the test FAILS
// — it never skips.
// ===========================================================================

const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

// Derive the V3 stream-part type from the mock's own doStream signature so the
// chunk literals below don't widen — keeps the test free of any direct
// `@ai-sdk/provider` import (and its version-resolution ambiguity).
type SmokeDoStreamReturn = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type SmokeStreamPart = SmokeDoStreamReturn extends {
  stream: ReadableStream<infer P>
}
  ? P
  : never

function mockModel(replyText: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    // Function form so each turn gets a FRESH (single-use) stream.
    doStream: async () => ({
      stream: simulateReadableStream<SmokeStreamPart>({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: replyText },
          { type: "text-end", id: "0" },
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

// Fresh, isolated ai-chat Memory on the in-memory backend — one per test so
// no thread state leaks across cases. Also handed to the route's ownership
// gate so gate + agent write path share one store (the production wiring).
function buildSmokeMemory(): Memory {
  return buildAiChatMemory({ getBackend: () => "memory" })
}

function buildSmokeAgent(model: MockLanguageModelV3, memory: Memory): Agent {
  return new Agent({
    id: "seeker-smoke",
    name: "Seeker Smoke",
    instructions: "You are a test stand-in for the seeker agent.",
    // MockLanguageModelV3 implements the @ai-sdk/provider LanguageModelV3 that
    // Mastra's MastraModelConfig accepts directly.
    model,
    tools: { retrieveAnswer: retrieveAnswerTool },
    memory,
  })
}

describe("handleSeekerRouteRequest — real-memory smoke", () => {
  it("does NOT throw AGENT_MEMORY_MISSING_RESOURCE_ID when no resourceId is given (AE3b contract)", async () => {
    const memory = buildSmokeMemory()
    const agent = buildSmokeAgent(
      mockModel("A grounded-sounding reply."),
      memory,
    )
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }

    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => memory as unknown as AiChatOwnershipMemory,
        readJson: async () => ({
          prompt: "Who is Jesus?",
          threadId: "smoke-thread-1",
        }),
      }),
    )
    const body = await readSse(res)
    // The constant-default resourceId satisfied the runtime guard: a result
    // frame streamed and no error frame was emitted.
    expect(body).toContain("event: result")
    expect(body).not.toContain("event: error")
  })

  it("recalls turn-1 content on turn-2 of the same thread (AE3c)", async () => {
    const memory = buildSmokeMemory()
    const model = mockModel("ASSISTANT_REPLY_BETA")
    const agent = buildSmokeAgent(model, memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }
    const getMemory = () => memory as unknown as AiChatOwnershipMemory

    // Turn 1 — carries a unique marker in the user prompt.
    const res1 = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory,
        readJson: async () => ({
          prompt: "MARKER_ALPHA_UNIQUE please remember this",
          threadId: "smoke-recall-thread",
        }),
      }),
    )
    await readSse(res1)

    // Turn 2 — same thread, different prompt. Turn 2 also exercises the
    // ownership gate's existing-thread branch against the REAL memory (turn 1
    // created the thread under the default resource).
    const res2 = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory,
        readJson: async () => ({
          prompt: "what did I just say?",
          threadId: "smoke-recall-thread",
        }),
      }),
    )
    await readSse(res2)

    // The model saw at least two calls; turn-2's assembled prompt must include
    // turn-1's marker — proving recall flowed route → agent.stream({ memory })
    // → the ai-chat Memory end-to-end.
    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(2)
    const turn2Prompt = JSON.stringify(model.doStreamCalls[1].prompt)
    expect(turn2Prompt).toContain("MARKER_ALPHA_UNIQUE")
  })

  it("rejects turn-2 with thread_forbidden when a different resource replays the threadId (feat-208)", async () => {
    const memory = buildSmokeMemory()
    const model = mockModel("ASSISTANT_REPLY_GAMMA")
    const agent = buildSmokeAgent(model, memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }
    const getMemory = () => memory as unknown as AiChatOwnershipMemory

    // Turn 1 creates the thread under resource "user:alice".
    await readSse(
      await handleSeekerRouteRequest(
        baseInput(mastra, {
          getMemory,
          readJson: async () => ({
            prompt: "hello",
            threadId: "smoke-owned-thread",
            resourceId: "user:alice",
          }),
        }),
      ),
    )
    const callsAfterTurn1 = model.doStreamCalls.length

    // Turn 2 replays the same threadId as a different resource. Mastra itself
    // would silently adopt the thread — the route's gate must refuse.
    const res2 = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory,
        readJson: async () => ({
          prompt: "and what did alice say?",
          threadId: "smoke-owned-thread",
          resourceId: "anon:intruder",
        }),
      }),
    )
    const body2 = await readSse(res2)
    expect(body2).toContain("event: error")
    expect(body2).toContain('"reason":"thread_forbidden"')
    expect(body2).not.toContain("event: result")
    // The agent never streamed for the rejected turn.
    expect(model.doStreamCalls.length).toBe(callsAfterTurn1)
  })
})

// ===========================================================================
// Thread ownership + ceiling gate (feat-208, fake agent + fake memory)
// ===========================================================================

describe("handleSeekerRouteRequest — thread ownership gate", () => {
  it("emits thread_forbidden and never calls agent.stream when the thread has a different owner", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["never"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => ({
          getThreadById: async () => ({ resourceId: "user:someone-else" }),
          listThreads: async () => ({ total: 0 }),
        }),
        readJson: async () => ({
          prompt: "hi",
          threadId: "stolen-thread",
          resourceId: "anon:attacker",
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain('"reason":"thread_forbidden"')
    expect(body).not.toContain("event: result")
    expect(streamCalls).toHaveLength(0)
  })

  it("emits thread_limit when a NEW thread would exceed the per-resource ceiling", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["never"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => ({
          getThreadById: async () => null,
          listThreads: async () => ({ total: 200 }),
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain('"reason":"thread_limit"')
    expect(streamCalls).toHaveLength(0)
  })

  it("streams normally when the caller owns the existing thread", async () => {
    const { mastra } = makeMastra({ chunks: ["hello"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => ({
          getThreadById: async () => ({
            resourceId: SEEKER_DEFAULT_RESOURCE_ID,
          }),
          listThreads: async () => ({ total: 9999 }),
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain("event: result")
    expect(body).not.toContain("event: error")
  })

  it("fails closed as generation_failed when the ownership check itself throws", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["never"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => ({
          getThreadById: async () => {
            throw new Error("store unavailable")
          },
          listThreads: async () => ({ total: 0 }),
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain('"reason":"generation_failed"')
    expect(body).not.toContain("event: result")
    expect(streamCalls).toHaveLength(0)
  })

  it("bounds a never-settling ownership gate by the turn budget (feat-208 #1)", async () => {
    // A slow-but-not-down Postgres: the gate's store call never resolves. Before
    // the fix it would hang the SSE stream past the ceiling with no frame; now
    // the budget signal trips it and the outer catch emits a timeout frame.
    const { mastra, streamCalls } = makeMastra({ chunks: ["never"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        budgetMs: 20,
        getMemory: () => ({
          getThreadById: () =>
            new Promise<{ resourceId?: string | null } | null>(() => {}),
          listThreads: async () => ({ total: 0 }),
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain('"reason":"timeout"')
    expect(body).not.toContain("event: result")
    // The gate is bounded BEFORE agent.stream, so the agent never runs.
    expect(streamCalls).toHaveLength(0)
  })
})

// ===========================================================================
// Title generation (feat-241, KTD12) — verified against the REAL Memory
// surface (Execution note): the deprecated-key trap and the fire-and-forget
// titling path only exist in the dist, so mocks would prove nothing here.
// ===========================================================================

type TitleGenerateResult = Awaited<
  ReturnType<MockLanguageModelV3["doGenerate"]>
>

function titleGenerateResult(text: string): TitleGenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: MOCK_USAGE,
    warnings: [],
  }
}

// Mock title model covering both invocation styles (generate + stream), with
// hang/reject behaviors for the no-delay and benign-failure branches.
function mockTitleModel(behavior: {
  title?: string
  reject?: boolean
  hang?: boolean
}): MockLanguageModelV3 {
  const title = behavior.title ?? "Generated Title"
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (behavior.hang) return await new Promise<never>(() => {})
      if (behavior.reject) throw new Error("title model exploded")
      return titleGenerateResult(title)
    },
    doStream: async () => {
      if (behavior.hang) return await new Promise<never>(() => {})
      if (behavior.reject) throw new Error("title model exploded")
      return {
        stream: simulateReadableStream<SmokeStreamPart>({
          initialDelayInMs: null,
          chunkDelayInMs: null,
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: title },
            { type: "text-end", id: "0" },
            {
              type: "finish",
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage: MOCK_USAGE,
            },
          ],
        }),
      }
    },
  })
}

function titleModelCallCount(model: MockLanguageModelV3): number {
  return model.doGenerateCalls.length + model.doStreamCalls.length
}

describe("handleSeekerRouteRequest — title generation (feat-241, KTD12)", () => {
  it("titles a user: thread after the turn, without failing or delaying it (AE12)", async () => {
    const titleModel = mockTitleModel({ title: "A Concise Title" })
    const memory = buildAiChatMemory({ getBackend: () => "memory", titleModel })
    const agent = buildSmokeAgent(mockModel("a reply"), memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }

    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => memory as unknown as AiChatOwnershipMemory,
        readJson: async () => ({
          prompt: "What does John 3:16 mean?",
          threadId: "title-thread-1",
          resourceId: "user:title-sub",
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain("event: result")
    expect(body).not.toContain("event: error")

    // Fire-and-forget: the title lands AFTER the turn settles. Exact-match so
    // a default/placeholder store title can't satisfy this vacuously.
    await vi.waitFor(async () => {
      const thread = await memory.getThreadById({ threadId: "title-thread-1" })
      expect(thread?.title).toBe("A Concise Title")
    })
  })

  it("completes the turn even when the title model hangs (titling never delays)", async () => {
    const titleModel = mockTitleModel({ hang: true })
    const memory = buildAiChatMemory({ getBackend: () => "memory", titleModel })
    const agent = buildSmokeAgent(mockModel("a reply"), memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }

    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => memory as unknown as AiChatOwnershipMemory,
        readJson: async () => ({
          prompt: "hi",
          threadId: "title-hang-thread",
          resourceId: "user:title-sub",
        }),
      }),
    )
    // The terminal frame arrives while the title call is still pending — the
    // turn never waits on titling.
    const body = await readSse(res)
    expect(body).toContain("event: result")
  })

  it("keeps the turn successful and the title empty when the title model fails (AE12)", async () => {
    const titleModel = mockTitleModel({ reject: true })
    const memory = buildAiChatMemory({ getBackend: () => "memory", titleModel })
    const agent = buildSmokeAgent(mockModel("a reply"), memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }

    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => memory as unknown as AiChatOwnershipMemory,
        readJson: async () => ({
          prompt: "hi",
          threadId: "title-fail-thread",
          resourceId: "user:title-sub",
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain("event: result")
    expect(body).not.toContain("event: error")

    // Let the fire-and-forget failure settle, then confirm the untitled
    // sentinel: the stored title stays empty (retried on the next turn).
    await vi.waitFor(() =>
      expect(titleModelCallCount(titleModel)).toBeGreaterThan(0),
    )
    await new Promise((resolve) => setTimeout(resolve, 25))
    const thread = await memory.getThreadById({ threadId: "title-fail-thread" })
    expect(thread?.title ?? "").toBe("")
  })

  it("does not re-title a thread that already has a non-empty title", async () => {
    const titleModel = mockTitleModel({ title: "Clobbered" })
    const memory = buildAiChatMemory({ getBackend: () => "memory", titleModel })
    const now = new Date()
    await memory.saveThread({
      thread: {
        id: "pre-titled-thread",
        resourceId: "user:title-sub",
        title: "Existing Title",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })
    const agent = buildSmokeAgent(mockModel("a reply"), memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }

    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => memory as unknown as AiChatOwnershipMemory,
        readJson: async () => ({
          prompt: "hi again",
          threadId: "pre-titled-thread",
          resourceId: "user:title-sub",
        }),
      }),
    )
    await readSse(res)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(titleModelCallCount(titleModel)).toBe(0)
    const thread = await memory.getThreadById({ threadId: "pre-titled-thread" })
    expect(thread?.title).toBe("Existing Title")
  })

  it("attempts no titling for a non-user: resource (per-call override, R10)", async () => {
    const titleModel = mockTitleModel({ title: "Should Never Appear" })
    const memory = buildAiChatMemory({ getBackend: () => "memory", titleModel })
    const agent = buildSmokeAgent(mockModel("a reply"), memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }

    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => memory as unknown as AiChatOwnershipMemory,
        readJson: async () => ({
          prompt: "hi",
          threadId: "anon-title-thread",
          resourceId: "anon:3f9a2b10-9c1c-4b5f-a2d5-0e7c66666666",
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain("event: result")
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(titleModelCallCount(titleModel)).toBe(0)
    const thread = await memory.getThreadById({ threadId: "anon-title-thread" })
    expect(thread?.title ?? "").toBe("")
  })

  it("boots and serves an ordinary turn on the DEFAULT title config (deprecated-key trap pin)", async () => {
    // The default config carries the model-router string. If the deprecated
    // `threads.generateTitle` nesting were used instead of the top-level key,
    // the first merged-config read would throw MID-TURN — this turn (which
    // passes per-call options, forcing the merge) would emit an error frame.
    const memory = buildAiChatMemory({ getBackend: () => "memory" })
    const agent = buildSmokeAgent(mockModel("plain reply"), memory)
    const mastra: SeekerRouteMastra = { getAgentById: () => agent }

    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        getMemory: () => memory as unknown as AiChatOwnershipMemory,
        readJson: async () => ({
          prompt: "hi",
          threadId: "default-config-thread",
        }),
      }),
    )
    const body = await readSse(res)
    expect(body).toContain("event: result")
    expect(body).not.toContain("event: error")
  })
})

// --- feat-250: /forge-seeker lane-key bearer -------------------------------

// The route's allowlist is the ai-chat lane CSV only (the admission module's
// default source, feat-283 — the registration in index.ts passes no keys);
// these pin the handler's accept/reject behavior for a lane-shaped list. The
// DEFAULT sourcing path itself is pinned by the discriminating key-source
// test in ai-chat-lane-admission.test.ts.
describe("lane-key bearer (feat-250)", () => {
  it("a lane key in the allowlist authorizes the route", async () => {
    const { mastra } = makeMastra({ chunks: ["ok"] })
    const res = await handleSeekerRouteRequest(
      baseInput(mastra, {
        authHeader: "Bearer lane-key",
        getServiceKeys: () => ["lane-key"],
      }),
    )
    expect(res.status).toBe(200)
  })

  it("a shared-pool key is rejected (401) against the lane-only allowlist", async () => {
    const { mastra } = makeMastra()
    const res = await handleSeekerRouteRequest(
      // AUTH presents the pool-style key; the lane-only allowlist rejects it.
      baseInput(mastra, { getServiceKeys: () => ["lane-key"] }),
    )
    expect(res.status).toBe(401)
  })
})
