import { Agent } from "@mastra/core/agent"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Memory } from "@mastra/memory"

import { assertAiChatServiceKeysDisjoint } from "../config/env"

import { buildAiChatMemory } from "./memory"
import {
  AI_CHAT_HISTORY_DEFAULT_PER_PAGE,
  AI_CHAT_HISTORY_MAX_PER_PAGE,
  AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT,
  AI_CHAT_HISTORY_TEXT_CAP_CHARS,
  handleAiChatHistoryListRequest,
  handleAiChatHistoryReplayRequest,
  type AiChatHistoryHandlerInput,
  type AiChatHistoryMemory,
  type AiChatHistoryWireMessage,
  type AiChatHistoryWireThread,
} from "./ai-chat-history-route"

const LANE_KEYS = ["test-lane-key"] as const
const AUTH = "Bearer test-lane-key"
const POOL_KEY = "test-pool-key"
const OWNER = "user:sub-1"

// --- fake-memory harness -----------------------------------------------------

type FakeThreadRow = {
  id: string
  title?: string | null
  updatedAt?: Date | string | null
  // Extra store fields the projection must NOT let onto the wire.
  resourceId?: string | null
  metadata?: Record<string, unknown>
}

type MakeMemoryOpts = {
  threads?: FakeThreadRow[]
  total?: number
  hasMore?: boolean
  messages?: unknown[]
  threadOwner?: string | null
  listThreadsImpl?: AiChatHistoryMemory["listThreads"]
  getThreadByIdImpl?: AiChatHistoryMemory["getThreadById"]
  recallImpl?: AiChatHistoryMemory["recall"]
}

function makeMemory(opts: MakeMemoryOpts = {}): {
  memory: AiChatHistoryMemory
  listCalls: Array<Parameters<AiChatHistoryMemory["listThreads"]>[0]>
  getCalls: Array<Parameters<AiChatHistoryMemory["getThreadById"]>[0]>
  recallCalls: Array<Parameters<AiChatHistoryMemory["recall"]>[0]>
} {
  const listCalls: Array<Parameters<AiChatHistoryMemory["listThreads"]>[0]> = []
  const getCalls: Array<Parameters<AiChatHistoryMemory["getThreadById"]>[0]> =
    []
  const recallCalls: Array<Parameters<AiChatHistoryMemory["recall"]>[0]> = []
  const memory: AiChatHistoryMemory = {
    listThreads: async (args) => {
      listCalls.push(args)
      if (opts.listThreadsImpl) return opts.listThreadsImpl(args)
      const threads = opts.threads ?? []
      return {
        threads,
        total: opts.total ?? threads.length,
        page: args.page ?? 0,
        perPage: args.perPage ?? 0,
        hasMore: opts.hasMore ?? false,
      }
    },
    getThreadById: async (args) => {
      getCalls.push(args)
      if (opts.getThreadByIdImpl) return opts.getThreadByIdImpl(args)
      return opts.threadOwner === undefined
        ? null
        : { resourceId: opts.threadOwner }
    },
    recall: async (args) => {
      recallCalls.push(args)
      if (opts.recallImpl) return opts.recallImpl(args)
      return { messages: opts.messages ?? [] }
    },
  }
  return { memory, listCalls, getCalls, recallCalls }
}

function baseInput(
  memory: AiChatHistoryMemory,
  over: Partial<AiChatHistoryHandlerInput> = {},
): AiChatHistoryHandlerInput {
  return {
    authHeader: AUTH,
    readJson: async () => ({ resourceId: OWNER }),
    getEnabled: () => true,
    getServiceKeys: () => LANE_KEYS,
    getMemory: () => memory,
    ...over,
  }
}

function replayInput(
  memory: AiChatHistoryMemory,
  over: Partial<AiChatHistoryHandlerInput> = {},
): AiChatHistoryHandlerInput {
  return baseInput(memory, {
    readJson: async () => ({ resourceId: OWNER, threadId: "thread-1" }),
    ...over,
  })
}

function textPart(text: string): { type: "text"; text: string } {
  return { type: "text", text }
}

