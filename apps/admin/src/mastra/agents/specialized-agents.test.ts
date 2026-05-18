import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
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
    DATABASE_URL: "postgresql://forge:forge@db:5432/forge_admin",
    MASTRA_STORAGE_URL: undefined as string | undefined,
  },
}))

vi.mock("@/config/env", () => mockEnv)

describe("specialized agents (U8)", () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetMastraMemoryForTesting } = await import("../memory")
    __resetMastraMemoryForTesting()
  })

  describe("buildDraftExperienceAgent", () => {
    it("has the full tool catalog", async () => {
      const { buildDraftExperienceAgent } = await import("./specialized-agents")
      const agent = buildDraftExperienceAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools).sort()).toEqual(
        [
          "fetchVideoImageTool",
          "lookupBibleVerseTool",
          "searchVideosTool",
        ].sort(),
      )
      expect(agent.id).toBe("draft-experience")
    })
  })

  describe("buildAddSectionAgent", () => {
    it("only has searchVideos in its tool catalog", async () => {
      const { buildAddSectionAgent } = await import("./specialized-agents")
      const agent = buildAddSectionAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools)).toEqual(["searchVideosTool"])
      expect(agent.id).toBe("add-section")
    })
  })

  describe("buildRewriteCopyAgent", () => {
    it("has no tools (text-only edit scope)", async () => {
      const { buildRewriteCopyAgent } = await import("./specialized-agents")
      const agent = buildRewriteCopyAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools)).toEqual([])
      expect(agent.id).toBe("rewrite-copy")
    })
  })

  describe("buildSpecializedAgents", () => {
    it("returns the three specialized agents keyed by SpecializedAgentId", async () => {
      const { buildSpecializedAgents } = await import("./specialized-agents")
      const agents = buildSpecializedAgents()
      expect(Object.keys(agents).sort()).toEqual([
        "add-section",
        "draft-experience",
        "rewrite-copy",
      ])
      expect(agents["draft-experience"].id).toBe("draft-experience")
      expect(agents["add-section"].id).toBe("add-section")
      expect(agents["rewrite-copy"].id).toBe("rewrite-copy")
    })
  })
})
