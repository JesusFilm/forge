import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    DATABASE_URL: "postgresql://forge:forge@db:5432/forge_admin",
    MASTRA_STORAGE_URL: undefined as string | undefined,
    // OPENROUTER_API_KEY is required for the registry to build the
    // default-provider-backed agents at construction time. Tests
    // populate a fake key — provider construction is structural here,
    // no network is reached.
    OPENROUTER_API_KEY: "test-key",
    OPENAI_API_KEY: undefined as string | undefined,
    OPENAI_BASE_URL: undefined as string | undefined,
    OLLAMA_BASE_URL: undefined as string | undefined,
    MASTRA_DEFAULT_PROVIDER: undefined as
      | "openrouter"
      | "ollama"
      | "openai"
      | "anthropic"
      | undefined,
  },
}))

vi.mock("@/config/env", () => mockEnv)

describe("apps/admin/src/mastra (singleton)", () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetMastraForTesting } = await import("./index")
    __resetMastraForTesting()
    const { __resetMastraMemoryForTesting } = await import("./memory")
    __resetMastraMemoryForTesting()
  })

  describe("getMastra()", () => {
    it("constructs a Mastra instance without throwing on default env", async () => {
      const { getMastra } = await import("./index")
      const mastra = getMastra()
      expect(mastra).toBeDefined()
    })

    it("returns the same instance on repeated calls (singleton)", async () => {
      const { getMastra } = await import("./index")
      const first = getMastra()
      const second = getMastra()
      expect(first).toBe(second)
    })

    it("returns a fresh instance after __resetMastraForTesting", async () => {
      const { getMastra, __resetMastraForTesting } = await import("./index")
      const first = getMastra()
      __resetMastraForTesting()
      const second = getMastra()
      expect(first).not.toBe(second)
    })
  })

  describe("eager `mastra` export", () => {
    it("exists at module-load time as a Mastra instance", async () => {
      const { mastra } = await import("./index")
      expect(mastra).toBeDefined()
      // The eager export is the FIRST cached instance built at module
      // load. After a test reset, getMastra() builds a fresh cached
      // instance distinct from the eager export — that's expected, the
      // eager export is a snapshot at first import, not a live alias
      // for the cache.
    })
  })

  describe("re-exports", () => {
    it("re-exports getProvider, DEFAULT_PROVIDER_ID, and ProviderNotConfiguredError from ./providers", async () => {
      const indexModule = await import("./index")
      expect(typeof indexModule.getProvider).toBe("function")
      expect(typeof indexModule.DEFAULT_PROVIDER_ID).toBe("string")
      expect(indexModule.ProviderNotConfiguredError).toBeDefined()
    })

    it("re-exports getMastraMemory from ./memory", async () => {
      const indexModule = await import("./index")
      expect(typeof indexModule.getMastraMemory).toBe("function")
    })
  })

  describe("agent registry at U2", () => {
    it("registers the U6/U8/U9 agents and U7 workflow", async () => {
      const { getMastra } = await import("./index")
      const mastra = getMastra()
      // Every plan-defined agent id must resolve.
      expect(mastra.getAgentById("experience-default-chat")).toBeDefined()
      expect(mastra.getAgentById("draft-experience")).toBeDefined()
      expect(mastra.getAgentById("add-section")).toBeDefined()
      expect(mastra.getAgentById("rewrite-copy")).toBeDefined()
      expect(mastra.getAgentById("auto-enrich")).toBeDefined()
      // Unknown agent ids still throw — the streaming bridge (U3)
      // relies on this for `agent_not_found` classification.
      expect(() => mastra.getAgentById("not-registered")).toThrow(/not found/i)
    })
  })
})