function storedMessage(over: Record<string, unknown> = {}): unknown {
  return {
    id: "m-user-1",
    role: "user",
    createdAt: new Date("2026-07-10T10:00:00.000Z"),
    threadId: "thread-1",
    resourceId: OWNER,
    content: { format: 2, parts: [textPart("hello there")] },
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Shared ladder (flag → lane bearer) — exercised through both handlers
// ===========================================================================

describe("history routes — precondition ladder", () => {
  it("returns 404 when the route flag is off, before bearer or body (AE9)", async () => {
    const { memory, listCalls } = makeMemory()
    const keysProbe = vi.fn(() => LANE_KEYS)
    const readJson = vi.fn(async () => ({ resourceId: OWNER }))
    const outcome = await handleAiChatHistoryListRequest(
      baseInput(memory, {
        getEnabled: () => false,
        getServiceKeys: keysProbe,
        readJson,
      }),
    )
    expect(outcome.status).toBe(404)
    expect(outcome.body).toEqual({ error: "Not found" })
    expect(keysProbe).not.toHaveBeenCalled()
    expect(readJson).not.toHaveBeenCalled()
    expect(listCalls).toHaveLength(0)
  })

  it("returns 401 for a missing or wrong bearer, store never called (AE9)", async () => {
    for (const authHeader of [undefined, "Bearer nope", "nope"]) {
      const { memory, listCalls } = makeMemory()
      const outcome = await handleAiChatHistoryListRequest(
        baseInput(memory, { authHeader }),
      )
      expect(outcome.status).toBe(401)
      expect(listCalls).toHaveLength(0)
    }
  })

  it("rejects a POOL-valid bearer that is absent from the lane list (KTD2 carve-out pin)", async () => {
    const { memory, listCalls } = makeMemory()
    const outcome = await handleAiChatHistoryListRequest(
      baseInput(memory, { authHeader: `Bearer ${POOL_KEY}` }),
    )
    expect(outcome.status).toBe(401)
    expect(listCalls).toHaveLength(0)
  })

  it("fails closed when the lane CSV is unset (default key source, empty allowlist)", async () => {
    const { memory, listCalls } = makeMemory()
    // No getServiceKeys override: the default reads AI_CHAT_SERVICE_API_KEYS,
    // which is unset in the test env — every bearer must be refused.
    const outcome = await handleAiChatHistoryListRequest({
      authHeader: AUTH,
      readJson: async () => ({ resourceId: OWNER }),
      getEnabled: () => true,
      getMemory: () => memory,
    })
    expect(outcome.status).toBe(401)
    expect(listCalls).toHaveLength(0)
  })

  it("replay shares the same flag/bearer ladder", async () => {
    const { memory, recallCalls } = makeMemory()
    const disabled = await handleAiChatHistoryReplayRequest(
      replayInput(memory, { getEnabled: () => false }),
    )
    expect(disabled.status).toBe(404)
    const badBearer = await handleAiChatHistoryReplayRequest(
      replayInput(memory, { authHeader: "Bearer nope" }),
    )
    expect(badBearer.status).toBe(401)
    expect(recallCalls).toHaveLength(0)
  })
})

describe("assertAiChatServiceKeysDisjoint (KTD2 boot invariant)", () => {
  it("throws when a key value appears in both CSVs, without leaking the value", () => {
    expect(() =>
      assertAiChatServiceKeysDisjoint(
        "pool-a, overlap-key-value",
        "overlap-key-value,lane-b",
      ),
    ).toThrowError()
    try {
      assertAiChatServiceKeysDisjoint("overlap-key-value", "overlap-key-value")
    } catch (error) {
      expect(String(error)).not.toContain("overlap-key-value")
    }
  })

  it("passes for disjoint or unset CSVs", () => {
    expect(() =>
      assertAiChatServiceKeysDisjoint("pool-a,pool-b", "lane-a"),
    ).not.toThrow()
    expect(() =>
      assertAiChatServiceKeysDisjoint(undefined, "lane-a"),
    ).not.toThrow()
    expect(() =>
      assertAiChatServiceKeysDisjoint("pool-a", undefined),
    ).not.toThrow()
    expect(() => assertAiChatServiceKeysDisjoint()).not.toThrow()
  })
})

// ===========================================================================
// Listing (U1)
// ===========================================================================

describe("handleAiChatHistoryListRequest — body validation", () => {
  it.each([
    ["missing resourceId", {}],
    ["non-string resourceId", { resourceId: 5 }],
    ["non-number page", { resourceId: OWNER, page: "1" }],
    ["negative page", { resourceId: OWNER, page: -1 }],
    ["non-integer page", { resourceId: OWNER, page: 1.5 }],
    ["non-number perPage", { resourceId: OWNER, perPage: "50" }],
    ["non-positive perPage", { resourceId: OWNER, perPage: 0 }],
  ])("rejects %s with 400 invalid_body", async (_label, body) => {
    const { memory, listCalls } = makeMemory()
    const outcome = await handleAiChatHistoryListRequest(
      baseInput(memory, { readJson: async () => body }),
    )
    expect(outcome.status).toBe(400)
    expect(outcome.body).toEqual({ reason: "invalid_body" })
    expect(listCalls).toHaveLength(0)
  })

  it("rejects an unparseable body with 400", async () => {
    const { memory } = makeMemory()
    const outcome = await handleAiChatHistoryListRequest(
      baseInput(memory, {
        readJson: async () => {
          throw new Error("bad json")
        },
      }),
    )
    expect(outcome.status).toBe(400)
  })
})

describe("handleAiChatHistoryListRequest — resource refusal (AE1, R2)", () => {
  it.each([
    ["anon resource", "anon:3f9a2b10-9c1c-4b5f-a2d5-0e7c66666666"],
    ["dogfood fallback resource", "seeker-dogfood"],
    ["blank resource", ""],
  ])(
    "refuses %s with 403 before any store call",
    async (_label, resourceId) => {
      const { memory, listCalls } = makeMemory()
      const outcome = await handleAiChatHistoryListRequest(
        baseInput(memory, { readJson: async () => ({ resourceId }) }),
      )
      expect(outcome.status).toBe(403)
      expect(outcome.body).toEqual({ reason: "resource_forbidden" })
      expect(listCalls).toHaveLength(0)
    },
  )
})

describe("handleAiChatHistoryListRequest — happy path + clamps (KTD6)", () => {
  it("queries with resource filter, updatedAt DESC ordering, and clamped pagination", async () => {
    const { memory, listCalls } = makeMemory({
      threads: [
        {
          id: "t-new",
          title: "Newest thread",
          updatedAt: new Date("2026-07-12T08:00:00.000Z"),
          resourceId: OWNER,
          metadata: { secret: "NEVER_ON_WIRE" },
        },
        { id: "t-untitled", title: "", updatedAt: "2026-07-10T08:00:00.000Z" },
      ],
      total: 72,
      hasMore: true,
    })
    const outcome = await handleAiChatHistoryListRequest(
      baseInput(memory, {
        readJson: async () => ({ resourceId: OWNER, page: 2, perPage: 500 }),
      }),
    )
    expect(listCalls).toEqual([
      {
        filter: { resourceId: OWNER },
        orderBy: { field: "updatedAt", direction: "DESC" },
        page: 2,
        perPage: AI_CHAT_HISTORY_MAX_PER_PAGE,
      },
    ])
    expect(outcome.status).toBe(200)
    const body = outcome.body as {
      threads: AiChatHistoryWireThread[]
      total: number
      hasMore: boolean
    }
    // Field-by-field projection: exactly the wire keys, nothing from the store
    // row leaks through.
    expect(body.threads).toEqual([
      {
        id: "t-new",
        title: "Newest thread",
        updatedAt: "2026-07-12T08:00:00.000Z",
      },
      { id: "t-untitled", title: "", updatedAt: "2026-07-10T08:00:00.000Z" },
    ])
    expect(Object.keys(body.threads[0]!)).toEqual(["id", "title", "updatedAt"])
    expect(JSON.stringify(outcome.body)).not.toContain("NEVER_ON_WIRE")
    expect(body.total).toBe(72)
    expect(body.hasMore).toBe(true)
  })

  it("defaults page to 0 and perPage to the default clamp when absent", async () => {
    const { memory, listCalls } = makeMemory()
    await handleAiChatHistoryListRequest(baseInput(memory))
    expect(listCalls[0]).toMatchObject({
      page: 0,
      perPage: AI_CHAT_HISTORY_DEFAULT_PER_PAGE,
    })
  })
})

describe("handleAiChatHistoryListRequest — failure mapping", () => {
  it("maps a store rejection to 500 store_failed with no exception text on wire or logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { memory } = makeMemory({
      listThreadsImpl: async () => {
        throw new Error("pg exploded for thread-SECRET-id")
      },
    })
    const outcome = await handleAiChatHistoryListRequest(baseInput(memory))
    expect(outcome.status).toBe(500)
    expect(outcome.body).toEqual({ reason: "store_failed" })
    expect(JSON.stringify(outcome.body)).not.toContain("SECRET")
    const logged = warn.mock.calls.flat().join("\n")
    expect(logged).not.toContain("SECRET")
    expect(logged).toContain(
      "[ai-chat-history] event=list_failed reason=store_failed",
    )
  })

  it("settles a never-resolving store call within the injected budget as 504 timeout", async () => {
    const { memory } = makeMemory({
      listThreadsImpl: () => new Promise(() => {}),
    })
    const outcome = await handleAiChatHistoryListRequest(
      baseInput(memory, { budgetMs: 20 }),
    )
    expect(outcome.status).toBe(504)
    expect(outcome.body).toEqual({ reason: "timeout" })
  })
})

