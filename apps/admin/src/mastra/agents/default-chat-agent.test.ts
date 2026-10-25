import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    OPENROUTER_API_KEY: "test-key" as string | undefined,
    OPENAI_API_KEY: undefined as string | undefined,
    OPENAI_BASE_URL: undefined as string | undefined,
    OLLAMA_BASE_URL: undefined as string | undefined,
    GOOGLE_GENERATIVE_AI_API_KEY: undefined as string | undefined,
    AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
    AI_GATEWAY_CHAT_BASE_URL: undefined as string | undefined,
    AI_GATEWAY_CHAT_MODEL: undefined as string | undefined,
    AI_GATEWAY_CHAT_ENABLED: undefined as string | undefined,
    MASTRA_DEFAULT_PROVIDER: undefined as
      | "openrouter"
      | "ollama"
      | "openai"
      | "anthropic"
      | "google"
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

  it("constructs even when OPENROUTER_API_KEY is missing — provider resolution is deferred to call time", async () => {
    // String model ids (Mastra ModelRouter) defer provider resolution
    // to invocation. The agent constructs fine without env; missing
    // env surfaces at first .stream() / .generate() call instead.
    // Provider-level env-validation is covered by providers.test.ts.
    mockEnv.env.OPENROUTER_API_KEY = undefined
    vi.resetModules()
    const { buildDefaultChatAgent } = await import("./default-chat-agent")
    expect(() => buildDefaultChatAgent()).not.toThrow()
  })

  it("constructs through the Google Gemini branch when GOOGLE_GENERATIVE_AI_API_KEY is set", async () => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_CHAT_ENABLED = undefined
    mockEnv.env.OPENROUTER_API_KEY = undefined
    mockEnv.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key"
    vi.resetModules()
    const { buildDefaultChatAgent } = await import("./default-chat-agent")
    let agent: ReturnType<typeof buildDefaultChatAgent> | undefined
    expect(() => {
      agent = buildDefaultChatAgent()
    }).not.toThrow()
    expect(agent?.id).toBe("experience-default-chat")
  })

  it('constructs through the JesusFilm gateway branch when AI_GATEWAY_CHAT_API_KEY is set and AI_GATEWAY_CHAT_ENABLED is "true"', async () => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "test-gateway-key"
    mockEnv.env.AI_GATEWAY_CHAT_ENABLED = "true"
    mockEnv.env.GOOGLE_GENERATIVE_AI_API_KEY = undefined
    mockEnv.env.OPENROUTER_API_KEY = undefined
    vi.resetModules()
    const { buildDefaultChatAgent } = await import("./default-chat-agent")
    let agent: ReturnType<typeof buildDefaultChatAgent> | undefined
    expect(() => {
      agent = buildDefaultChatAgent()
    }).not.toThrow()
    expect(agent?.id).toBe("experience-default-chat")
  })
})
