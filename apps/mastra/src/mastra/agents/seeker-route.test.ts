import { readFileSync } from "node:fs"

import { Agent } from "@mastra/core/agent"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { describe, expect, it, vi } from "vitest"

import type { RequestContext } from "@mastra/core/di"
import type { Memory } from "@mastra/memory"

import { buildAiChatMemory } from "../ai-chat-memory"
import type { AiChatOwnershipMemory } from "../ai-chat-thread-ownership"
import {
  LANGFUSE_SEEKER_TRACING_MARKER,
  TRACING_CONFIG_CONTEXT_KEY,
} from "../langfuse-tracing"
import type { ManagedPromptResult } from "../../services/langfuse-prompt-client"
import { retrieveAnswerTool } from "../tools/retrieve-answer"
import { FEATURE_VIDEO_TOOL_NAME } from "../tools/feature-video"
import { SEEKER_SEARCH_VIDEOS_TOOL_NAME } from "../tools/seeker-search-videos"

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
  requestContext?: RequestContext
  tracingOptions?: { metadata?: Record<string, unknown> }
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
// Langfuse tracing stamp (feat-321)
// ===========================================================================

describe("handleSeekerRouteRequest — Langfuse tracing stamp (feat-321)", () => {
  function langfuseProvenance(
    overrides: Partial<ManagedPromptResult> = {},
  ): ManagedPromptResult {
    return {
      text: "prompt",
      source: "langfuse",
      version: 7,
      resolvedLabel: "production",
      ...overrides,
    }
  }

  it("stamps the per-process tracing marker and base metadata on every send (no seam — default-source pin)", async () => {
    // Deliberately NO getPromptProvenance override: the default must be the
    // REAL getManagedPrompt, which in the unconfigured test env serves the
    // compiled-in fallback (source "fallback", label "production", no
    // version). A revert of the seam's default source cannot stay green.
    const { mastra, streamCalls } = makeMastra({ chunks: ["ok"] })
    await readSse(await handleSeekerRouteRequest(baseInput(mastra)))

    expect(streamCalls).toHaveLength(1)
    const opts = streamCalls[0].opts
    expect(opts.requestContext?.get(TRACING_CONFIG_CONTEXT_KEY)).toBe(
      LANGFUSE_SEEKER_TRACING_MARKER,
    )
    expect(opts.tracingOptions?.metadata).toMatchObject({
      traceName: "seeker-turn",
      userId: SEEKER_DEFAULT_RESOURCE_ID,
      sessionId: "thread-1",
      promptName: "seeker-system",
      promptSource: "fallback",
      promptLabel: "production",
    })
    expect(opts.tracingOptions?.metadata).not.toHaveProperty("promptVersion")
    expect(opts.tracingOptions?.metadata).not.toHaveProperty("langfuse")
  })

  it("stamps version metadata and native prompt linkage for a versioned langfuse serve", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["ok"] })
    await readSse(
      await handleSeekerRouteRequest(
        baseInput(mastra, {
          readJson: async () => ({
            prompt: "hi",
            threadId: "thread-9",
            resourceId: "user:alice",
          }),
          getPromptProvenance: async () => langfuseProvenance(),
        }),
      ),
    )

    expect(streamCalls[0].opts.tracingOptions?.metadata).toMatchObject({
      userId: "user:alice",
      sessionId: "thread-9",
      promptSource: "langfuse",
      promptVersion: 7,
      langfuse: { prompt: { name: "seeker-system", version: 7 } },
    })
  })

  it("marks stale serves in the trace metadata", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["ok"] })
    await readSse(
      await handleSeekerRouteRequest(
        baseInput(mastra, {
          getPromptProvenance: async () => langfuseProvenance({ stale: true }),
        }),
      ),
    )

    expect(streamCalls[0].opts.tracingOptions?.metadata).toMatchObject({
      promptStale: true,
    })
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

// ===========================================================================
// feat-327 — declared-video resolution + wire projection (plan D4/D9/P3)
// ===========================================================================

/**
 * The model DECLARES; it never authors. Everything below exercises the route's
 * side of that contract over UNTRUSTED tool payloads: only an id present in
 * this turn's own searchVideos results, whose row survives every pattern gate,
 * reaches the wire — and every failure attaches nothing rather than producing
 * an error frame.
 */

type VideoRow = {
  videoId: string
  title: string
  snippet: string
  slug: string
  playbackId: string
  durationSeconds: number | null
  languageSlug: string | null
  availability: { kind: string }
}

function videoRow(over: Partial<VideoRow> & { videoId: string }): VideoRow {
  return {
    title: `Title ${over.videoId}`,
    snippet: `Snippet ${over.videoId}`,
    slug: `slug-${over.videoId}`,
    playbackId: `playback${over.videoId}xyz`,
    durationSeconds: 372,
    languageSlug: "english",
    availability: { kind: "target_audio" },
    ...over,
  }
}

function searchVideosChunk(videos: unknown[]): ToolResultChunk {
  // Built from the tool module's own constant, so a rename cannot leave the
  // fixtures and the route agreeing on a stale literal.
  return {
    payload: { toolName: SEEKER_SEARCH_VIDEOS_TOOL_NAME, result: { videos } },
  }
}

function featureVideoChunk(result: unknown): ToolResultChunk {
  return { payload: { toolName: FEATURE_VIDEO_TOOL_NAME, result } }
}

async function resultFrame(
  toolResults: ToolResultChunk[],
): Promise<Record<string, unknown>> {
  const { mastra } = makeMastra({ chunks: ["reply"], toolResults })
  const res = await handleSeekerRouteRequest(baseInput(mastra))
  const body = await readSse(res)
  expect(body).not.toContain("event: error")
  return JSON.parse(body.match(/event: result\ndata: (.+)\n\n/)![1]) as Record<
    string,
    unknown
  >
}

