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

describe("buildAutoEnrichAgent (U9)", () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetMastraMemoryForTesting } = await import("../memory")
    __resetMastraMemoryForTesting()
  })

  it("has searchVideos + fetchVideoImage in its tool catalog (no lookupBibleVerse)", async () => {
    const { buildAutoEnrichAgent } = await import("./auto-enrich-agent")
    const agent = buildAutoEnrichAgent()
    const tools = await agent.listTools()
    expect(Object.keys(tools).sort()).toEqual(
      ["fetchVideoImageTool", "searchVideosTool"].sort(),
    )
    expect(agent.id).toBe("auto-enrich")
  })

  it("uses the AUTO_ENRICH_PROMPT for instructions", async () => {
    const { buildAutoEnrichAgent } = await import("./auto-enrich-agent")
    const { AUTO_ENRICH_PROMPT } = await import("../prompts")
    const agent = buildAutoEnrichAgent()
    // Mastra Agent exposes the resolved instructions through
    // getInstructions(). For a static prompt the result is the
    // string we passed in (or a system-message object wrapping it).
    const instructions = await agent.getInstructions()
    const text =
      typeof instructions === "string"
        ? instructions
        : JSON.stringify(instructions)
    expect(text).toContain(AUTO_ENRICH_PROMPT.slice(0, 80))
  })
})