// ===========================================================================
// Replay (U2)
// ===========================================================================

describe("handleAiChatHistoryReplayRequest — body validation", () => {
  it.each([
    ["missing threadId", { resourceId: OWNER }],
    ["empty threadId", { resourceId: OWNER, threadId: "" }],
    ["over-length threadId", { resourceId: OWNER, threadId: "x".repeat(201) }],
    ["missing resourceId", { threadId: "thread-1" }],
  ])("rejects %s with 400", async (_label, body) => {
    const { memory, getCalls } = makeMemory()
    const outcome = await handleAiChatHistoryReplayRequest(
      replayInput(memory, { readJson: async () => body }),
    )
    expect(outcome.status).toBe(400)
    expect(outcome.body).toEqual({ reason: "invalid_body" })
    expect(getCalls).toHaveLength(0)
  })

  it("refuses a non-user resource before the ownership gate", async () => {
    const { memory, getCalls } = makeMemory()
    const outcome = await handleAiChatHistoryReplayRequest(
      replayInput(memory, {
        readJson: async () => ({
          resourceId: "seeker-dogfood",
          threadId: "thread-1",
        }),
      }),
    )
    expect(outcome.status).toBe(403)
    expect(outcome.body).toEqual({ reason: "resource_forbidden" })
    expect(getCalls).toHaveLength(0)
  })
})

