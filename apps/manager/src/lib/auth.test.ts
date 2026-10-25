import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReviewerLanguageGrant } from "./reviewer-session"

const sessionSecret = "manager-session-secret-change-me-000000"

describe("authenticateManagerOverrideRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("accepts the generic manager API key for override approval", async () => {
    stubBaseEnv()
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerOverrideRequest } = await import("./auth")

    const result = await authenticateManagerOverrideRequest(
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

  it("rejects invalid bearer tokens for override approval", async () => {
    stubBaseEnv()
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerOverrideRequest } = await import("./auth")

    const result = await authenticateManagerOverrideRequest(
      new Request("http://example.test", {
        headers: {
          authorization: "Bearer wrong-key",
        },
      }),
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    await expect((result as Response).json()).resolves.toEqual({
      error: "Interactive Manager session or API key required",
    })
  })

  it("accepts a Manager-local OAuth session cookie", async () => {
    stubBaseEnv()
    const { createManagerSessionCookie, MANAGER_SESSION_COOKIE } =
      await import("./manager-session-cookie")
    const token = await createManagerSessionCookie({
      id: "admin-user-123",
      subject: "auth-user-123",
      email: "manager@forge.test",
      name: "Manager User",
      managerRole: "OPERATOR",
      scopes: ["openid", "manager:access"],
    })

    const { authenticateRequest, authenticateManagerOverrideRequest } =
      await import("./auth")

    const request = new Request("http://example.test", {
      headers: {
        cookie: `${MANAGER_SESSION_COOKIE}=${token}`,
      },
    })

    await expect(authenticateRequest(request)).resolves.toBeNull()
    await expect(authenticateManagerOverrideRequest(request)).resolves.toEqual({
      kind: "session",
      approvedByUserId: "admin-user-123",
      user: {
        id: "admin-user-123",
        username: "Manager User",
        email: "manager@forge.test",
        role: { name: "Manager", type: "manager" },
      },
    })
  })

  it("keeps reviewer sessions out of every existing operator guard", async () => {
    stubBaseEnv()
    const { createManagerSessionCookie, MANAGER_SESSION_COOKIE } =
      await import("./manager-session-cookie")
    const reviewerGrant: ReviewerLanguageGrant = {
      id: "grant-es",
      languageId: "language-es",
      languageSlug: "spanish-latin-america",
      languageBcp47: "es-419",
      permittedRubricDimensions: [
        "MEANING_ACCURACY",
        "NATURALNESS",
        "TIMING_READABILITY",
      ],
      specialistCapabilities: { scripture: false, theology: false },
    }
    const token = await createManagerSessionCookie({
      id: "reviewer-1",
      subject: "auth-reviewer-1",
      email: "reviewer@forge.test",
      name: "Spanish Reviewer",
      managerRole: "REVIEWER",
      scopes: ["openid", "manager:access"],
      reviewerLanguageGrants: [reviewerGrant],
    })

    const {
      authenticateInteractiveManagerRequest,
      authenticateInteractiveReviewerRequest,
      authenticateManagerOverrideRequest,
      authenticateRequest,
      hasReviewerLanguageGrant,
      verifyManagerSession,
    } = await import("./auth")
    const request = new Request("http://example.test", {
      headers: { cookie: `${MANAGER_SESSION_COOKIE}=${token}` },
    })

    await expect(verifyManagerSession(token)).resolves.toBeNull()
    const genericResult = await authenticateRequest(request)
    expect(genericResult).toBeInstanceOf(Response)
    if (!(genericResult instanceof Response)) {
      throw new Error("reviewer admitted")
    }
    expect(genericResult.status).toBe(401)

    const interactiveManagerResult =
      await authenticateInteractiveManagerRequest(request)
    expect(interactiveManagerResult).toBeInstanceOf(Response)
    if (!(interactiveManagerResult instanceof Response)) {
      throw new Error("reviewer admitted")
    }
    expect(interactiveManagerResult.status).toBe(401)

    const overrideResult = await authenticateManagerOverrideRequest(request)
    expect(overrideResult).toBeInstanceOf(Response)
    if (!(overrideResult instanceof Response)) {
      throw new Error("reviewer admitted")
    }
    expect(overrideResult.status).toBe(403)

    const reviewer = await authenticateInteractiveReviewerRequest(request)
    expect(reviewer).not.toBeInstanceOf(Response)
    if (reviewer instanceof Response) throw new Error("reviewer denied")
    expect(reviewer.session.reviewerLanguageGrants).toEqual([reviewerGrant])
    expect(
      hasReviewerLanguageGrant(
        reviewer.session,
        "language-es",
        "spanish-latin-america",
      ),
    ).toBe(true)
    expect(
      hasReviewerLanguageGrant(
        reviewer.session,
        "language-es-other",
        "spanish-latin-america",
      ),
    ).toBe(false)
  })

  it("rejects a signed session cookie after Admin Manager membership is revoked", async () => {
    stubBaseEnv({
      mode: "admin",
      authIssuerUrl: "https://auth.jesusfilm.org",
      authManagerClientId: "jfp_manager_local",
      adminGraphqlUrl: "https://admin.example/api/graphql",
      adminManagerApiKey: "admin-manager-key",
    })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            allowed: false,
            user: {
              id: "admin-user-123",
              email: "manager@forge.test",
            },
            managerRole: "OPERATOR",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    const { createManagerSessionCookie, MANAGER_SESSION_COOKIE } =
      await import("./manager-session-cookie")
    const token = await createManagerSessionCookie({
      id: "admin-user-123",
      subject: "auth-user-123",
      email: "manager@forge.test",
      name: "Manager User",
      managerRole: "OPERATOR",
      scopes: ["openid", "manager:access"],
    })

    const {
      authenticateRequest,
      authenticateManagerOverrideRequest,
      verifyManagerSession,
    } = await import("./auth")

    const request = new Request("http://example.test", {
      headers: {
        cookie: `${MANAGER_SESSION_COOKIE}=${token}`,
      },
    })

    await expect(verifyManagerSession(token)).resolves.toBeNull()

    const authResult = await authenticateRequest(request)
    expect(authResult).toBeInstanceOf(Response)
    expect((authResult as Response).status).toBe(401)
    await expect((authResult as Response).json()).resolves.toEqual({
      error: "Authentication required",
    })

    const overrideResult = await authenticateManagerOverrideRequest(request)
    expect(overrideResult).toBeInstanceOf(Response)
    expect((overrideResult as Response).status).toBe(403)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://admin.example/api/manager/session",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer admin-manager-key",
        }),
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "manager@forge.test",
          name: "Manager User",
        }),
      }),
    )
  })

  it("rejects a signed reviewer cookie after its final language grant is revoked", async () => {
    stubBaseEnv({
      mode: "admin",
      authIssuerUrl: "https://auth.jesusfilm.org",
      authManagerClientId: "jfp_manager_local",
      adminGraphqlUrl: "https://admin.example/api/graphql",
      adminManagerApiKey: "admin-manager-key",
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ allowed: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const { createManagerSessionCookie, MANAGER_SESSION_COOKIE } =
      await import("./manager-session-cookie")
    const token = await createManagerSessionCookie({
      id: "reviewer-1",
      subject: "auth-reviewer-1",
      email: "reviewer@forge.test",
      managerRole: "REVIEWER",
      scopes: ["openid", "manager:access"],
      reviewerLanguageGrants: [
        {
          id: "grant-es",
          languageId: "language-es",
          languageSlug: "spanish-latin-america",
          permittedRubricDimensions: ["MEANING_ACCURACY"],
          specialistCapabilities: { scripture: false, theology: false },
        },
      ],
    })
    const { authenticateInteractiveReviewerRequest, verifyReviewerSession } =
      await import("./auth")
    const request = new Request("http://example.test/subtitle-review", {
      headers: { cookie: `${MANAGER_SESSION_COOKIE}=${token}` },
    })

    await expect(verifyReviewerSession(token)).resolves.toBeNull()
    const denial = await authenticateInteractiveReviewerRequest(request)
    expect(denial).toBeInstanceOf(Response)
    expect((denial as Response).status).toBe(404)
  })

  it("revalidates against Admin when the backend override is admin", async () => {
    stubBaseEnv({
      mode: "mock",
      backendMode: "admin",
      authIssuerUrl: "https://auth.jesusfilm.org",
      authManagerClientId: "jfp_manager_local",
      adminGraphqlUrl: "https://admin.example/api/graphql",
      adminManagerApiKey: "admin-manager-key",
    })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ allowed: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const { createManagerSessionCookie } =
      await import("./manager-session-cookie")
    const token = await createManagerSessionCookie({
      id: "admin-user-123",
      subject: "auth-user-123",
      email: "manager@forge.test",
      name: "Manager User",
      managerRole: "OPERATOR",
      scopes: ["openid", "manager:access"],
    })

    const { verifyManagerSession } = await import("./auth")

    await expect(verifyManagerSession(token)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalled()
  })

  it("keeps local mock sessions local when the backend override is mock", async () => {
    stubBaseEnv({ mode: "admin", backendMode: "mock" })
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const { createManagerSessionCookie } =
      await import("./manager-session-cookie")
    const token = await createManagerSessionCookie({
      id: "admin-user-123",
      subject: "auth-user-123",
      email: "manager@forge.test",
      name: "Manager User",
      managerRole: "OPERATOR",
      scopes: ["openid", "manager:access"],
    })

    const { verifyManagerSession } = await import("./auth")

    await expect(verifyManagerSession(token)).resolves.toEqual({
      id: "admin-user-123",
      username: "Manager User",
      email: "manager@forge.test",
      role: { name: "Manager", type: "manager" },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function stubBaseEnv({
  mode = "mock",
  backendMode,
  authIssuerUrl,
  authManagerClientId,
  adminGraphqlUrl,
  adminManagerApiKey,
}: {
  mode?: "admin" | "live" | "mock"
  backendMode?: "admin" | "live" | "mock"
  authIssuerUrl?: string
  authManagerClientId?: string
  adminGraphqlUrl?: string
  adminManagerApiKey?: string
} = {}) {
  vi.stubEnv("MANAGER_DATA_MODE", mode)
  if (backendMode) {
    vi.stubEnv("MANAGER_BACKEND_MODE", backendMode)
  }
  if (mode === "mock") {
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
  }
  if (backendMode === "mock") {
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
  }
  vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
  vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
  vi.stubEnv("MANAGER_SESSION_SECRET", sessionSecret)
  if (authIssuerUrl) vi.stubEnv("AUTH_ISSUER_URL", authIssuerUrl)
  if (authManagerClientId) {
    vi.stubEnv("AUTH_MANAGER_CLIENT_ID", authManagerClientId)
  }
  if (adminGraphqlUrl) vi.stubEnv("ADMIN_GRAPHQL_URL", adminGraphqlUrl)
  if (adminManagerApiKey) {
    vi.stubEnv("ADMIN_MANAGER_API_KEY", adminManagerApiKey)
  }
}
