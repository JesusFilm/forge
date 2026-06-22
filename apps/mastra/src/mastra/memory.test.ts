import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InMemoryStore } from "@mastra/core/storage"

import {
  __resetSeekerMemoryForTesting,
  buildSeekerMemory,
  getSeekerMemory,
} from "./memory"

// ---------------------------------------------------------------------------
// Mocks for the experience-chat memory section (U3). The seeker tests below
// do not depend on env or @mastra/pg, so these hoisted mocks are inert for
// them: the seeker store is an InMemoryStore from @mastra/core/storage.
// ---------------------------------------------------------------------------

const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway"

const mockEnv = vi.hoisted(() => {
  const state = {
    env: {
      DATABASE_URL: undefined as string | undefined,
      AI_GATEWAY_CHAT_BASE_URL: undefined as string | undefined,
      AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
      AI_GATEWAY_EMBEDDINGS_API_KEY: undefined as string | undefined,
      AI_GATEWAY_EMBEDDINGS_BASE_URL: undefined as string | undefined,
      AI_GATEWAY_EMBEDDINGS_MODEL: undefined as string | undefined,
    },
    // Mirror the real `getMastraDatabaseUrl()`: DATABASE_URL with the local
    // fallback so resolution never returns undefined.
    getMastraDatabaseUrl: () =>
      state.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
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

afterEach(() => {
  __resetSeekerMemoryForTesting()
})

describe("seeker memory", () => {
  it("returns a singleton Memory instance", () => {
    const first = getSeekerMemory()
    const second = getSeekerMemory()
    expect(first).toBe(second)
  })

  it("is backed by an in-memory store (never a persisted store)", () => {
    // Guards against accidentally wiring a Postgres/PgVector-backed store —
    // the seeker skeleton's memory must physically be unable to persist.
    expect(buildSeekerMemory().storage).toBeInstanceOf(InMemoryStore)
  })

  // Adversarial cross-thread isolation against a REAL InMemoryStore-backed
  // Memory. This is the assertion a no-op / identity memory layer would fail:
  // it proves messages written to thread A do not leak into thread B. Both
  // threads MUST be created first — `recall` on a never-created thread throws
  // ("No thread found with id …"), it does not return empty (verified U2 recipe).
  it("keeps messages scoped to their own thread", async () => {
    const memory = buildSeekerMemory()
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

describe("experience-chat memory (U3)", () => {
  beforeEach(async () => {
    mockEnv.env.DATABASE_URL = undefined
    mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = undefined
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_EMBEDDINGS_BASE_URL = undefined
    mockEnv.env.AI_GATEWAY_EMBEDDINGS_MODEL = undefined
    postgresStoreSpy.mockClear()
    vi.resetModules()
    // Reset the cached singletons in the freshly re-imported module.
    const {
      __resetExperienceChatMemoryForTesting,
      __resetExperienceChatStorageForTesting,
      __resetExperienceChatVectorStoreForTesting,
    } = await import("./memory")
    __resetExperienceChatMemoryForTesting()
    __resetExperienceChatStorageForTesting()
    __resetExperienceChatVectorStoreForTesting()
  })

  describe("resolveExperienceChatStorageUrl", () => {
    it("uses DATABASE_URL when set", async () => {
      mockEnv.env.DATABASE_URL = "postgresql://forge:forge@db:5432/forge_admin"
      const { resolveExperienceChatStorageUrl } = await import("./memory")
      expect(resolveExperienceChatStorageUrl()).toBe(
        "postgresql://forge:forge@db:5432/forge_admin",
      )
    })

    it("falls back to the local default when DATABASE_URL is unset", async () => {
      const { resolveExperienceChatStorageUrl } = await import("./memory")
      expect(resolveExperienceChatStorageUrl()).toBe(LOCAL_DATABASE_URL)
    })
  })

  describe("buildExperienceChatMemory", () => {
    it("constructs a Memory instance backed by PostgresStore without throwing", async () => {
      const { buildExperienceChatMemory } = await import("./memory")
      const memory = buildExperienceChatMemory()
      expect(memory).toBeDefined()
      // Memory is constructed but no DB connection is opened until first
      // read/write — the spec under test is the construction path.
    })

    it("passes schemaName: 'mastra' to PostgresStore so memory tables live in the dedicated schema", async () => {
      const { buildExperienceChatMemory } = await import("./memory")
      buildExperienceChatMemory()
      expect(postgresStoreSpy).toHaveBeenCalledTimes(1)
      const options = postgresStoreSpy.mock.calls[0]?.[0] as {
        schemaName?: string
        max?: number
      }
      expect(options.schemaName).toBe("mastra")
      expect(options.max).toBe(5)
    })

    it("does not open a connection at construction time", async () => {
      // If construction opened a connection, this test would block or throw
      // on the bad DB URL below. Construction must complete synchronously even
      // with a URL no service would be reachable on.
      mockEnv.env.DATABASE_URL =
        "postgresql://nobody:nopass@nonexistent-host-7vqf:5432/no_db"
      const { buildExperienceChatMemory } = await import("./memory")
      expect(() => buildExperienceChatMemory()).not.toThrow()
    })
  })

  describe("getExperienceChatMemory", () => {
    it("returns the same instance on repeated calls (singleton)", async () => {
      const { getExperienceChatMemory } = await import("./memory")
      const first = getExperienceChatMemory()
      const second = getExperienceChatMemory()
      expect(first).toBe(second)
    })

    it("returns a fresh instance after __resetExperienceChatMemoryForTesting", async () => {
      const { getExperienceChatMemory, __resetExperienceChatMemoryForTesting } =
        await import("./memory")
      const first = getExperienceChatMemory()
      __resetExperienceChatMemoryForTesting()
      const second = getExperienceChatMemory()
      expect(first).not.toBe(second)
    })
  })

  describe("semantic recall (gateway embeddings)", () => {
    it("is disabled and uses no vector store when no gateway key is set", async () => {
      const {
        isExperienceChatSemanticRecallEnabled,
        getExperienceChatVectorStore,
      } = await import("./memory")
      expect(isExperienceChatSemanticRecallEnabled()).toBe(false)
      expect(getExperienceChatVectorStore()).toBeNull()
    })

    it("enables recall + a PgVector store when the embedding key is set", async () => {
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const {
        isExperienceChatSemanticRecallEnabled,
        getExperienceChatVectorStore,
      } = await import("./memory")
      expect(isExperienceChatSemanticRecallEnabled()).toBe(true)
      expect(getExperienceChatVectorStore()).not.toBeNull()
    })

    it("stays DISABLED when only the chat key is set (chat key cannot embed — model-scoped)", async () => {
      // Regression guard for the embedder-403 bug: the gateway's chat
      // (`coding`) key is rejected by the `embeddings` model, so a chat-key
      // fallback must NOT enable recall.
      mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "chat-key"
      const {
        isExperienceChatSemanticRecallEnabled,
        getExperienceChatVectorStore,
      } = await import("./memory")
      expect(isExperienceChatSemanticRecallEnabled()).toBe(false)
      expect(getExperienceChatVectorStore()).toBeNull()
    })

    it("returns the same PgVector instance on repeated calls (singleton)", async () => {
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const { getExperienceChatVectorStore } = await import("./memory")
      expect(getExperienceChatVectorStore()).toBe(
        getExperienceChatVectorStore(),
      )
    })

    it("builds a recall-enabled Memory without opening a connection at construction time", async () => {
      // Bad URL + embedding key: construction must stay synchronous and not
      // throw — the vector + storage pools open lazily on first I/O, and the
      // embedder is built without a network round-trip.
      mockEnv.env.DATABASE_URL =
        "postgresql://nobody:nopass@nonexistent-host-7vqf:5432/no_db"
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const { buildExperienceChatMemory } = await import("./memory")
      expect(() => buildExperienceChatMemory()).not.toThrow()
      // Storage still lands in the dedicated `mastra` schema on the
      // recall-enabled path.
      const options = postgresStoreSpy.mock.calls[0]?.[0] as {
        schemaName?: string
      }
      expect(options.schemaName).toBe("mastra")
    })
  })
})