describe("handleAiChatHistoryReplayRequest — ownership + existence (AE4, KTD4)", () => {
  it("returns 403 thread_forbidden for a foreign-owner thread, recall never called", async () => {
    const { memory, recallCalls } = makeMemory({ threadOwner: "user:other" })
    const outcome = await handleAiChatHistoryReplayRequest(replayInput(memory))
    expect(outcome.status).toBe(403)
    expect(outcome.body).toEqual({ reason: "thread_forbidden" })
    expect(recallCalls).toHaveLength(0)
  })

  it("returns an explicit 404 thread_not_found for a missing thread, never an empty success", async () => {
    const { memory, recallCalls } = makeMemory({ threadOwner: undefined })
    const outcome = await handleAiChatHistoryReplayRequest(replayInput(memory))
    expect(outcome.status).toBe(404)
    expect(outcome.body).toEqual({ reason: "thread_not_found" })
    expect(recallCalls).toHaveLength(0)
  })

  it("maps the gate's thread_limit (at-ceiling resource + missing thread) to thread_not_found on the wire", async () => {
    const { memory, recallCalls } = makeMemory({
      threadOwner: undefined,
      listThreadsImpl: async () => ({
        threads: [],
        total: 200,
        page: 0,
        perPage: 1,
        hasMore: false,
      }),
    })
    const outcome = await handleAiChatHistoryReplayRequest(replayInput(memory))
    expect(outcome.status).toBe(404)
    expect(outcome.body).toEqual({ reason: "thread_not_found" })
    expect(JSON.stringify(outcome.body)).not.toContain("thread_limit")
    expect(recallCalls).toHaveLength(0)
  })
})

