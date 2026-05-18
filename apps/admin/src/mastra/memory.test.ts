import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    DATABASE_URL: "postgresql://forge:forge@db:5432/forge_admin",
    MASTRA_STORAGE_URL: undefined as string | undefined,
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
    postgresStoreSpy.mockClear()
    vi.resetModules()
    // Reset the cached singleton before each test
    const { __resetMastraMemoryForTesting } = await import("./memory")
    __resetMastraMemoryForTesting()
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
})
