import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    DATABASE_URL: "postgresql://forge:forge@db:5432/forge_admin",
    MASTRA_STORAGE_URL: undefined as string | undefined,
    AI_GATEWAY_CHAT_BASE_URL: undefined as string | undefined,
    AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
    AI_GATEWAY_EMBEDDINGS_API_KEY: undefined as string | undefined,
    AI_GATEWAY_EMBEDDINGS_MODEL: undefined as string | undefined,
  },
}))

vi.mock("@/config/env", () => mockEnv)

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

describe("apps/admin/src/mastra/memory", () => {
  beforeEach(async () => {
    mockEnv.env.MASTRA_STORAGE_URL = undefined
    mockEnv.env.DATABASE_URL = "postgresql://forge:forge@db:5432/forge_admin"
    mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = undefined
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_EMBEDDINGS_MODEL = undefined
    postgresStoreSpy.mockClear()
    vi.resetModules()
    // Reset the cached singletons before each test
    const {
      __resetMastraMemoryForTesting,
      __resetMastraVectorStoreForTesting,
    } = await import("./memory")
    __resetMastraMemoryForTesting()
    __resetMastraVectorStoreForTesting()
  })

  describe("resolveMastraStorageUrl", () => {
    it("falls back to DATABASE_URL when MASTRA_STORAGE_URL is unset", async () => {
      const { resolveMastraStorageUrl } = await import("./memory")
      expect(resolveMastraStorageUrl()).toBe(
        "postgresql://forge:forge@db:5432/forge_admin",
      )
    })

    it("uses MASTRA_STORAGE_URL when set", async () => {
      mockEnv.env.MASTRA_STORAGE_URL =
        "postgresql://mastra:mastra@db:5432/mastra_storage"
      const { resolveMastraStorageUrl } = await import("./memory")
      expect(resolveMastraStorageUrl()).toBe(
        "postgresql://mastra:mastra@db:5432/mastra_storage",
      )
    })
  })

  describe("buildMastraMemory", () => {
    it("constructs a Memory instance backed by PostgresStore without throwing", async () => {
      const { buildMastraMemory } = await import("./memory")
      const memory = buildMastraMemory()
      expect(memory).toBeDefined()
      // Memory primitive is constructed but no DB connection is
      // opened until first read/write — the spec under test is the
      // construction path, not the storage connect.
    })

    it("passes schemaName: 'mastra' to PostgresStore so memory tables live in the dedicated schema", async () => {
      const { buildMastraMemory } = await import("./memory")
      buildMastraMemory()
      expect(postgresStoreSpy).toHaveBeenCalledTimes(1)
      const options = postgresStoreSpy.mock.calls[0]?.[0] as {
        schemaName?: string
      }
      expect(options.schemaName).toBe("mastra")
    })

    it("does not open a connection at construction time", async () => {
      // If construction opened a connection, this test would block
      // or throw on the bad DB URL below. The assertion is that
      // construction completes synchronously even with a URL no
      // service would actually be reachable on.
      mockEnv.env.MASTRA_STORAGE_URL =
        "postgresql://nobody:nopass@nonexistent-host-7vqf:5432/no_db"
      const { buildMastraMemory } = await import("./memory")
      expect(() => buildMastraMemory()).not.toThrow()
    })
  })

  describe("getMastraMemory", () => {
    it("returns the same instance on repeated calls (singleton)", async () => {
      const { getMastraMemory } = await import("./memory")
      const first = getMastraMemory()
      const second = getMastraMemory()
      expect(first).toBe(second)
    })

    it("returns a fresh instance after __resetMastraMemoryForTesting", async () => {
      const { getMastraMemory, __resetMastraMemoryForTesting } =
        await import("./memory")
      const first = getMastraMemory()
      __resetMastraMemoryForTesting()
      const second = getMastraMemory()
      expect(first).not.toBe(second)
    })
  })

  describe("semantic recall (gateway embeddings)", () => {
    it("is disabled and uses no vector store when no gateway key is set", async () => {
      const { isSemanticRecallEnabled, getMastraVectorStore } =
        await import("./memory")
      expect(isSemanticRecallEnabled()).toBe(false)
      expect(getMastraVectorStore()).toBeNull()
    })

    it("enables recall + a PgVector store when the embedding key is set", async () => {
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const { isSemanticRecallEnabled, getMastraVectorStore } =
        await import("./memory")
      expect(isSemanticRecallEnabled()).toBe(true)
      expect(getMastraVectorStore()).not.toBeNull()
    })

    it("stays DISABLED when only the chat key is set (chat key cannot embed — model-scoped)", async () => {
      // Regression guard for the embedder-403 bug: the gateway's chat
      // (`coding`) key is rejected by the `embeddings` model, so a
      // chat-key fallback must NOT enable recall.
      mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "chat-key"
      const { isSemanticRecallEnabled, getMastraVectorStore } =
        await import("./memory")
      expect(isSemanticRecallEnabled()).toBe(false)
      expect(getMastraVectorStore()).toBeNull()
    })

    it("returns the same PgVector instance on repeated calls (singleton)", async () => {
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const { getMastraVectorStore } = await import("./memory")
      expect(getMastraVectorStore()).toBe(getMastraVectorStore())
    })

    it("builds a recall-enabled Memory without opening a connection at construction time", async () => {
      // Bad URL + embedding key: construction must stay synchronous and
      // not throw — the vector + storage pools open lazily on first I/O,
      // and the embedder is built without a network round-trip.
      mockEnv.env.MASTRA_STORAGE_URL =
        "postgresql://nobody:nopass@nonexistent-host-7vqf:5432/no_db"
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const { buildMastraMemory } = await import("./memory")
      expect(() => buildMastraMemory()).not.toThrow()
      // Storage still lands in the dedicated `mastra` schema on the
      // recall-enabled path.
      const options = postgresStoreSpy.mock.calls[0]?.[0] as {
        schemaName?: string
      }
      expect(options.schemaName).toBe("mastra")
    })
  })
})