describe("handleSeekerRouteRequest — declared video (feat-327)", () => {
  it("attaches the declared video with EXACTLY the six wire fields", async () => {
    const result = await resultFrame([
      searchVideosChunk([videoRow({ videoId: "v1" })]),
      featureVideoChunk({ videoId: "v1" }),
    ])

    // toStrictEqual, not toMatchObject: an extra field on this payload is a
    // leak, not a bonus. `snippet` and `availability` are deliberately absent —
    // they exist on the tool row for the model and the re-assert, and stop
    // there. No URL field exists on the wire at all (plan D9): chat builds the
    // watch URL client-side from the validated slugs.
    expect(result.video).toStrictEqual({
      videoId: "v1",
      title: "Title v1",
      slug: "slug-v1",
      playbackId: "playbackv1xyz",
      durationSeconds: 372,
      languageSlug: "english",
    })
    // The video rides ALONGSIDE the existing terminal-frame contract.
    expect(result.text).toBe("reply")
    expect(result.producedBy).toBe("seekerAgent")
  })

  it("omits `video` entirely — never null — when nothing was declared", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = await resultFrame([
        searchVideosChunk([videoRow({ videoId: "v1" })]),
      ])
      // `in` rather than a null check: the wire field must be ABSENT so the
      // chat client's optional-field parse never sees an explicit null.
      expect("video" in result).toBe(false)
      // Searching without featuring is the normal case, not a fault: no
      // declaration-failure line. (The E7 retrieveAnswer-skip signal DOES fire
      // here — this turn searched and never grounded — and has its own tests.)
      for (const call of warn.mock.calls) {
        expect(String(call[0])).not.toContain(
          "video_feature_invalid_declaration",
        )
      }
    } finally {
      warn.mockRestore()
    }
  })

  it("carries no `video` on a turn with no video tool results at all (the flag-off shape)", async () => {
    // With SEEKER_VIDEO_ENABLED off the tools are unregistered, so this is
    // exactly what every turn looks like: the projection is inert by
    // construction, with no second flag read on the route to drift from the
    // agent's.
    const result = await resultFrame([
      retrieveAnswerChunk("ok", [
        {
          text: "passage",
          sourceName: "John",
          title: null,
          url: "https://example.org/john",
          score: 0.9,
        },
      ]),
    ])
    expect("video" in result).toBe(false)
    expect(result.grounded).toBe(true)
  })

  it("uses the LAST featureVideo declaration when several are present", async () => {
    const result = await resultFrame([
      searchVideosChunk([
        videoRow({ videoId: "v1" }),
        videoRow({ videoId: "v2" }),
      ]),
      featureVideoChunk({ videoId: "v1" }),
      featureVideoChunk({ videoId: "v2" }),
    ])
    expect(result.video).toMatchObject({ videoId: "v2" })
  })

  it("resolves a declaration against an EARLIER search call's results (union semantics)", async () => {
    // The model may search twice and then declare a candidate it saw first;
    // resolving against only the latest call would drop that legitimate pick.
    const result = await resultFrame([
      searchVideosChunk([videoRow({ videoId: "early" })]),
      searchVideosChunk([videoRow({ videoId: "late" })]),
      featureVideoChunk({ videoId: "early" }),
    ])
    expect(result.video).toMatchObject({ videoId: "early" })
  })

  it("lets a LATER search call win on a videoId collision", async () => {
    const result = await resultFrame([
      searchVideosChunk([videoRow({ videoId: "v1", title: "Stale title" })]),
      searchVideosChunk([videoRow({ videoId: "v1", title: "Fresh title" })]),
      featureVideoChunk({ videoId: "v1" }),
    ])
    expect(result.video).toMatchObject({ title: "Fresh title" })
  })
})

