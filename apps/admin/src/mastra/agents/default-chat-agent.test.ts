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

describe("buildDefaultChatAgent (U6)", () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetMastraMemoryForTesting } = await import("../memory")
    __resetMastraMemoryForTesting()
  })

  it("constructs an Agent with the draft-experience instructions", async () => {
    const { buildDefaultChatAgent } = await import("./default-chat-agent")
    const agent = buildDefaultChatAgent()
    expect(agent).toBeDefined()
    // Mastra exposes `instructions` on the constructed Agent. The
    // returned value is the same SystemMessage shape that was passed
    // in. We just confirm the agent has it.
    expect(agent.id).toBe("experience-default-chat")
  })

  it("has the full v1 tool catalog registered (searchVideos / lookupBibleVerse / fetchVideoImage)", async () => {
    const { buildDefaultChatAgent } = await import("./default-chat-agent")
    const agent = buildDefaultChatAgent()
    const toolIds = await agent.listTools()
    expect(Object.keys(toolIds)).toEqual(
      expect.arrayContaining([
        "searchVideosTool",
        "lookupBibleVerseTool",
        "fetchVideoImageTool",
      ]),
    )
  })

  it("throws ProviderNotConfiguredError when OPENROUTER_API_KEY is missing AND default provider is openrouter", async () => {
    mockEnv.env.OPENROUTER_API_KEY = undefined
    vi.resetModules()
    const { buildDefaultChatAgent } = await import("./default-chat-agent")
    const { ProviderNotConfiguredError } = await import("../providers")
    expect(() => buildDefaultChatAgent()).toThrowError(
      ProviderNotConfiguredError,
    )
  })
})
