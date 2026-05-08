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

  it("requires Admin GraphQL settings in admin backend mode", async () => {
    vi.stubEnv("MANAGER_BACKEND_MODE", "admin")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    delete process.env.STRAPI_URL
    delete process.env.STRAPI_API_TOKEN
    delete process.env.ADMIN_GRAPHQL_URL

    await expect(import("./env")).rejects.toThrow(
      "ADMIN_GRAPHQL_URL is required when MANAGER_BACKEND_MODE=admin",
    )
  })

  it("requires the Admin manager service key in admin backend mode", async () => {
    vi.stubEnv("MANAGER_BACKEND_MODE", "admin")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example/api/graphql")
    delete process.env.ADMIN_MANAGER_API_KEY
    delete process.env.STRAPI_URL
    delete process.env.STRAPI_API_TOKEN

    await expect(import("./env")).rejects.toThrow(
      "ADMIN_MANAGER_API_KEY is required when MANAGER_BACKEND_MODE=admin",
    )
  })

  it("allows admin backend mode without Strapi settings", async () => {
    vi.stubEnv("MANAGER_BACKEND_MODE", "admin")
    vi.stubEnv("MUX_TOKEN_ID", REQUIRED_BASE_ENV.MUX_TOKEN_ID)
    vi.stubEnv("MUX_TOKEN_SECRET", REQUIRED_BASE_ENV.MUX_TOKEN_SECRET)
    vi.stubEnv("OPENROUTER_API_KEY", REQUIRED_BASE_ENV.OPENROUTER_API_KEY)
    vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example/api/graphql")
    vi.stubEnv("ADMIN_MANAGER_API_KEY", "manager-service-key")
    delete process.env.STRAPI_URL
    delete process.env.STRAPI_API_TOKEN

    const { env } = await import("./env")

    expect(env.MANAGER_BACKEND_MODE).toBe("admin")
    expect(env.ADMIN_GRAPHQL_URL).toBe("https://admin.example/api/graphql")
    expect(env.ADMIN_MANAGER_API_KEY).toBe("manager-service-key")
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
      "AGENTIC_STUDIO_ORIGIN must be the private agentic-studio Railway origin in production",
    )
  })

  it("rejects a non-Studio Railway private origin in production", async () => {
    stubMockModeEnv()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AGENTIC_STUDIO_ORIGIN", "http://agentic.railway.internal:4111")
    vi.stubEnv("AGENTIC_OPERATOR_API_KEY", "operator-token")

    await expect(import("./env")).rejects.toThrow(
      "AGENTIC_STUDIO_ORIGIN must be the private agentic-studio Railway origin in production",
    )
  })

  it("allows a Railway private Agentic Studio origin in production", async () => {
    stubMockModeEnv()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv(
      "AGENTIC_STUDIO_ORIGIN",
      "http://forgeagentic-studio.railway.internal",
    )
    vi.stubEnv("AGENTIC_OPERATOR_API_KEY", "operator-token")

    const { env } = await import("./env")

    expect(env.AGENTIC_STUDIO_ORIGIN).toBe(
      "http://forgeagentic-studio.railway.internal",
    )
    expect(env.AGENTIC_OPERATOR_API_KEY).toBe("operator-token")
  })
})
