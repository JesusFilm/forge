import { afterEach, describe, expect, it, vi } from "vitest"

const REQUIRED_BASE_ENV = {
  MUX_TOKEN_ID: "mux-token-id",
  MUX_TOKEN_SECRET: "mux-token-secret",
  OPENROUTER_API_KEY: "openrouter-key",
}

function stubMockModeEnv() {
  vi.stubEnv("MANAGER_DATA_MODE", "mock")
  vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
  vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
  vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
  vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
}

describe("manager env mode validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("requires Strapi settings in live mode", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "live")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    delete process.env.STRAPI_URL
    delete process.env.STRAPI_API_TOKEN

    await expect(import("./env")).rejects.toThrow(
      "STRAPI_URL is required when MANAGER_DATA_MODE=live",
    )
  })

  it("requires a mock session secret in mock mode", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    delete process.env.MANAGER_MOCK_SESSION_SECRET

    await expect(import("./env")).rejects.toThrow(
      "MANAGER_MOCK_SESSION_SECRET is required when MANAGER_DATA_MODE=mock",
    )
  })

  it("allows mock mode without Strapi settings", async () => {
    stubMockModeEnv()
    delete process.env.STRAPI_URL
    delete process.env.STRAPI_API_TOKEN

    const { env } = await import("./env")

    expect(env.MANAGER_DATA_MODE).toBe("mock")
    expect(env.MANAGER_MOCK_DATA_PATH).toBe(".tmp/mock-cms/store.json")
  })

  it("rejects reused Manager API and Agentic callback tokens", async () => {
    stubMockModeEnv()
    vi.stubEnv("MANAGER_API_KEY", "shared-manager-token")
    vi.stubEnv("MANAGER_AGENTIC_API_KEY", "shared-manager-token")

    await expect(import("./env")).rejects.toThrow(
      "MANAGER_AGENTIC_API_KEY and MANAGER_API_KEY must be different",
    )
  })

  it("rejects reused Manager callback and Agentic service tokens", async () => {
    stubMockModeEnv()
    vi.stubEnv("MANAGER_AGENTIC_API_KEY", "shared-agentic-token")
    vi.stubEnv("AGENTIC_SERVICE_API_KEY", "shared-agentic-token")

    await expect(import("./env")).rejects.toThrow(
      "MANAGER_AGENTIC_API_KEY and AGENTIC_SERVICE_API_KEY must be different",
    )
  })

  it("rejects reused Agentic operator and Manager API tokens", async () => {
    stubMockModeEnv()
    vi.stubEnv("MANAGER_API_KEY", "shared-operator-token")
    vi.stubEnv("AGENTIC_OPERATOR_API_KEY", "shared-operator-token")

    await expect(import("./env")).rejects.toThrow(
      "AGENTIC_OPERATOR_API_KEY and MANAGER_API_KEY must be different",
    )
  })

  it("rejects reused Agentic operator and service tokens", async () => {
    stubMockModeEnv()
    vi.stubEnv("AGENTIC_OPERATOR_API_KEY", "shared-agentic-token")
    vi.stubEnv("AGENTIC_SERVICE_API_KEY", "shared-agentic-token")

    await expect(import("./env")).rejects.toThrow(
      "AGENTIC_OPERATOR_API_KEY and AGENTIC_SERVICE_API_KEY must be different",
    )
  })

  it("rejects a public Agentic Studio origin in production", async () => {
    stubMockModeEnv()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AGENTIC_STUDIO_ORIGIN", "https://public.example.com")
    vi.stubEnv("AGENTIC_OPERATOR_API_KEY", "operator-token")

    await expect(import("./env")).rejects.toThrow(
      "AGENTIC_STUDIO_ORIGIN must use Railway private networking in production",
    )
  })

  it("allows a Railway private Agentic Studio origin in production", async () => {
    stubMockModeEnv()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv(
      "AGENTIC_STUDIO_ORIGIN",
      "http://agentic-studio.railway.internal:4111",
    )
    vi.stubEnv("AGENTIC_OPERATOR_API_KEY", "operator-token")

    const { env } = await import("./env")

    expect(env.AGENTIC_STUDIO_ORIGIN).toBe(
      "http://agentic-studio.railway.internal:4111",
    )
    expect(env.AGENTIC_OPERATOR_API_KEY).toBe("operator-token")
  })
})
