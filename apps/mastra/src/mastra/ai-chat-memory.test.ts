import { afterEach, describe, expect, it, vi } from "vitest"

import { InMemoryStore } from "@mastra/core/storage"

import {
  __resetAiChatMemoryForTesting,
  __resetAiChatStorageForTesting,
  AI_CHAT_SCHEMA_NAME,
  AI_CHAT_TITLE_MODEL,
  aiChatMemoryConfigFor,
  buildAiChatMemory,
  getAiChatMemory,
} from "./ai-chat-memory"
import { USER_RESOURCE_PREFIX } from "./ai-chat-thread-ownership"

// ---------------------------------------------------------------------------
// Hoisted env mock. The ai-chat backend defaults to `memory` here so
// module-load construction never builds a PostgresStore unless a test flips it.
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => {
  const state = {
    env: {
      DATABASE_URL: undefined as string | undefined,
    },
    aiChatBackend: "memory" as "postgres" | "memory",
    // Mirror the real `getMastraDatabaseUrl()`: DATABASE_URL with the local
    // fallback so resolution never returns undefined.
    getMastraDatabaseUrl: () =>
      state.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    resolveAiChatMemoryBackend: () => state.aiChatBackend,
  }
  return state
})

vi.mock("../config/env", () => mockEnv)

const postgresStoreSpy = vi.hoisted(() => vi.fn())
vi.mock("@mastra/pg", async () => {
  const actual =
    await vi.importActual<typeof import("@mastra/pg")>("@mastra/pg")
  class SpyingPostgresStore extends actual.PostgresStore {
    constructor(
      options: ConstructorParameters<typeof actual.PostgresStore>[0],
    ) {
      postgresStoreSpy(options)
      super(options)
    }
  }
  return { ...actual, PostgresStore: SpyingPostgresStore }
})

// Passive constructor spy so tests can assert the options Memory receives
// (feat-241: the generateTitle wiring on BOTH ai-chat backend branches).
const memoryCtorSpy = vi.hoisted(() => vi.fn())
vi.mock("@mastra/memory", async () => {
  const actual =
    await vi.importActual<typeof import("@mastra/memory")>("@mastra/memory")
  class SpyingMemory extends actual.Memory {
    constructor(options: ConstructorParameters<typeof actual.Memory>[0]) {
      memoryCtorSpy(options)
      super(options)
    }
  }
  return { ...actual, Memory: SpyingMemory }
})

afterEach(() => {
  __resetAiChatMemoryForTesting()
  __resetAiChatStorageForTesting()
  mockEnv.aiChatBackend = "memory"
  mockEnv.env.DATABASE_URL = undefined
  postgresStoreSpy.mockClear()
  memoryCtorSpy.mockClear()
})