describe("handleSeekerRouteRequest — declaration failure ladder (feat-327, plan P3)", () => {
  async function expectNoVideo(
    toolResults: ToolResultChunk[],
    expectedLog: string | null,
  ): Promise<void> {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = await resultFrame(toolResults)
      expect("video" in result).toBe(false)
      if (expectedLog === null) {
        expect(warn).not.toHaveBeenCalled()
      } else {
        expect(warn).toHaveBeenCalledWith(expectedLog)
      }
    } finally {
      warn.mockRestore()
    }
  }

  it("declared id absent from every search result → reason=id_not_in_results", async () => {
    await expectNoVideo(
      [
        searchVideosChunk([videoRow({ videoId: "v1" })]),
        featureVideoChunk({ videoId: "hallucinated" }),
      ],
      "[seeker-route] event=video_feature_invalid_declaration reason=id_not_in_results",
    )
  })

  it("malformed declaration payload → reason=malformed", async () => {
    for (const bad of [{}, { videoId: "" }, { videoId: 7 }, null, "v1"]) {
      await expectNoVideo(
        [
          searchVideosChunk([videoRow({ videoId: "v1" })]),
          featureVideoChunk(bad),
        ],
        "[seeker-route] event=video_feature_invalid_declaration reason=malformed",
      )
    }
  })

  it("declared row was SEEN but fails a projection gate → reason=projection_failed", async () => {
    // The discriminating case for keeping two maps. Collapsing "seen" into
    // "projected" would report this as id_not_in_results and send an operator
    // hunting a hallucination that never happened — the row was real, the
    // contract broke.
    await expectNoVideo(
      [
        searchVideosChunk([videoRow({ videoId: "v1", playbackId: "short" })]),
        featureVideoChunk({ videoId: "v1" }),
      ],
      "[seeker-route] event=video_feature_invalid_declaration reason=projection_failed",
    )
  })

  it("never emits an error frame for any rung of the ladder", async () => {
    // `resultFrame` asserts the absence of an error frame on every call above;
    // this states it as its own claim on the worst input the route can get.
    const { mastra } = makeMastra({
      chunks: ["reply"],
      toolResults: [
        searchVideosChunk("not-an-array" as unknown as unknown[]),
        featureVideoChunk({ videoId: 7 }),
      ],
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const res = await handleSeekerRouteRequest(baseInput(mastra))
      const body = await readSse(res)
      expect(body).not.toContain("event: error")
      expect(body).toContain("event: result")
    } finally {
      warn.mockRestore()
    }
  })

  it("attaches no video when toolResults rejects after a good drain", async () => {
    const { mastra } = makeMastra({
      chunks: ["full answer"],
      toolResultsReject: true,
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const res = await handleSeekerRouteRequest(baseInput(mastra))
      const body = await readSse(res)
      expect(body).not.toContain("event: error")
      const result = JSON.parse(body.match(/event: result\ndata: (.+)\n\n/)![1])
      expect("video" in result).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it("logs enum values only — never a title, never free text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await resultFrame([
        searchVideosChunk([
          videoRow({ videoId: "v1", title: "TITLE-SENTINEL" }),
        ]),
        featureVideoChunk({ videoId: "hallucinated" }),
      ])
      for (const call of warn.mock.calls) {
        expect(String(call[0])).not.toContain("TITLE-SENTINEL")
      }
      // Anti-vacuous: a line really was emitted for the sweep to inspect.
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("handleSeekerRouteRequest — projectVideo gates on the declared row (feat-327, plan D9)", () => {
  async function expectRejected(over: Partial<VideoRow>): Promise<void> {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = await resultFrame([
        searchVideosChunk([videoRow({ videoId: "v1", ...over })]),
        featureVideoChunk({ videoId: "v1" }),
      ])
      expect("video" in result).toBe(false)
    } finally {
      warn.mockRestore()
    }
  }

  it("rejects a playbackId failing the pattern (too short, too long, bad chars)", async () => {
    await expectRejected({ playbackId: "short" })
    await expectRejected({ playbackId: "a".repeat(65) })
    await expectRejected({ playbackId: "has/slash/xyz" })
    await expectRejected({ playbackId: "has space xyz" })
  })

  it("rejects a slug failing the D9 pattern — a MATCH, not a presence check", async () => {
    // Security-load-bearing: `buildCanonicalWatchVideoPath` interpolates the
    // slug raw, so this pattern is the sole control over what path the caption
    // link points at on jesusfilm.org. A presence-only check would pass every
    // one of these.
    await expectRejected({ slug: "../../etc/passwd" })
    await expectRejected({ slug: "slug?x=1" })
    await expectRejected({ slug: "slug#frag" })
    await expectRejected({ slug: "slug%2e%2e" })
    await expectRejected({ slug: "slug with space" })
    await expectRejected({ slug: "-leading-hyphen" })
    await expectRejected({ slug: "" })
    await expectRejected({ slug: "a".repeat(82) })
  })

  it("rejects an ODD-CASED slug (case-SENSITIVE lowercase-only, plan D9)", async () => {
    // Deliberate and easy to "fix" wrongly: every real catalog slug is
    // lowercase and the URL builder compares `languageSlug === "english"`
    // exactly, so an odd-cased value must fail CLOSED here rather than slip
    // past the default-language branch downstream.
    await expectRejected({ slug: "Jesus-Calms-The-Storm" })
    await expectRejected({ languageSlug: "English" })
  })

  it("rejects a PRESENT-but-malformed languageSlug rather than degrading it to null", async () => {
    // Absent is legitimate (chat falls back to the default language). A
    // malformed value is a contract violation — degrading it to null would
    // silently relabel a French dub as English.
    await expectRejected({ languageSlug: "fr/../en" })
  })

  it("re-asserts target_audio on the declared row (D9 belt-and-braces)", async () => {
    // The tool boundary already filtered these, so this only fires if a tool
    // payload is not what the route was promised — which is exactly the
    // assumption D9 refuses to make.
    await expectRejected({ availability: { kind: "related_language" } })
    await expectRejected({ availability: { kind: "target_subtitle" } })
    await expectRejected({ availability: { kind: "some_future_kind" } })
    await expectRejected({
      availability: undefined as unknown as { kind: string },
    })
  })

  it("rejects a row missing videoId or title", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = await resultFrame([
        searchVideosChunk([{ ...videoRow({ videoId: "v1" }), title: "" }]),
        featureVideoChunk({ videoId: "v1" }),
      ])
      expect("video" in result).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it("accepts an absent languageSlug as null, and a non-numeric duration as null", async () => {
    const result = await resultFrame([
      searchVideosChunk([
        {
          ...videoRow({ videoId: "v1" }),
          languageSlug: null,
          durationSeconds: null,
        },
      ]),
      featureVideoChunk({ videoId: "v1" }),
    ])
    expect(result.video).toStrictEqual({
      videoId: "v1",
      title: "Title v1",
      slug: "slug-v1",
      playbackId: "playbackv1xyz",
      durationSeconds: null,
      languageSlug: null,
    })
  })

  it("accepts the boundary-legal playbackId and slug shapes (anti-vacuous companion)", async () => {
    // Without this, a projectVideo that rejected EVERYTHING would satisfy every
    // rejection test above.
    const result = await resultFrame([
      searchVideosChunk([
        videoRow({
          videoId: "v1",
          playbackId: "abcd1234", // exactly the 8-char minimum
          slug: "0", // single leading alphanumeric
          languageSlug: "brazilian-portuguese_1",
        }),
      ]),
      featureVideoChunk({ videoId: "v1" }),
    ])
    expect(result.video).toMatchObject({
      playbackId: "abcd1234",
      slug: "0",
      languageSlug: "brazilian-portuguese_1",
    })
  })
})

describe("handleSeekerRouteRequest — feat-327 review-hardening gates", () => {
  /**
   * Rejects a row, DECLARING THAT ROW'S OWN videoId.
   *
   * Declaring a different id would make every case pass through
   * `id_not_in_results` no matter what the gates do — vacuous. (Caught by
   * falsification: with the videoId gate reduced to a presence check, an
   * earlier version of this helper still went green.)
   */
  async function expectRejected(over: Partial<VideoRow>): Promise<void> {
    const declaredId = over.videoId ?? "v1"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = await resultFrame([
        searchVideosChunk([videoRow({ videoId: "v1", ...over })]),
        featureVideoChunk({ videoId: declaredId }),
      ])
      expect("video" in result).toBe(false)
    } finally {
      warn.mockRestore()
    }
  }

  it("gates videoId by pattern, not merely by presence", async () => {
    // videoId is the one string the model supplies and the only wire field
    // that previously had no shape constraint — the single unvalidated hole in
    // a field-by-field allowlist. Admin ids are cuid-shaped, so none of these
    // rejects anything legitimate.
    //
    // Two traps this fixture has to dodge, BOTH found by falsification:
    //   1. declare the row's OWN id, or every case exits via id_not_in_results;
    //   2. pin slug/playbackId to known-good literals, because videoRow()
    //      DERIVES them from the videoId — "slug-has space" would fail the slug
    //      gate first and the test would pass without the videoId gate existing.
    // With both dodged, the videoId pattern is the only thing that can reject.
    const valid = { playbackId: "abcd1234", slug: "ok-slug" }
    await expectRejected({ videoId: "has space", ...valid })
    await expectRejected({ videoId: "has/slash", ...valid })
    await expectRejected({ videoId: "a".repeat(65), ...valid })
  })

  it("accepts a boundary-legal videoId (anti-vacuous companion)", async () => {
    // Explicit playbackId/slug: videoRow() derives both FROM the videoId, and a
    // 64-char id would push the derived playbackId past its own 64-char gate —
    // failing for the wrong reason and making this companion vacuous.
    const maxId = "a".repeat(64)
    const result = await resultFrame([
      searchVideosChunk([
        videoRow({ videoId: maxId, playbackId: "abcd1234", slug: "ok-slug" }),
      ]),
      featureVideoChunk({ videoId: maxId }),
    ])
    expect(result.video).toMatchObject({ videoId: maxId })
  })

  it("nulls a non-finite or negative durationSeconds instead of passing it through", async () => {
    // NaN and Infinity both serialize to JSON `null` anyway — but only AFTER
    // travelling as a number through the projection's type, so the wire lies
    // about a field the renderer formats. Normalize at the gate instead.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const result = await resultFrame([
        searchVideosChunk([videoRow({ videoId: "v1", durationSeconds: bad })]),
        featureVideoChunk({ videoId: "v1" }),
      ])
      expect(result.video).toMatchObject({ durationSeconds: null })
    }
  })

  it("accepts the MAXIMUM-legal playbackId and slug lengths (upper-bound companion)", async () => {
    // The rejection suite covers 65-char playbackId and 82-char slug; without
    // this, a pattern accidentally tightened to {8,63}/{0,79} would pass every
    // existing test.
    const result = await resultFrame([
      searchVideosChunk([
        videoRow({
          videoId: "v1",
          playbackId: "a".repeat(64),
          slug: `a${"b".repeat(80)}`,
        }),
      ]),
      featureVideoChunk({ videoId: "v1" }),
    ])
    expect(result.video).toMatchObject({
      playbackId: "a".repeat(64),
      slug: `a${"b".repeat(80)}`,
    })
  })

  it("keeps an EARLIER valid projection when a later call's row for the same id fails a gate", async () => {
    // Pins the documented union semantics precisely: a later gate failure must
    // not downgrade a turn that already had a valid candidate for that id.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = await resultFrame([
        searchVideosChunk([videoRow({ videoId: "v1", title: "Valid" })]),
        searchVideosChunk([videoRow({ videoId: "v1", playbackId: "short" })]),
        featureVideoChunk({ videoId: "v1" }),
      ])
      expect(result.video).toMatchObject({ title: "Valid" })
    } finally {
      warn.mockRestore()
    }
  })

  it("emits the E7 signal when a video turn never called retrieveAnswer", async () => {
    // The rollout runbook REQUIRES measuring the retrieveAnswer-skip frequency
    // on video turns before the dogfood roster is exposed. `grounded` on the
    // wire cannot substitute: it is also false when retrieval RAN and returned
    // empty. Enum-only, no payload.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await resultFrame([
        searchVideosChunk([videoRow({ videoId: "v1" })]),
        featureVideoChunk({ videoId: "v1" }),
      ])
      expect(warn).toHaveBeenCalledWith(
        "[seeker-route] event=video_turn_missing_retrieval",
      )
    } finally {
      warn.mockRestore()
    }
  })

  it("stays silent on a video turn that DID call retrieveAnswer (anti-vacuous)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await resultFrame([
        retrieveAnswerChunk("ok", [
          {
            text: "passage",
            sourceName: "John",
            title: null,
            url: "https://example.org/john",
            score: 0.9,
          },
        ]),
        searchVideosChunk([videoRow({ videoId: "v1" })]),
        featureVideoChunk({ videoId: "v1" }),
      ])
      expect(warn).not.toHaveBeenCalledWith(
        "[seeker-route] event=video_turn_missing_retrieval",
      )
    } finally {
      warn.mockRestore()
    }
  })

  it("stays silent on a turn with no video tool activity at all", async () => {
    // Costs nothing while the flag is off: an ordinary retrieval-only turn (or
    // a tool-less turn) must never emit the E7 line.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await resultFrame([retrieveAnswerChunk("empty", [])])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("resolves tool names from the tool modules' own constants, not local literals", () => {
    // A rename in either tool module must not silently stop every declaration
    // resolving. Pin that the code matching chunks IMPORTS the names rather
    // than re-declaring them, and that the fixtures above use the same
    // constants. feat-329 moved that matching into the shared projection
    // module — the SOLE home for the gate now, with no re-export left behind —
    // so the import pin follows it there, and BOTH files are checked for a
    // re-declared literal since either could grow one back.
    const readCode = (specifier: string): string =>
      readFileSync(new URL(specifier, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")

    const projection = readCode("./seeker-turn-projection.ts")
    expect(projection).toMatch(
      /import \{ FEATURE_VIDEO_TOOL_NAME \} from "\.\.\/tools\/feature-video"/,
    )
    expect(projection).toMatch(
      /import \{ SEEKER_SEARCH_VIDEOS_TOOL_NAME \} from "\.\.\/tools\/seeker-search-videos"/,
    )
    // The literals must NOT be re-declared, on either side of the extraction.
    for (const code of [projection, readCode("./seeker-route.ts")]) {
      expect(code).not.toMatch(/const\s+\w*SEARCH_VIDEOS_TOOL_NAME\s*=/)
      expect(code).not.toMatch(/const\s+FEATURE_VIDEO_TOOL_NAME\s*=/)
    }
  })
})

