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

  describe("buildPlannerAgent", () => {
    it("has no tools (text-only planning)", async () => {
      const { buildPlannerAgent } = await import("./specialized-agents")
      const agent = buildPlannerAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools)).toEqual([])
      expect(agent.id).toBe("experience-planner")
    })
  })

  describe("buildCriticAgent", () => {
    it("has no tools (review-only scope)", async () => {
      const { buildCriticAgent } = await import("./specialized-agents")
      const agent = buildCriticAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools)).toEqual([])
      expect(agent.id).toBe("experience-critic")
    })
  })

  describe("buildReviserAgent", () => {
    it("has the same tool catalog as draft-experience", async () => {
      const { buildReviserAgent } = await import("./specialized-agents")
      const agent = buildReviserAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools).sort()).toEqual(
        [
          "fetchVideoImageTool",
          "lookupBibleVerseTool",
          "searchVideosTool",
        ].sort(),
      )
      expect(agent.id).toBe("experience-reviser")
    })
  })

  describe("buildSkeletonAgent (U3)", () => {
    it("has no tools (structure-only planning)", async () => {
      const { buildSkeletonAgent } = await import("./specialized-agents")
      const agent = buildSkeletonAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools)).toEqual([])
      expect(agent.id).toBe("experience-skeleton")
    })
  })

  describe("buildFillAgent (U3)", () => {
    it("has the same tool catalog as draft-experience", async () => {
      const { buildFillAgent } = await import("./specialized-agents")
      const agent = buildFillAgent()
      const tools = await agent.listTools()
      expect(Object.keys(tools).sort()).toEqual(
        [
          "fetchVideoImageTool",
          "lookupBibleVerseTool",
          "searchVideosTool",
        ].sort(),
      )
      expect(agent.id).toBe("experience-fill")
    })
  })

  describe("workflow agent memory binding (R12)", () => {
    // Structural guard: the planner/critic/reviser factories MUST NOT
    // bind `getMastraMemory()`. R12 requires workflow runs to be
    // memory-less — defense in depth alongside the workflow's
    // `agent.generate(...)` call sites which also omit memory options.
    // Re-introducing `memory: getMastraMemory()` in any of these three
    // factories would silently leak workflow runs into chat history.
    it("planner/critic/reviser factory bodies do not bind getMastraMemory", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./specialized-agents.ts"),
        "utf8",
      )
      for (const fnName of [
        "buildPlannerAgent",
        "buildCriticAgent",
        "buildReviserAgent",
        "buildSkeletonAgent",
        "buildFillAgent",
      ]) {
        const pattern = new RegExp(
          `export function ${fnName}\\([^)]*\\): Agent \\{[\\s\\S]*?^\\}`,
          "m",
        )
        const match = pattern.exec(src)
        expect(match, `${fnName} factory not found in source`).toBeTruthy()
        expect(
          match![0],
          `${fnName} must not call getMastraMemory()`,
        ).not.toMatch(/getMastraMemory\(/)
      }
    })
  })

  describe("buildSpecializedAgents", () => {
    it("returns all eight specialized agents keyed by SpecializedAgentId", async () => {
      const { buildSpecializedAgents } = await import("./specialized-agents")
      const agents = buildSpecializedAgents()
      expect(Object.keys(agents).sort()).toEqual([
        "add-section",
        "draft-experience",
        "experience-critic",
        "experience-fill",
        "experience-planner",
        "experience-reviser",
        "experience-skeleton",
        "rewrite-copy",
      ])
      expect(agents["draft-experience"].id).toBe("draft-experience")
      expect(agents["add-section"].id).toBe("add-section")
      expect(agents["rewrite-copy"].id).toBe("rewrite-copy")
      expect(agents["experience-planner"].id).toBe("experience-planner")
      expect(agents["experience-critic"].id).toBe("experience-critic")
      expect(agents["experience-reviser"].id).toBe("experience-reviser")
      expect(agents["experience-skeleton"].id).toBe("experience-skeleton")
      expect(agents["experience-fill"].id).toBe("experience-fill")
    })
  })
})
