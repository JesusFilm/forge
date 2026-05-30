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

  it("requires a mock session secret in mock mode", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    vi.stubEnv("MANAGER_SESSION_SECRET", "")
    vi.stubEnv("AUTH_ISSUER_URL", "")
    vi.stubEnv("AUTH_MANAGER_CLIENT_ID", "")
    vi.stubEnv("ADMIN_GRAPHQL_URL", "")
    vi.stubEnv("ADMIN_MANAGER_API_KEY", "")
    delete process.env.MANAGER_SESSION_SECRET
    delete process.env.AUTH_ISSUER_URL
    delete process.env.AUTH_MANAGER_CLIENT_ID
    delete process.env.ADMIN_GRAPHQL_URL
    delete process.env.ADMIN_MANAGER_API_KEY
    delete process.env.MANAGER_MOCK_SESSION_SECRET

    await expect(import("./env")).rejects.toThrow(
      "MANAGER_MOCK_SESSION_SECRET is required when MANAGER_DATA_MODE=mock",
    )
  })

  it("allows mock mode without retired CMS settings", async () => {
    stubMockModeEnv()
    const { env } = await import("./env")

    expect(env.MANAGER_DATA_MODE).toBe("mock")
    expect(env.MANAGER_MOCK_DATA_PATH).toBe(".tmp/mock-cms/store.json")
  })

  it("rejects reused Manager API and Mastra callback tokens", async () => {
    stubMockModeEnv()
    vi.stubEnv("MANAGER_API_KEY", "shared-manager-token")
    vi.stubEnv("MANAGER_MASTRA_API_KEY", "shared-manager-token")

    await expect(import("./env")).rejects.toThrow(
      "MANAGER_MASTRA_API_KEY and MANAGER_API_KEY must be different",
    )
  })

  it("rejects reused Manager callback and Mastra service tokens", async () => {
    stubMockModeEnv()
    vi.stubEnv("MANAGER_MASTRA_API_KEY", "shared-mastra-token")
    vi.stubEnv("MASTRA_SERVICE_API_KEY", "shared-mastra-token")

    await expect(import("./env")).rejects.toThrow(
      "MANAGER_MASTRA_API_KEY and MASTRA_SERVICE_API_KEY must be different",
    )
  })

  it("allows Next production builds without runtime Manager auth secrets", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build")
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MANAGER_DATA_MODE", "admin")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)

    const { env } = await import("./env")

    expect(env.NODE_ENV).toBe("production")
    expect(env.MANAGER_DATA_MODE).toBe("admin")
  })

  it("requires the Admin Manager API key in admin backend mode", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server")
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
    vi.stubEnv("ADMIN_MANAGER_API_KEY", "")
    vi.stubEnv("AUTH_MANAGER_SERVICE_CLIENT_ID", "")
    vi.stubEnv("AUTH_MANAGER_SERVICE_CLIENT_SECRET", "")

    await expect(import("./env")).rejects.toThrow(
      "ADMIN_MANAGER_API_KEY or AUTH_MANAGER_SERVICE_CLIENT_ID/AUTH_MANAGER_SERVICE_CLIENT_SECRET is required when Manager auth is enabled",
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

  it("allows admin backend mode with Manager OAuth service credentials", async () => {
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
    vi.stubEnv("AUTH_MANAGER_SERVICE_CLIENT_ID", "jfp_manager_service_local")
    vi.stubEnv("AUTH_MANAGER_SERVICE_CLIENT_SECRET", "service-secret")
    vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example/api/graphql")

    const { env } = await import("./env")

    expect(env.MANAGER_DATA_MODE).toBe("admin")
    expect(env.AUTH_MANAGER_SERVICE_CLIENT_ID).toBe("jfp_manager_service_local")
  })
})
