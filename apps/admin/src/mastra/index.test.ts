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

vi.mock("@mastra/pg", async () => {
  const actual =
    await vi.importActual<typeof import("@mastra/pg")>("@mastra/pg")
  // These singleton tests construct real Mastra instances, whose
  // PostgresStore lazily dials the database from a background init()
  // (ScoresPG/AgentsPG DDL probes). On the devcontainer that quietly
  // succeeds against the local `db` host; in CI no Postgres exists and
  // every construction surfaces as an unhandled-rejection error
  // (getaddrinfo EAI_AGAIN db). Nothing here asserts storage I/O —
  // only construction/registration surfaces — so init() is stubbed to
  // a resolved no-op while the rest of the store stays real.
  class InitlessPostgresStore extends actual.PostgresStore {
    override async init(): Promise<void> {}
  }
  return { ...actual, PostgresStore: InitlessPostgresStore }
})

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

  describe("module surface", () => {
    it("does not eagerly construct a Mastra instance at module load", async () => {
      // The eager `mastra` export was removed in U2's self-review pass —
      // it triggered Agent + Memory construction at module load, which
      // failed in build-phase contexts where env was not fully populated.
      // Call sites that need a synchronous Mastra value call getMastra()
      // themselves.
      const indexModule = await import("./index")
      expect("mastra" in indexModule).toBe(false)
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
    it("registers the U6/U8/U9 agents, the multi-step workflow agents, and U7 workflow", async () => {
      const { getMastra } = await import("./index")
      const mastra = getMastra()
      // Every plan-defined agent id must resolve.
      expect(mastra.getAgentById("experience-default-chat")).toBeDefined()
      expect(mastra.getAgentById("draft-experience")).toBeDefined()
      expect(mastra.getAgentById("add-section")).toBeDefined()
      expect(mastra.getAgentById("rewrite-copy")).toBeDefined()
      expect(mastra.getAgentById("auto-enrich")).toBeDefined()
      // Multi-step draft workflow agents.
      expect(mastra.getAgentById("experience-planner")).toBeDefined()
      expect(mastra.getAgentById("experience-critic")).toBeDefined()
      expect(mastra.getAgentById("experience-reviser")).toBeDefined()
      // Unknown agent ids still throw — the streaming bridge (U3)
      // relies on this for `agent_not_found` classification.
      expect(() => mastra.getAgentById("not-registered")).toThrow(/not found/i)
    })
  })
})