describe("handleAiChatHistoryReplayRequest — projection (AE17, KTD5)", () => {
  it("projects only { id, role, text, createdAt } for user/assistant turns; tool internals and metadata never reach the wire", async () => {
    const { memory } = makeMemory({
      threadOwner: OWNER,
      messages: [
        storedMessage(),
        storedMessage({
          id: "m-assistant-1",
          role: "assistant",
          createdAt: "2026-07-10T10:00:05.000Z",
          content: {
            format: 2,
            parts: [
              { type: "step-start" },
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolName: "retrieveAnswer",
                  args: { query: "SECRET_RAG_QUERY" },
                  result: { passages: ["SECRET_RAG_PAYLOAD"] },
                },
              },
              textPart("Here is the answer."),
            ],
            providerMetadata: {
              openrouter: { secret: "SECRET_PROVIDER_META" },
            },
          },
        }),
        storedMessage({ id: "m-system", role: "system" }),
        storedMessage({ id: "m-signal", role: "signal" }),
      ],
    })
    const outcome = await handleAiChatHistoryReplayRequest(replayInput(memory))
    expect(outcome.status).toBe(200)
    const body = outcome.body as { messages: AiChatHistoryWireMessage[] }
    expect(body.messages).toEqual([
      {
        id: "m-user-1",
        role: "user",
        text: "hello there",
        createdAt: "2026-07-10T10:00:00.000Z",
      },
      {
        id: "m-assistant-1",
        role: "assistant",
        text: "Here is the answer.",
        createdAt: "2026-07-10T10:00:05.000Z",
      },
    ])
    for (const message of body.messages) {
      expect(Object.keys(message)).toEqual(["id", "role", "text", "createdAt"])
    }
    const wire = JSON.stringify(outcome.body)
    expect(wire).not.toContain("SECRET_RAG_QUERY")
    expect(wire).not.toContain("SECRET_RAG_PAYLOAD")
    expect(wire).not.toContain("SECRET_PROVIDER_META")
    expect(wire).not.toContain("tool-invocation")
  })

  it("truncates an over-cap text part to the per-message cap", async () => {
    const { memory } = makeMemory({
      threadOwner: OWNER,
      messages: [
        storedMessage({
          content: {
            format: 2,
            parts: [textPart("x".repeat(AI_CHAT_HISTORY_TEXT_CAP_CHARS + 100))],
          },
        }),
      ],
    })
    const outcome = await handleAiChatHistoryReplayRequest(replayInput(memory))
    const body = outcome.body as { messages: AiChatHistoryWireMessage[] }
    expect(body.messages[0]!.text).toHaveLength(AI_CHAT_HISTORY_TEXT_CAP_CHARS)
  })

  it("pins recall arguments: resourceId present (the ownership backstop) and explicit perPage", async () => {
    const { memory, recallCalls } = makeMemory({ threadOwner: OWNER })
    await handleAiChatHistoryReplayRequest(replayInput(memory))
    expect(recallCalls).toEqual([
      {
        threadId: "thread-1",
        resourceId: OWNER,
        perPage: AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT,
      },
    ])
  })
})

describe("handleAiChatHistoryReplayRequest — failure mapping (fail closed)", () => {
  it("maps a gate-read store outage to 500 store_failed — never thread_not_found", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { memory } = makeMemory({
      getThreadByIdImpl: async () => {
        throw new Error("connection refused SECRET_HOST")
      },
    })
    const outcome = await handleAiChatHistoryReplayRequest(replayInput(memory))
    expect(outcome.status).toBe(500)
    expect(outcome.body).toEqual({ reason: "store_failed" })
    expect(JSON.stringify(outcome.body)).not.toContain("SECRET_HOST")
    expect(warn.mock.calls.flat().join("\n")).not.toContain("SECRET_HOST")
  })

  it("maps a recall rejection after a passing gate to 500 store_failed", async () => {
    const { memory } = makeMemory({
      threadOwner: OWNER,
      recallImpl: async () => {
        throw new Error("recall exploded")
      },
    })
    const outcome = await handleAiChatHistoryReplayRequest(replayInput(memory))
    expect(outcome.status).toBe(500)
    expect(outcome.body).toEqual({ reason: "store_failed" })
  })

  it("bounds a never-resolving recall by the injected budget as 504 timeout", async () => {
    const { memory } = makeMemory({
      threadOwner: OWNER,
      recallImpl: () => new Promise(() => {}),
    })
    const outcome = await handleAiChatHistoryReplayRequest(
      replayInput(memory, { budgetMs: 20 }),
    )
    expect(outcome.status).toBe(504)
    expect(outcome.body).toEqual({ reason: "timeout" })
  })
})

// ===========================================================================
// Real-memory smoke: a turn written through the agent path is listable and
// replayable through the new handlers against the SAME Memory instance.
// ===========================================================================

const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

type SmokeDoStreamReturn = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type SmokeStreamPart = SmokeDoStreamReturn extends {
  stream: ReadableStream<infer P>
}
  ? P
  : never

