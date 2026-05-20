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

  it("requires Manager auth and Admin validation settings for production non-mock mode", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MANAGER_DATA_MODE", "live")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    vi.stubEnv("STRAPI_URL", "https://cms.example")
    vi.stubEnv("STRAPI_API_TOKEN", "strapi-api-token")

    await expect(import("./env")).rejects.toThrow(
      "MANAGER_SESSION_SECRET, AUTH_ISSUER_URL, AUTH_MANAGER_CLIENT_ID, ADMIN_GRAPHQL_URL, ADMIN_MANAGER_API_KEY are required when Manager auth is enabled",
    )
  })

  it("requires the Admin Manager API key in admin backend mode", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "admin")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    vi.stubEnv(
      "MANAGER_SESSION_SECRET",
      "manager-session-secret-change-me-000000",
    )
    vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org")
    vi.stubEnv("AUTH_MANAGER_CLIENT_ID", "jfp_manager_local")
    vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example/api/graphql")

    await expect(import("./env")).rejects.toThrow(
      "ADMIN_MANAGER_API_KEY is required when Manager auth is enabled",
    )
  })

  it("allows admin backend mode with Manager auth and Admin validation settings", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "admin")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    vi.stubEnv(
      "MANAGER_SESSION_SECRET",
      "manager-session-secret-change-me-000000",
    )
    vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org")
    vi.stubEnv("AUTH_MANAGER_CLIENT_ID", "jfp_manager_local")
    vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example/api/graphql")
    vi.stubEnv("ADMIN_MANAGER_API_KEY", "admin-manager-key")

    const { env } = await import("./env")

    expect(env.MANAGER_DATA_MODE).toBe("admin")
    expect(env.ADMIN_MANAGER_API_KEY).toBe("admin-manager-key")
  })
})
