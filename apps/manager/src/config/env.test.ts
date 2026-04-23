import { afterEach, describe, expect, it, vi } from "vitest"

const REQUIRED_BASE_ENV = {
  MUX_TOKEN_ID: "mux-token-id",
  MUX_TOKEN_SECRET: "mux-token-secret",
  OPENROUTER_API_KEY: "openrouter-key",
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
    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
    delete process.env.STRAPI_URL
    delete process.env.STRAPI_API_TOKEN

    const { env } = await import("./env")

    expect(env.MANAGER_DATA_MODE).toBe("mock")
    expect(env.MANAGER_MOCK_DATA_PATH).toBe(".tmp/mock-cms/store.json")
  })
})