describe("ai-chat memory (feat-208)", () => {
  it("returns a singleton Memory instance", () => {
    const first = getAiChatMemory()
    const second = getAiChatMemory()
    expect(first).toBe(second)
  })

  it("returns a fresh instance after __resetAiChatMemoryForTesting", () => {
    const first = getAiChatMemory()
    __resetAiChatMemoryForTesting()
    expect(getAiChatMemory()).not.toBe(first)
  })

  it("uses an InMemoryStore under the memory backend (local dev / kill-switch path)", () => {
    const memory = buildAiChatMemory({ getBackend: () => "memory" })
    expect(memory.storage).toBeInstanceOf(InMemoryStore)
    expect(postgresStoreSpy).not.toHaveBeenCalled()
  })

  it("uses a PostgresStore in the dedicated ai_chat schema under the postgres backend", () => {
    buildAiChatMemory({ getBackend: () => "postgres" })
    expect(postgresStoreSpy).toHaveBeenCalledTimes(1)
    const options = postgresStoreSpy.mock.calls[0]?.[0] as {
      schemaName?: string
      max?: number
    }
    expect(options.schemaName).toBe("ai_chat")
    expect(options.max).toBe(5)
  })

  it("keeps the ai_chat schema distinct from the mastra schema (drift guard)", () => {
    // The whole point of feat-208's schema choice: ai-chat conversations must
    // never share tables with runtime storage / experience-chat memory.
    expect(AI_CHAT_SCHEMA_NAME).toBe("ai_chat")
    expect(AI_CHAT_SCHEMA_NAME).not.toBe("mastra")
  })

  it("wires top-level generateTitle with the pinned title model on BOTH backends (feat-241, KTD12)", () => {
    // Postgres-branch wiring has no other coverage — the titling behavior
    // tests run on the memory backend only, so this pins the config shape
    // both branches hand the Memory constructor.
    memoryCtorSpy.mockClear()
    buildAiChatMemory({ getBackend: () => "memory" })
    buildAiChatMemory({ getBackend: () => "postgres" })
    expect(memoryCtorSpy).toHaveBeenCalledTimes(2)
    for (const call of memoryCtorSpy.mock.calls) {
      const args = call[0] as {
        options?: { generateTitle?: unknown; threads?: unknown }
      }
      expect(args.options?.generateTitle).toEqual({
        model: AI_CHAT_TITLE_MODEL,
      })
      // The deprecated nesting would throw mid-turn — it must never appear.
      expect(args.options?.threads).toBeUndefined()
    }
  })

  it("honors the injectable backend seam on the singleton path", () => {
    // The default singleton resolves through the mocked env (memory here) —
    // proving getBackend defaults to resolveAiChatMemoryBackend.
    mockEnv.aiChatBackend = "postgres"
    __resetAiChatMemoryForTesting()
    getAiChatMemory()
    expect(postgresStoreSpy).toHaveBeenCalledTimes(1)
  })

  it("does not open a connection at construction time on the postgres path", () => {
    mockEnv.env.DATABASE_URL =
      "postgresql://nobody:nopass@nonexistent-host-7vqf:5432/no_db"
    expect(() =>
      buildAiChatMemory({ getBackend: () => "postgres" }),
    ).not.toThrow()
    mockEnv.env.DATABASE_URL = undefined
  })

  // Adversarial cross-thread isolation against a REAL InMemoryStore-backed
  // Memory. This is the assertion a no-op / identity memory layer would fail:
  // it proves messages written to thread A do not leak into thread B. Both
  // threads MUST be created first — `recall` on a never-created thread throws
  // ("No thread found with id …"), it does not return empty (verified U2 recipe).
  it("keeps messages scoped to their own thread", async () => {
    const memory = buildAiChatMemory({ getBackend: () => "memory" })
    const resourceId = "seeker-test-resource"
    const threadA = "thread-a"
    const threadB = "thread-b"
    const now = new Date()

    await memory.saveThread({
      thread: {
        id: threadA,
        resourceId,
        title: "Thread A",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })
    await memory.saveThread({
      thread: {
        id: threadB,
        resourceId,
        title: "Thread B",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })

    await memory.saveMessages({
      messages: [
        {
          id: "message-a-1",
          role: "user",
          threadId: threadA,
          resourceId,
          createdAt: now,
          content: {
            format: 2,
            parts: [{ type: "text", text: "Who is Jesus?" }],
            content: "Who is Jesus?",
          },
        },
      ],
    })

    const recalledA = await memory.recall({ threadId: threadA, resourceId })
    const recalledB = await memory.recall({ threadId: threadB, resourceId })

    // Exact-count + identity rather than `>= 1`: this is the tighter
    // non-vacuous assertion — it proves thread A holds exactly the message we
    // saved (not stray messages from elsewhere) and thread B holds none.
    expect(recalledA.messages).toHaveLength(1)
    expect(recalledA.messages[0]?.id).toBe("message-a-1")
    expect(recalledB.messages).toHaveLength(0)
  })
})

describe("aiChatMemoryConfigFor (feat-241 KTD12 titling scope)", () => {
  it("returns a bare { thread, resource } config for signed-in resources (titling stays enabled)", () => {
    const resource = `${USER_RESOURCE_PREFIX}oidc-sub-123`
    const config = aiChatMemoryConfigFor("thread-1", resource)
    // toEqual is the discriminator here: an `options` key on the signed-in
    // branch (disabling titling for real users) would fail this exact shape.
    expect(config).toEqual({ thread: "thread-1", resource })
    expect("options" in config).toBe(false)
  })

  it("carries the top-level generateTitle:false override for anonymous and dogfood resources", () => {
    // Fixture set mirrors production non-`user:` resources: anon:* ids and
    // the seeker-dogfood fallback (plus any unknown un-prefixed caller).
    for (const resource of ["anon:4f9d2c", "seeker-dogfood", "unknown"]) {
      const config = aiChatMemoryConfigFor("thread-2", resource)
      expect(config).toEqual({
        thread: "thread-2",
        resource,
        // TOP-LEVEL generateTitle key (KTD12) — the deprecated
        // `threads.generateTitle` nesting throws mid-turn.
        options: { generateTitle: false },
      })
    }
  })
})
