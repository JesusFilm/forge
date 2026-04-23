import { afterEach, describe, expect, it, vi } from "vitest"

const { verifyManagerSessionMock } = vi.hoisted(() => ({
  verifyManagerSessionMock: vi.fn(),
}))

vi.mock("@/cms/gateway", () => ({
  registerLiveCmsGatewayAuthHandlers: vi.fn(),
  getCmsGateway: () => ({
    verifyManagerSession: verifyManagerSessionMock,
  }),
}))

describe("manager actor authentication", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
    verifyManagerSessionMock.mockReset()
  })

  it("allows the generic manager API key for actor-authenticated requests", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "live")
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerActorRequest } = await import("./auth")

    const result = await authenticateManagerActorRequest(
      new Request("http://example.test", {
        headers: {
          authorization: "Bearer manager-key",
        },
      }),
    )

    expect(result).toEqual({
      kind: "api_key",
      approvedByUserId: "service:manager-api-key",
    })
  })

  it("rejects the generic manager API key for interactive-only approval requests", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "live")
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerSessionRequest } = await import("./auth")

    const result = await authenticateManagerSessionRequest(
      new Request("http://example.test", {
        headers: {
          authorization: "Bearer manager-key",
        },
      }),
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    await expect((result as Response).json()).resolves.toEqual({
      error: "Interactive Manager session required",
    })
  })

  it("accepts a manager session for interactive-only approval requests", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "live")
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    verifyManagerSessionMock.mockResolvedValue({
      id: 7,
      username: "manager",
      email: "manager@forge.test",
      role: { name: "Manager", type: "manager" },
    })

    const { authenticateManagerSessionRequest } = await import("./auth")

    const result = await authenticateManagerSessionRequest(
      new Request("http://example.test", {
        headers: {
          cookie: "strapi-jwt=valid-token",
        },
      }),
    )

    expect(result).toEqual({
      kind: "session",
      approvedByUserId: "7",
      user: {
        id: 7,
        username: "manager",
        email: "manager@forge.test",
        role: { name: "Manager", type: "manager" },
      },
    })
    expect(verifyManagerSessionMock).toHaveBeenCalledWith("valid-token")
  })

  it("accepts a mock-mode session cookie when the gateway verifies it", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    verifyManagerSessionMock.mockResolvedValue({
      id: 7,
      username: "manager",
      email: "manager@forge.test",
      role: { name: "Manager", type: "manager" },
    })

    const {
      authenticateRequest,
      authenticateManagerOverrideRequest,
      authenticateManagerSessionRequest,
    } = await import("./auth")

    const request = new Request("http://example.test", {
      headers: {
        cookie: "strapi-jwt=mock-session-token",
      },
    })

    await expect(authenticateRequest(request)).resolves.toBeNull()
    await expect(authenticateManagerOverrideRequest(request)).resolves.toEqual({
      kind: "session",
      approvedByUserId: "7",
      user: {
        id: 7,
        username: "manager",
        email: "manager@forge.test",
        role: { name: "Manager", type: "manager" },
      },
    })
    await expect(authenticateManagerSessionRequest(request)).resolves.toEqual({
      kind: "session",
      approvedByUserId: "7",
      user: {
        id: 7,
        username: "manager",
        email: "manager@forge.test",
        role: { name: "Manager", type: "manager" },
      },
    })
    expect(verifyManagerSessionMock).toHaveBeenCalledWith("mock-session-token")
  })
})