// ===========================================================================
// feat-366: suggested follow-up questions — route wiring (KTD6/KTD7/KTD11)
// ===========================================================================

import {
  FOLLOW_UPS_GENERATION_BUDGET_MS,
  FOLLOW_UPS_MIN_ANSWER_CHARS,
} from "../seeker-follow-ups"
import { generateSeekerFollowUps } from "../seeker-follow-ups-generate"
import type { FollowUpsGenerationOutcome } from "../seeker-follow-ups-generate"

const LONG_ANSWER = "a".repeat(FOLLOW_UPS_MIN_ANSWER_CHARS + 50)
const GROUNDED_TOOL_RESULTS = [retrieveAnswerChunk("ok", [])]

type RouteGenerateSeam = NonNullable<
  SeekerRouteHandlerInput["generateFollowUps"]
>
type RoutePersistSeam = NonNullable<SeekerRouteHandlerInput["persistFollowUps"]>

function generationOutcome(
  over: Partial<FollowUpsGenerationOutcome> = {},
): FollowUpsGenerationOutcome {
  return {
    questions: ["Why pray?"],
    tokensIn: 5,
    tokensOut: 3,
    ...over,
  }
}

function followUpsHarness(over: {
  chunks?: string[]
  toolResults?: ToolResultChunk[]
  enabled?: boolean
  generate?: RouteGenerateSeam
  persist?: RoutePersistSeam
  body?: Record<string, unknown>
  budgetMs?: number
  requestSignal?: AbortSignal
  stream?: (prompt: string, opts: StreamOpts) => unknown
}) {
  const generateCalls: Array<Parameters<RouteGenerateSeam>[0]> = []
  const persistCalls: Array<Parameters<RoutePersistSeam>[0]> = []
  const made = makeMastra({
    chunks: over.chunks ?? [LONG_ANSWER],
    toolResults: over.toolResults ?? GROUNDED_TOOL_RESULTS,
    ...(over.stream ? { stream: over.stream } : {}),
  })
  const input = baseInput(made.mastra, {
    getFollowUpsEnabled: () => over.enabled ?? true,
    generateFollowUps: (i) => {
      generateCalls.push(i)
      return over.generate
        ? over.generate(i)
        : Promise.resolve(generationOutcome())
    },
    persistFollowUps: (i) => {
      persistCalls.push(i)
      return over.persist
        ? over.persist(i)
        : Promise.resolve("persisted" as const)
    },
    ...(over.body ? { readJson: async () => over.body } : {}),
    ...(over.budgetMs !== undefined ? { budgetMs: over.budgetMs } : {}),
    ...(over.requestSignal ? { requestSignal: over.requestSignal } : {}),
  })
  return { made, input, generateCalls, persistCalls }
}