function mockModel(replyText: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
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

function buildSmokeMemory(): Memory {
  return buildAiChatMemory({ getBackend: () => "memory" })
}

function buildSmokeAgent(model: MockLanguageModelV3, memory: Memory): Agent {
  return new Agent({
    id: "history-smoke",
    name: "History Smoke",
    instructions: "You are a test stand-in for the ai-chat agent.",
    model,
    memory,
  })
}

describe("history routes — real-memory smoke", () => {
  it("lists and replays a turn written through the agent path (fresh-thread auto-create must not throw)", async () => {
    const memory = buildSmokeMemory()
    const agent = buildSmokeAgent(mockModel("HISTORY_SMOKE_REPLY"), memory)

    // First turn on a fresh thread id — the auto-create contract says this
    // must not throw; the thread comes into existence via the write path.
    const output = await agent.stream("HISTORY_SMOKE_PROMPT please remember", {
      memory: { thread: "history-smoke-thread", resource: "user:smoke-sub" },
    })
    const reader = output.textStream.getReader()
    while (!(await reader.read()).done) {
      // drain
    }

    const history = memory as unknown as AiChatHistoryMemory

    // Persistence completes asynchronously after the drain — poll, bounded.
    await vi.waitFor(async () => {
      const outcome = await handleAiChatHistoryListRequest(
        baseInput(history, {
          readJson: async () => ({ resourceId: "user:smoke-sub" }),
        }),
      )
      expect(outcome.status).toBe(200)
      const body = outcome.body as { threads: AiChatHistoryWireThread[] }
      const row = body.threads.find((t) => t.id === "history-smoke-thread")
      expect(row).toBeDefined()
      expect(Number.isNaN(new Date(row!.updatedAt).getTime())).toBe(false)
    })

    const replay = await vi.waitFor(async () => {
      const outcome = await handleAiChatHistoryReplayRequest(
        replayInput(history, {
          readJson: async () => ({
            resourceId: "user:smoke-sub",
            threadId: "history-smoke-thread",
          }),
        }),
      )
      expect(outcome.status).toBe(200)
      const body = outcome.body as { messages: AiChatHistoryWireMessage[] }
      expect(
        body.messages.some((m) => m.text.includes("HISTORY_SMOKE_PROMPT")),
      ).toBe(true)
      expect(
        body.messages.some((m) => m.text.includes("HISTORY_SMOKE_REPLY")),
      ).toBe(true)
      return body
    })

    // Transcript order: the user turn precedes the assistant turn.
    const userIndex = replay.messages.findIndex((m) => m.role === "user")
    const assistantIndex = replay.messages.findIndex(
      (m) => m.role === "assistant",
    )
    expect(userIndex).toBeGreaterThanOrEqual(0)
    expect(assistantIndex).toBeGreaterThan(userIndex)

    // A foreign resource is refused against the REAL memory (R2/R3).
    const foreign = await handleAiChatHistoryReplayRequest(
      replayInput(history, {
        readJson: async () => ({
          resourceId: "user:other-sub",
          threadId: "history-smoke-thread",
        }),
      }),
    )
    expect(foreign.status).toBe(403)
    expect(foreign.body).toEqual({ reason: "thread_forbidden" })

    // Cross-tenant LISTING exclusion (R1's highest-blast-radius branch): a
    // second resource's thread must never appear in the first's page — pins
    // that the real store honors the resourceId filter across @mastra bumps.
    const now = new Date()
    await memory.saveThread({
      thread: {
        id: "foreign-owner-thread",
        resourceId: "user:other-sub",
        title: "Foreign thread",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })
    const smokeListing = await handleAiChatHistoryListRequest(
      baseInput(history, {
        readJson: async () => ({ resourceId: "user:smoke-sub" }),
      }),
    )
    expect(smokeListing.status).toBe(200)
    const smokeIds = (
      smokeListing.body as { threads: AiChatHistoryWireThread[] }
    ).threads.map((t) => t.id)
    expect(smokeIds).toContain("history-smoke-thread")
    expect(smokeIds).not.toContain("foreign-owner-thread")
    const otherListing = await handleAiChatHistoryListRequest(
      baseInput(history, {
        readJson: async () => ({ resourceId: "user:other-sub" }),
      }),
    )
    const otherIds = (
      otherListing.body as { threads: AiChatHistoryWireThread[] }
    ).threads.map((t) => t.id)
    expect(otherIds).toEqual(["foreign-owner-thread"])
  })
})