function resultFrameOf(body: string): Record<string, unknown> {
  const match = body.match(/event: result\ndata: (.+)\n\n/)
  expect(match).not.toBeNull()
  return JSON.parse(match![1]) as Record<string, unknown>
}

describe("handleSeekerRouteRequest — follow-ups gate and frame (R4/R5/R7)", () => {
  it("flag off (the default) → generator never invoked, no followUps key, no [seeker-follow-ups] line", async () => {
    const info = vi.spyOn(console, "info")
    try {
      const { input, generateCalls, persistCalls } = followUpsHarness({
        enabled: false,
      })
      const res = await handleSeekerRouteRequest(input)
      const body = await readSse(res)
      expect(generateCalls).toHaveLength(0)
      expect(persistCalls).toHaveLength(0)
      const frame = resultFrameOf(body)
      expect(frame).not.toHaveProperty("followUps")
      expect(
        info.mock.calls.some((c) =>
          String(c[0]).includes("[seeker-follow-ups]"),
        ),
      ).toBe(false)
    } finally {
      info.mockRestore()
    }
  })

  it("flag on + grounded + substantive → the terminal frame carries followUps", async () => {
    const { input } = followUpsHarness({})
    const res = await handleSeekerRouteRequest(input)
    const frame = resultFrameOf(await readSse(res))
    expect(frame.followUps).toEqual(["Why pray?"])
  })

  it("omits the followUps key when generation yields nothing (R7: omitted, never null)", async () => {
    const { input } = followUpsHarness({
      generate: async () =>
        generationOutcome({ questions: [], reason: "no_questions" }),
    })
    const res = await handleSeekerRouteRequest(input)
    const frame = resultFrameOf(await readSse(res))
    expect(frame).not.toHaveProperty("followUps")
    expect(JSON.stringify(frame)).not.toContain("followUps")
  })

  it("skips generation on an ungrounded turn (KTD7)", async () => {
    const { input, generateCalls } = followUpsHarness({
      toolResults: [retrieveAnswerChunk("empty", [])],
    })
    await readSse(await handleSeekerRouteRequest(input))
    expect(generateCalls).toHaveLength(0)
  })

  it("skips generation on a short answer (KTD7 — Covers AE2)", async () => {
    const { input, generateCalls } = followUpsHarness({
      chunks: ["Short social closer."],
    })
    await readSse(await handleSeekerRouteRequest(input))
    expect(generateCalls).toHaveLength(0)
  })

  it("degrades a REJECTING generation seam to a followUps-less result frame — never an error frame (R5)", async () => {
    const { input } = followUpsHarness({
      generate: async () => {
        throw new Error("SECRET-GEN-DETAIL exploded")
      },
    })
    const res = await handleSeekerRouteRequest(input)
    const body = await readSse(res)
    expect(body).toContain("event: result")
    expect(body).not.toContain("event: error")
    expect(resultFrameOf(body)).not.toHaveProperty("followUps")
  })

  it("degrades a SYNCHRONOUSLY throwing generation seam identically (KTD6 containment)", async () => {
    const { input } = followUpsHarness({
      generate: (() => {
        throw new Error("sync gen explosion")
      }) as unknown as RouteGenerateSeam,
    })
    const res = await handleSeekerRouteRequest(input)
    const body = await readSse(res)
    expect(body).toContain("event: result")
    expect(body).not.toContain("event: error")
  })

  it("contains a SYNCHRONOUSLY throwing persist seam — the streamed answer still lands (KTD6)", async () => {
    const warn = vi.spyOn(console, "warn")
    const info = vi.spyOn(console, "info")
    try {
      const { input } = followUpsHarness({
        persist: (() => {
          throw new Error("sync persist explosion")
        }) as unknown as RoutePersistSeam,
      })
      const res = await handleSeekerRouteRequest(input)
      const body = await readSse(res)
      expect(body).toContain("event: result")
      expect(body).not.toContain("event: error")
      expect(
        info.mock.calls.some((c) =>
          String(c[0]).includes("persist=store_failed"),
        ),
      ).toBe(true)
    } finally {
      warn.mockRestore()
      info.mockRestore()
    }
  })

  it("never logs generation/persist error detail on any failure path (R9 no-leak)", async () => {
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "info"),
    ]
    try {
      const { input } = followUpsHarness({
        generate: async () => {
          throw new Error("SECRET-GEN-DETAIL")
        },
        persist: async () => {
          throw new Error("SECRET-PERSIST-DETAIL")
        },
      })
      await readSse(await handleSeekerRouteRequest(input))
      const lines = spies
        .flatMap((spy) => spy.mock.calls)
        .map((call) => call.map(String).join(" "))
      expect(lines.some((l) => l.includes("SECRET-"))).toBe(false)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe("handleSeekerRouteRequest — follow-ups persist ordering and outcomes (KTD6)", () => {
  it("enqueues the terminal frame STRICTLY BEFORE persist resolves (deferred-promise fixture)", async () => {
    let resolvePersist!: (o: "persisted") => void
    let persistSettled = false
    const persistDeferred = new Promise<"persisted">((resolve) => {
      resolvePersist = (o) => {
        persistSettled = true
        resolve(o)
      }
    })
    const { input, persistCalls } = followUpsHarness({
      persist: () => persistDeferred,
    })
    const res = await handleSeekerRouteRequest(input)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ""
    while (!seen.includes("event: result")) {
      const { done, value } = await reader.read()
      if (done) break
      seen += decoder.decode(value)
    }
    // The frame is on the wire while persist is still pending.
    expect(seen).toContain("event: result")
    expect(persistCalls).toHaveLength(1)
    expect(persistSettled).toBe(false)
    resolvePersist("persisted")
    // Drain to completion so the stream closes cleanly.
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  })

  it("passes the turn's OWN threadId and resolved resourceId to persist — and nothing signal-shaped", async () => {
    const { input, persistCalls } = followUpsHarness({
      body: { prompt: "hi", threadId: "thread-A", resourceId: "user:sub-9" },
    })
    await readSse(await handleSeekerRouteRequest(input))
    expect(persistCalls).toHaveLength(1)
    expect(persistCalls[0]).toEqual({
      threadId: "thread-A",
      resourceId: "user:sub-9",
      questions: ["Why pray?"],
      // Turn identity for the carrier scan, BOTH bounds. Lower: a lagging
      // store must retry rather than write onto the PREVIOUS turn's answer.
      // Upper: a NEWER turn's answer must never receive this turn's chips —
      // the backwards walk reaches it before the user row that would have
      // stopped it, so only this bound closes that case.
      turnStartedAtMs: expect.any(Number),
      turnEndedAtMs: expect.any(Number),
    })
    // The window is real and correctly ordered, not two copies of one clock
    // read: the end bound is captured just before the persist call.
    const call = persistCalls[0] as {
      turnStartedAtMs: number
      turnEndedAtMs: number
    }
    expect(call.turnEndedAtMs).toBeGreaterThanOrEqual(call.turnStartedAtMs)
  })

  // The three no-run causes are operationally different — a suppressed turn, a
  // departed consumer, and a seam that threw. One shared literal would cost
  // the operator the only key that separates them, and it is what calibrates
  // the provisional persist retry after the flip. Falsify by collapsing them
  // back to one value: all three of these go red at once.
  it("distinguishes gen_reason=gate_skipped when the suppression gate refuses the turn", async () => {
    const info = vi.spyOn(console, "info")
    try {
      // Ungrounded: the gate refuses regardless of length.
      const { input, generateCalls } = followUpsHarness({ toolResults: [] })
      await readSse(await handleSeekerRouteRequest(input))
      expect(generateCalls).toHaveLength(0)
      expect(
        info.mock.calls.some((c) =>
          String(c[0]).includes("gen_reason=gate_skipped"),
        ),
      ).toBe(true)
    } finally {
      info.mockRestore()
    }
  })

  it("distinguishes gen_reason=stream_closed when the consumer left before the gate", async () => {
    const aborted = new AbortController()
    aborted.abort()
    const info = vi.spyOn(console, "info")
    try {
      const { input, generateCalls } = followUpsHarness({
        requestSignal: aborted.signal,
      })
      await readSse(await handleSeekerRouteRequest(input))
      expect(generateCalls).toHaveLength(0)
      expect(
        info.mock.calls.some((c) =>
          String(c[0]).includes("gen_reason=stream_closed"),
        ),
      ).toBe(true)
    } finally {
      info.mockRestore()
    }
  })

  it("distinguishes gen_reason=unexpected_error when the generate seam throws synchronously", async () => {
    const info = vi.spyOn(console, "info")
    try {
      const { input } = followUpsHarness({
        generate: () => {
          throw new Error("seam exploded")
        },
      })
      const body = await readSse(await handleSeekerRouteRequest(input))
      // R5 still holds: a thrown seam is contained, never an error frame.
      expect(body).toContain("event: result")
      expect(body).not.toContain("event: error")
      expect(
        info.mock.calls.some((c) =>
          String(c[0]).includes("gen_reason=unexpected_error"),
        ),
      ).toBe(true)
    } finally {
      info.mockRestore()
    }
  })

  it("logs the full turn_resolved key set in order (AE5 receiver half)", async () => {
    const info = vi.spyOn(console, "info")
    try {
      const { input } = followUpsHarness({})
      await readSse(await handleSeekerRouteRequest(input))
      const line = info.mock.calls
        .map((c) => String(c[0]))
        .find((l) => l.includes("[seeker-follow-ups]"))
      // Anchored FULL-LINE regex — this IS the field-set pin: a missing,
      // reordered, or extra key goes red here, and no free text can ride the
      // line. `gen_reason` carries the generator's closed reason vocabulary
      // (`ok` on success; a distinct no-run cause when the gate, the
      // stream-open check, or containment kept the
      // generator from running).
      expect(line).toMatch(
        /^\[seeker-follow-ups\] event=turn_resolved mode=post prompt_source=typed count=1 gen_reason=ok added_ms=\d+ persist=persisted gen_tokens_in=5 gen_tokens_out=3 total_ms=\d+$/,
      )
      // Positive no-leak property (R9): the anchored full-line regex above
      // already forbids extra content, and this makes the intent explicit —
      // the generated QUESTION text never rides the log line.
      expect(line).not.toContain("Why pray?")
    } finally {
      info.mockRestore()
    }
  })

  it("records prompt_source=follow_up for a valid chip-originated body (KTD11)", async () => {
    const info = vi.spyOn(console, "info")
    try {
      const { input } = followUpsHarness({
        body: { prompt: "hi", threadId: "t", promptSource: "follow_up" },
      })
      await readSse(await handleSeekerRouteRequest(input))
      expect(
        info.mock.calls.some((c) =>
          String(c[0]).includes("prompt_source=follow_up"),
        ),
      ).toBe(true)
    } finally {
      info.mockRestore()
    }
  })

  it.each([
    ["absent", { prompt: "hi", threadId: "t" }],
    ["invalid string", { prompt: "hi", threadId: "t", promptSource: "banana" }],
    ["non-string", { prompt: "hi", threadId: "t", promptSource: 42 }],
  ])(
    "records prompt_source=typed for an %s promptSource — never a 400 (KTD11)",
    async (_label, body) => {
      const info = vi.spyOn(console, "info")
      try {
        const { input } = followUpsHarness({ body })
        const res = await handleSeekerRouteRequest(input)
        expect(res.status).toBe(200)
        await readSse(res)
        expect(
          info.mock.calls.some((c) =>
            String(c[0]).includes("prompt_source=typed"),
          ),
        ).toBe(true)
      } finally {
        info.mockRestore()
      }
    },
  )

  it("stamps sendOrigin into the TURN's trace metadata even with the flag OFF (KTD11 — flag-independent)", async () => {
    const { made, input } = followUpsHarness({
      enabled: false,
      body: { prompt: "hi", threadId: "t", promptSource: "follow_up" },
    })
    await readSse(await handleSeekerRouteRequest(input))
    expect(made.streamCalls[0].opts.tracingOptions?.metadata?.sendOrigin).toBe(
      "follow_up",
    )
  })

  it("threads the turn's trace/span ids into the generator's tracing options (KTD9 same-trace attempt)", async () => {
    const { input, generateCalls } = followUpsHarness({
      stream: () => ({
        textStream: textStream([LONG_ANSWER]),
        toolResults: Promise.resolve(GROUNDED_TOOL_RESULTS),
        traceId: "trace-abc",
        spanId: "span-def",
      }),
    })
    await readSse(await handleSeekerRouteRequest(input))
    expect(generateCalls).toHaveLength(1)
    const tracing = generateCalls[0].tracingOptions
    expect(tracing?.traceId).toBe("trace-abc")
    expect(tracing?.parentSpanId).toBe("span-def")
    expect(tracing?.metadata?.traceName).toBe("seeker-follow-ups")
    expect(tracing?.metadata?.userId).toBe(SEEKER_DEFAULT_RESOURCE_ID)
    expect(generateCalls[0].requestContext?.get("tracingConfig")).toBe(
      LANGFUSE_SEEKER_TRACING_MARKER,
    )
  })
})

describe("handleSeekerRouteRequest — follow-ups budget and abort edges (KTD6)", () => {
  it("passes min(2.5s, remaining budget) to generation — the default budget path", async () => {
    const { input, generateCalls } = followUpsHarness({})
    await readSse(await handleSeekerRouteRequest(input))
    expect(generateCalls[0].budgetMs).toBeLessThanOrEqual(
      FOLLOW_UPS_GENERATION_BUDGET_MS,
    )
    expect(generateCalls[0].budgetMs).toBeGreaterThan(0)
  })

  it("releases the terminal frame at or before a near-exhausted turn ceiling", async () => {
    // A tight route budget: the effective deadline derives to well under the
    // 2.5s generation budget, and the REAL generation module's race enforces
    // it even against a seam that ignores its abort signal.
    const { input } = followUpsHarness({
      budgetMs: 150,
      generate: (i) =>
        generateSeekerFollowUps({
          ...i,
          generateSeam: () => new Promise(() => {}),
        }),
    })
    const started = Date.now()
    const res = await handleSeekerRouteRequest(input)
    const body = await readSse(res)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(body).toContain("event: result")
    expect(resultFrameOf(body)).not.toHaveProperty("followUps")
  })

  it("a generation that resolves after the race deadline writes nothing (persist=skipped)", async () => {
    const info = vi.spyOn(console, "info")
    try {
      const { input, persistCalls } = followUpsHarness({
        budgetMs: 120,
        generate: (i) =>
          generateSeekerFollowUps({
            ...i,
            generateSeam: () =>
              new Promise((resolve) =>
                setTimeout(() => resolve({ text: '["Late question?"]' }), 400),
              ),
          }),
      })
      const body = await readSse(await handleSeekerRouteRequest(input))
      expect(resultFrameOf(body)).not.toHaveProperty("followUps")
      expect(persistCalls).toHaveLength(0)
      expect(
        info.mock.calls.some((c) => String(c[0]).includes("persist=skipped")),
      ).toBe(true)
      // The operator can tell a race loss from a gate skip (finding: the
      // reason enum must reach the line, not just the return value). This
      // fixture's module deadline sits milliseconds from the route budget,
      // so the loss honestly classifies as either race-loss enum.
      expect(
        info.mock.calls.some((c) =>
          /gen_reason=(timeout|aborted)/.test(String(c[0])),
        ),
      ).toBe(true)
    } finally {
      info.mockRestore()
    }
  })

  it("a consumer cancel BEFORE the gate skips generation entirely — no paid call for an absent audience", async () => {
    let pushChunk!: (t: string) => void
    let endStream!: () => void
    const manual = new ReadableStream<string>({
      start(controller) {
        pushChunk = (t) => controller.enqueue(t)
        endStream = () => {
          try {
            controller.close()
          } catch {
            // Already canceled through the route's reader — nothing to close.
          }
        }
      },
    })
    const { input, generateCalls } = followUpsHarness({
      stream: () => ({
        textStream: manual,
        toolResults: Promise.resolve(GROUNDED_TOOL_RESULTS),
      }),
    })
    const info = vi.spyOn(console, "info")
    try {
      const res = await handleSeekerRouteRequest(input)
      const reader = res.body!.getReader()
      pushChunk(LONG_ANSWER)
      await reader.read()
      await reader.cancel()
      endStream()
      await vi.waitFor(() => {
        expect(
          info.mock.calls.some((c) =>
            String(c[0]).includes("event=turn_resolved"),
          ),
        ).toBe(true)
      })
      expect(generateCalls).toHaveLength(0)
      expect(
        info.mock.calls.some((c) => String(c[0]).includes("persist=skipped")),
      ).toBe(true)
    } finally {
      info.mockRestore()
    }
  })

  it("a cancel AFTER generation but before the terminal enqueue persists nothing (persist=undelivered)", async () => {
    let resolveGeneration!: (o: FollowUpsGenerationOutcome) => void
    const pending = new Promise<FollowUpsGenerationOutcome>((resolve) => {
      resolveGeneration = resolve
    })
    let generateStarted!: () => void
    const started = new Promise<void>((resolve) => {
      generateStarted = resolve
    })
    const { input, persistCalls } = followUpsHarness({
      generate: () => {
        generateStarted()
        return pending
      },
    })
    const info = vi.spyOn(console, "info")
    try {
      const res = await handleSeekerRouteRequest(input)
      const reader = res.body!.getReader()
      // Drain the token frames until generation is underway, then disconnect.
      void (async () => {
        while (true) {
          const { done } = await reader.read().catch(() => ({ done: true }))
          if (done) break
        }
      })()
      await started
      await reader.cancel()
      resolveGeneration(generationOutcome())
      await vi.waitFor(() => {
        expect(
          info.mock.calls.some((c) =>
            String(c[0]).includes("persist=undelivered"),
          ),
        ).toBe(true)
      })
      expect(persistCalls).toHaveLength(0)
    } finally {
      info.mockRestore()
    }
  })

  it("threads the route's REAL composed abort signal into generation as turnSignal (feat-366 review #2)", async () => {
    // Every other follow-ups test injects a generation seam, so nothing else
    // proves the route supplies the real request-derived signal — deleting
    // `turnSignal: abortSignal` at the call site would leave the suite green
    // without this pin. Discriminating: a synthetic or absent signal would
    // never flip when the REQUEST controller aborts.
    const controller = new AbortController()
    const { input, generateCalls } = followUpsHarness({
      requestSignal: controller.signal,
    })
    await readSse(await handleSeekerRouteRequest(input))
    expect(generateCalls).toHaveLength(1)
    const threaded = generateCalls[0].turnSignal
    expect(threaded).toBeInstanceOf(AbortSignal)
    expect(threaded?.aborted).toBe(false)
    controller.abort()
    expect(threaded?.aborted).toBe(true)
  })

  it("skips generation entirely when the composed signal is ALREADY aborted at the gate — no paid call for an aborted turn", async () => {
    const aborted = new AbortController()
    aborted.abort()
    const info = vi.spyOn(console, "info")
    try {
      // The fake agent ignores the abort signal and completes normally, so
      // the drain reaches the gate with `closed` still false — isolating the
      // `!abortSignal.aborted` rung.
      const { input, generateCalls } = followUpsHarness({
        requestSignal: aborted.signal,
      })
      const body = await readSse(await handleSeekerRouteRequest(input))
      expect(body).toContain("event: result")
      expect(generateCalls).toHaveLength(0)
      expect(
        info.mock.calls.some((c) => String(c[0]).includes("persist=skipped")),
      ).toBe(true)
    } finally {
      info.mockRestore()
    }
  })

  it("a request-signal abort AFTER the terminal frame never withholds persistence — live and replay cannot disagree", async () => {
    // ORDERING IS THE WHOLE TEST (review, 2026-08-20). An earlier version read
    // the stream with `readSse` — i.e. `res.text()`, which resolves only after
    // start() has already awaited the persist — and aborted afterwards, so the
    // abort landed after the thing under test had finished. It could not fail:
    // composing the request signal into the persist would have left it green.
    // Here the persist is held open on a deferred promise, the abort fires
    // while it is genuinely in flight, and only THEN is it released.
    const controller = new AbortController()
    let signalEntered: (() => void) | undefined
    let releasePersist: (() => void) | undefined
    const entered = new Promise<void>((r) => {
      signalEntered = r
    })
    const released = new Promise<"persisted">((r) => {
      releasePersist = () => r("persisted")
    })
    const { input, persistCalls } = followUpsHarness({
      requestSignal: controller.signal,
      persist: () => {
        signalEntered?.()
        return released
      },
    })
    const info = vi.spyOn(console, "info")
    try {
      const res = await handleSeekerRouteRequest(input)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let seen = ""
      // Read only up to the terminal frame — do NOT drain to EOF, because the
      // stream does not close until the persist has settled.
      while (!seen.includes("event: result")) {
        const { done, value } = await reader.read()
        if (done) break
        seen += decoder.decode(value, { stream: true })
      }
      expect(seen).toContain("event: result")

      // The persist is now in flight. The proxy aborts upstream right after
      // relaying the terminal frame on every NORMAL turn; that abort must not
      // reach the persist.
      await entered
      expect(persistCalls).toHaveLength(1)
      controller.abort()

      releasePersist!()
      await vi.waitFor(() => {
        expect(
          info.mock.calls.some((c) =>
            String(c[0]).includes("persist=persisted"),
          ),
        ).toBe(true)
      })
      await reader.cancel()
    } finally {
      info.mockRestore()
    }
  })
})

describe("handleSeekerRouteRequest — follow-ups default-source pins", () => {
  it("wires the real generation/persist/flag sources as the seam defaults", () => {
    // The seams exist for tests; each default is the one-line production
    // revert surface (the feat-283 lesson). Pin them in source so a drive-by
    // seam-default swap shows up in review.
    const route = readFileSync(
      new URL("./seeker-route.ts", import.meta.url),
      "utf8",
    )
    expect(route).toMatch(/getFollowUpsEnabled = isSeekerFollowUpsEnabled/)
    expect(route).toMatch(/generateFollowUps = generateSeekerFollowUps/)
    // Anchored to the parameter ASSIGNMENT, not just the call: the previous
    // /persistSeekerFollowUps\(/ form was satisfied by the literal appearing
    // anywhere in the file, including inside a comment, unlike its two
    // siblings which pin name-to-symbol.
    expect(route).toMatch(
      /persistFollowUps = \(input\) =>[\s\S]*?persistSeekerFollowUps\(/,
    )
  })

  // The default-source pin above reads seeker-route.ts's OWN text, so it says
  // nothing about the call site that actually relies on those defaults. The
  // production registration passes no follow-ups seam; a one-line
  // `getFollowUpsEnabled: () => false` smuggled in there would silently
  // disable the feature with every test above still green. Same technique as
  // seeker-route-isolation.test.ts's admission-seam backstop (feat-283).
  it("passes no follow-ups seam anywhere in index.ts (parser-independent backstop)", () => {
    const indexSource = readFileSync(
      new URL("../index.ts", import.meta.url),
      "utf8",
    )
    expect(indexSource).not.toMatch(
      /\bgetFollowUpsEnabled\b|\bgenerateFollowUps\b|\bpersistFollowUps\b/,
    )
  })

  // Anti-vacuous companion: prove the file the backstop reads is the real
  // registration and not an empty/mis-resolved path.
  it("reads the real /forge-seeker registration in that backstop", () => {
    const indexSource = readFileSync(
      new URL("../index.ts", import.meta.url),
      "utf8",
    )
    expect(indexSource).toContain('"/forge-seeker"')
    expect(indexSource).toContain("handleSeekerRouteRequest({")
  })
})
