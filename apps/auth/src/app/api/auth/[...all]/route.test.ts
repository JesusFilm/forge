import { beforeEach, describe, expect, it, vi } from "vitest"

const authPost = vi.fn()
const authGet = vi.fn(async (_request: unknown) => Response.json({ ok: true }))
const rateLimitAuthRoute = vi.fn(async (_input: unknown) => ({
  allowed: true,
  source: "local",
}))
const signUpEmail = vi.fn()
const getSession = vi.fn()
const accountUpsert = vi.fn()
const canRedeemAgentLoginHandle = vi.fn(
  async (_prisma: unknown, _input: unknown) => false,
)
const decideChangelogGrant = vi.fn()
const findOAuthClient = vi.fn()

vi.mock("@/auth/config", () => ({
  auth: {
    api: {
      getSession: (input: unknown) => getSession(input),
      signUpEmail: (...args: unknown[]) => signUpEmail(...args),
    },
  },
  authRouteHandlers: {
    GET: (request: unknown) => authGet(request),
    POST: (...args: unknown[]) => authPost(...args),
    PATCH: vi.fn(async () => Response.json({ ok: true })),
    PUT: vi.fn(async () => Response.json({ ok: true })),
    DELETE: vi.fn(async () => Response.json({ ok: true })),
  },
}))

vi.mock("@/db/client", () => ({
  prisma: {
    $transaction: vi.fn(async (callback) =>
      callback({
        account: {
          upsert: accountUpsert,
        },
        user: {
          findFirst: vi.fn(async () => ({ id: "user_123" })),
          update: vi.fn(),
        },
      }),
    ),
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    appEnvironment: {
      findUnique: vi.fn(),
    },
    oauthClient: {
      findUnique: (...args: unknown[]) => findOAuthClient(...args),
    },
  },
}))

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: (input: unknown) => rateLimitAuthRoute(input),
}))

vi.mock("@/services/agent-login.service", () => ({
  canRedeemAgentLoginHandle: (prisma: unknown, input: unknown) =>
    canRedeemAgentLoginHandle(prisma, input),
  isAgentLoginHandle: (value: string) =>
    value.trim().toLowerCase().endsWith("@agent-login.jesusfilm.internal"),
}))

vi.mock("@/services/changelog-oauth-grant.service", () => ({
  createChangelogOAuthGrantDecision: (input: unknown) =>
    decideChangelogGrant(input),
}))

vi.mock("@/auth/firebase-rest", () => ({
  signInWithFirebasePassword: vi.fn(async () => null),
}))

vi.mock("@/auth/firebase-admin", () => ({
  firebaseUserExistsByEmail: vi.fn(async () => false),
  verifyFirebaseIdToken: vi.fn(async () => null),
}))

describe("Auth route wrapper", () => {
  beforeEach(() => {
    authGet.mockReset()
    authGet.mockResolvedValue(Response.json({ ok: true }))
    authPost.mockReset()
    getSession.mockReset()
    getSession.mockResolvedValue(null)
    canRedeemAgentLoginHandle.mockReset()
    canRedeemAgentLoginHandle.mockResolvedValue(false)
    rateLimitAuthRoute.mockReset()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    signUpEmail.mockReset()
    accountUpsert.mockReset()
    decideChangelogGrant.mockReset()
    findOAuthClient.mockReset()
    vi.unstubAllEnvs()
  })

  it("normalizes implicit web loopback DCR clients to the native application type", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ client_id: "claude_dynamic" }),
    )
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude Code",
          redirect_uris: ["http://localhost:3118/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "register"] }) },
    )

    expect(response.status).toBe(200)
    const forwarded = authPost.mock.calls[0]?.[0] as Request
    await expect(forwarded.json()).resolves.toMatchObject({
      application_type: "native",
      redirect_uris: ["http://localhost:3118/callback"],
      token_endpoint_auth_method: "none",
    })
  })

  it.each([
    {
      name: "an explicit web client",
      body: {
        application_type: "web",
        redirect_uris: ["http://localhost:3118/callback"],
      },
    },
    {
      name: "an explicit confidential client",
      body: {
        redirect_uris: ["http://localhost:3118/callback"],
        token_endpoint_auth_method: "client_secret_basic",
      },
    },
    {
      name: "a public HTTP redirect",
      body: { redirect_uris: ["http://example.com/callback"] },
    },
    {
      name: "mixed loopback and public redirects",
      body: {
        redirect_uris: [
          "http://127.0.0.1:3118/callback",
          "https://example.com/callback",
        ],
      },
    },
    {
      name: "an empty redirect list",
      body: { redirect_uris: [] },
    },
  ])("rejects $name before registration", async ({ body }) => {
    authPost.mockResolvedValueOnce(Response.json({ client_id: "dynamic" }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ all: ["oauth2", "register"] }) },
    )

    expect(response.status).toBe(400)
    expect(authPost).not.toHaveBeenCalled()
  })

  it("leaves authenticated registration policy to the provider", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "user_123" } })
    authPost.mockResolvedValueOnce(Response.json({ client_id: "managed" }))
    const body = {
      application_type: "web",
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "client_secret_basic",
    }
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ all: ["oauth2", "register"] }) },
    )

    expect(response.status).toBe(200)
    const forwarded = authPost.mock.calls[0]?.[0] as Request
    await expect(forwarded.json()).resolves.toEqual(body)
  })

  it("accepts an explicit native public client and requires PKCE", async () => {
    authPost.mockResolvedValueOnce(Response.json({ client_id: "dynamic" }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          application_type: "native",
          redirect_uris: ["http://localhost:3118/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "register"] }) },
    )

    expect(response.status).toBe(200)
    const forwarded = authPost.mock.calls[0]?.[0] as Request
    await expect(forwarded.json()).resolves.toMatchObject({
      application_type: "native",
      require_pkce: true,
      token_endpoint_auth_method: "none",
    })
  })

  it.each([
    {
      name: "a non-JSON body",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:3118/callback"],
      }),
    },
    {
      name: "malformed JSON",
      headers: { "content-type": "application/json" },
      body: "{",
    },
    {
      name: "PKCE explicitly disabled",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:3118/callback"],
        require_pkce: false,
      }),
    },
    {
      name: "a private-use redirect",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["forge://oauth/callback"] }),
    },
    {
      name: "an HTTPS loopback redirect",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        application_type: "native",
        redirect_uris: ["https://localhost:3118/callback"],
      }),
    },
    {
      name: "an internal resource",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:3118/callback"],
        resources: ["https://admin.jesusfilm.org/api/manager/session"],
      }),
    },
    {
      name: "an unknown resource",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:3118/callback"],
        resources: ["https://unknown.example/mcp"],
      }),
    },
    {
      name: "a non-public scope",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:3118/callback"],
        scope: "openid tokens:manage",
      }),
    },
  ])("rejects $name without invoking the provider", async (testCase) => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/register", {
        method: "POST",
        headers: testCase.headers,
        body: testCase.body,
      }),
      { params: Promise.resolve({ all: ["oauth2", "register"] }) },
    )

    expect(response.status).toBe(400)
    expect(authPost).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_client_metadata",
    })
  })

  it.each(["http://127.0.0.1:49173/callback", "http://[::1]:49173/callback"])(
    "normalizes implicit loopback redirect %s",
    async (redirectUri) => {
      authPost.mockResolvedValueOnce(Response.json({ client_id: "dynamic" }))
      const { POST } = await import("./route")
      await POST(
        new Request("http://localhost:3004/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ redirect_uris: [redirectUri] }),
        }),
        { params: Promise.resolve({ all: ["oauth2", "register"] }) },
      )

      const forwarded = authPost.mock.calls[0]?.[0] as Request
      await expect(forwarded.json()).resolves.toEqual({
        application_type: "native",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [redirectUri],
        require_pkce: true,
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      })
    },
  )

  it("rejects oversized DCR registration bodies case-insensitively", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "Application/JSON" },
        body: JSON.stringify({ padding: "x".repeat(64 * 1024) }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "register"] }) },
    )

    expect(response.status).toBe(413)
    expect(authPost).not.toHaveBeenCalled()
  })

  it("downscopes an authenticated Changelog authorize request before the provider sees it", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: true,
      scopes: ["openid", "changelog:read"],
      target: {
        dynamicClient: true,
        environmentKind: "local",
        environmentId: "env_local",
        resource: "http://localhost:3000/mcp",
      },
    })
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=codex_dynamic&redirect_uri=http%3A%2F%2Flocalhost%3A9876%2Fcallback&scope=openid+changelog%3Aread+changelog%3Aadmin&resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(200)
    const forwarded = authGet.mock.calls[0]?.[0] as Request
    const forwardedUrl = new URL(forwarded.url)
    expect(forwardedUrl.searchParams.get("scope")).toBe("openid changelog:read")
    expect(forwardedUrl.searchParams.getAll("resource")).toEqual([
      "http://localhost:3000/mcp",
    ])
  })

  it("routes an explicit Admin resource before inspecting Changelog scopes", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    authGet.mockResolvedValueOnce(Response.json({ ok: true }))
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=codex_dynamic&scope=openid+experience%3Aread+changelog%3Aadmin&resource=https%3A%2F%2Fadmin.jesusfilm.org%2Fmcp",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(200)
    expect(decideChangelogGrant).not.toHaveBeenCalled()
    const forwarded = authGet.mock.calls[0]?.[0] as Request
    expect(new URL(forwarded.url).searchParams.getAll("resource")).toEqual([
      "https://admin.jesusfilm.org/mcp",
    ])
  })

  it.each([
    {
      name: "no resource with global scopes",
      query:
        "scope=openid+admin%3Aaccess+manager%3Aaccess+tokens%3Amanage+changelog%3Aread",
      dynamic: true,
    },
    {
      name: "multiple resources",
      query:
        "resource=https%3A%2F%2Fadmin.jesusfilm.org%2Fmcp&resource=https%3A%2F%2Fchangelog.jesusfilm.org%2Fmcp",
      dynamic: false,
    },
    {
      name: "an internal resource",
      query:
        "resource=https%3A%2F%2Fadmin.jesusfilm.org%2Fapi%2Fmanager%2Fsession",
      dynamic: false,
    },
    {
      name: "an unknown resource",
      query: "resource=https%3A%2F%2Funknown.example%2Fmcp",
      dynamic: false,
    },
  ])(
    "rejects $name without an authorization continuation",
    async (testCase) => {
      getSession.mockResolvedValueOnce({
        user: { id: "user_123", membershipStatus: "ACTIVE" },
      })
      if (testCase.dynamic) {
        findOAuthClient.mockResolvedValueOnce({
          clientId: "codex_dynamic",
          disabled: false,
        })
      }
      const { GET } = await import("./route")
      const response = await GET(
        new Request(
          `http://localhost:3004/api/auth/oauth2/authorize?client_id=codex_dynamic&${testCase.query}`,
        ),
        { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_target",
      })
      expect(authGet).not.toHaveBeenCalled()
      expect(decideChangelogGrant).not.toHaveBeenCalled()
    },
  )

  it("adds the canonical native resource for a seeded Changelog client", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: true,
      scopes: ["openid", "changelog:read"],
      target: {
        dynamicClient: false,
        environmentKind: "local",
        environmentId: "env_local",
        resource: null,
      },
    })
    const { GET } = await import("./route")
    await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_changelog_local&scope=openid+changelog%3Aread",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    const forwarded = authGet.mock.calls[0]?.[0] as Request
    expect(new URL(forwarded.url).searchParams.getAll("resource")).toEqual([
      "http://localhost:3000/mcp",
    ])
  })

  it("uses seeded defaults when a Changelog client omits scope", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: true,
      scopes: ["openid", "profile:read", "email:read", "membership:read"],
      target: {
        dynamicClient: false,
        environmentKind: "local",
        environmentId: "env_local",
        resource: null,
      },
    })
    const { GET } = await import("./route")
    await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_changelog_local",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(decideChangelogGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedScopes: [
          "openid",
          "profile:read",
          "email:read",
          "membership:read",
          "changelog:read",
          "changelog:submit",
          "changelog:admin",
        ],
      }),
    )
    const forwarded = authGet.mock.calls[0]?.[0] as Request
    expect(new URL(forwarded.url).searchParams.get("scope")).toBe(
      "openid profile:read email:read membership:read",
    )
  })

  it("returns a no-store OAuth denial without invoking the provider", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: false,
      reason: "changelog_access_denied",
    })
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=codex_dynamic&scope=changelog%3Aread&resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "access_denied",
      error_description: "Changelog access is not available.",
    })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(authGet).not.toHaveBeenCalled()
  })

  it("returns invalid_target for an invalid Changelog resource", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: false,
      reason: "invalid_changelog_target",
    })
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=codex_dynamic&scope=changelog%3Aread&resource=https%3A%2F%2Fexample.test%2Fmcp",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_target",
      error_description: "The requested resource is invalid.",
    })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(authGet).not.toHaveBeenCalled()
  })

  it("redirects a trusted client denial with OAuth state", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: false,
      reason: "changelog_access_denied",
    })
    findOAuthClient.mockResolvedValueOnce({
      disabled: false,
      redirectUris: ["http://127.0.0.1:9876/callback"],
    })
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=codex_dynamic&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&state=opaque-state&scope=changelog%3Aread&resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.origin + location.pathname).toBe(
      "http://127.0.0.1:9876/callback",
    )
    expect(location.searchParams.get("error")).toBe("access_denied")
    expect(location.searchParams.get("state")).toBe("opaque-state")
    expect(location.searchParams.get("iss")).toBe(
      "http://localhost:3004/api/auth",
    )
    expect(authGet).not.toHaveBeenCalled()
  })

  it("redirects invalid_target to a trusted client with OAuth state", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: false,
      reason: "invalid_changelog_target",
    })
    findOAuthClient.mockResolvedValueOnce({
      disabled: false,
      redirectUris: ["http://127.0.0.1:9876/callback"],
    })
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=codex_dynamic&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&state=opaque-state&scope=changelog%3Aread&resource=https%3A%2F%2Fexample.test%2Fmcp",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.searchParams.get("error")).toBe("invalid_target")
    expect(location.searchParams.get("error_description")).toBe(
      "The requested resource is invalid.",
    )
    expect(location.searchParams.get("state")).toBe("opaque-state")
    expect(authGet).not.toHaveBeenCalled()
  })

  it("revalidates the signed consent continuation before native code creation", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: false,
      reason: "changelog_grant_changed",
    })
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accept: true,
          oauth_query:
            "client_id=codex_dynamic&scope=openid+changelog%3Aread&resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp&sig=signed",
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "consent"] }) },
    )

    expect(response.status).toBe(403)
    expect(authPost).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: "the available scopes narrowed",
      requestedScopes: "openid changelog:read changelog:admin",
      decidedScopes: ["openid", "changelog:read"],
      decidedResource: "http://localhost:3000/mcp",
      environmentKind: "local" as const,
    },
    {
      name: "the bound resource changed",
      requestedScopes: "openid changelog:read",
      decidedScopes: ["openid", "changelog:read"],
      decidedResource: "https://changelog.jesusfilm.org/mcp",
      environmentKind: "production" as const,
    },
  ])("rejects signed consent when $name", async (testCase) => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: true,
      scopes: testCase.decidedScopes,
      target: {
        dynamicClient: true,
        environmentKind: testCase.environmentKind,
        environmentId: `env_${testCase.environmentKind}`,
        resource: testCase.decidedResource,
      },
    })
    const oauthQuery = new URLSearchParams({
      client_id: "codex_dynamic",
      scope: testCase.requestedScopes,
      resource: "http://localhost:3000/mcp",
      sig: "signed",
    })
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accept: true,
          oauth_query: oauthQuery.toString(),
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "consent"] }) },
    )

    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(authPost).not.toHaveBeenCalled()
  })

  it("forwards an unchanged signed consent after successful revalidation", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "user_123", membershipStatus: "ACTIVE" },
    })
    decideChangelogGrant.mockResolvedValueOnce({
      allowed: true,
      scopes: ["openid", "changelog:read"],
      target: {
        dynamicClient: true,
        environmentKind: "local",
        environmentId: "env_local",
        resource: "http://localhost:3000/mcp",
      },
    })
    authPost.mockResolvedValueOnce(Response.json({ url: "http://callback" }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accept: true,
          oauth_query:
            "client_id=codex_dynamic&scope=openid+changelog%3Aread&resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp&sig=signed",
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "consent"] }) },
    )

    expect(response.status).toBe(200)
    expect(authPost).toHaveBeenCalledOnce()
  })

  it("keeps native OAuth token responses out of caches", async () => {
    authPost.mockResolvedValueOnce(Response.json({ access_token: "redacted" }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/oauth2/token", {
        method: "POST",
      }),
      { params: Promise.resolve({ all: ["oauth2", "token"] }) },
    )

    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("pragma")).toBe("no-cache")
  })

  it("blocks malformed email signup", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-up/email", {
        method: "POST",
      }),
      { params: Promise.resolve({ all: ["sign-up", "email"] }) },
    )

    expect(response.status).toBe(404)
    expect(authPost).not.toHaveBeenCalled()
  })

  it("returns a generic sign-in message when email signup already exists", async () => {
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "user_123",
    } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "USER@example.com" }),
      }),
      { params: Promise.resolve({ all: ["sign-up", "email"] }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "An account already exists for that email. Sign in to continue.",
    })
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      select: { id: true },
    })
    expect(authPost).not.toHaveBeenCalled()
  })

  it("returns the same generic sign-in message for legacy Firebase accounts", async () => {
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null)
    const { firebaseUserExistsByEmail } = await import("@/auth/firebase-admin")
    vi.mocked(firebaseUserExistsByEmail).mockResolvedValueOnce(true)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "LEGACY@example.com" }),
      }),
      { params: Promise.resolve({ all: ["sign-up", "email"] }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "An account already exists for that email. Sign in to continue.",
    })
    expect(firebaseUserExistsByEmail).toHaveBeenCalledWith("legacy@example.com")
    expect(authPost).not.toHaveBeenCalled()
  })

  it("allows email signup for new emails", async () => {
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null)
    authPost.mockResolvedValueOnce(
      Response.json(
        { redirect: true },
        { headers: { "set-cookie": "better-auth.session=abc; Path=/" } },
      ),
    )

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "new@example.com",
          password: "correct horse battery staple",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-up", "email"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      email: "new@example.com",
      name: "new",
      password: "correct horse battery staple",
    })
  })

  it("forwards OAuth continuation through email signup", async () => {
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null)
    authPost.mockResolvedValueOnce(
      Response.json(
        { redirect: true },
        { headers: { "set-cookie": "better-auth.session=abc; Path=/" } },
      ),
    )

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email: "NEW@example.com",
          oauth_query: "client_id=jfp_web_production&sig=signed",
          password: "correct horse battery staple",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-up", "email"] }) },
    )

    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      callbackURL:
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_web_production&sig=signed",
      email: "new@example.com",
    })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_web_production&sig=signed",
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_auth_last_login_method=email",
    )
  })

  it("allows trusted watch callbacks through email signup", async () => {
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null)
    authPost.mockResolvedValueOnce(
      Response.json(
        { redirect: true },
        { headers: { "set-cookie": "better-auth.session=abc; Path=/" } },
      ),
    )

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callbackURL: "http://localhost:3000/watch/jesus/english",
          email: "NEW@example.com",
          password: "correct horse battery staple",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-up", "email"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      callbackURL: "http://localhost:3000/watch/jesus/english",
      email: "new@example.com",
    })
  })

  it("strips unsafe watch API callbacks from email signup", async () => {
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null)
    authPost.mockResolvedValueOnce(Response.json({ ok: true }))

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callbackURL:
            "http://localhost:3000/watch/api/download?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
          email: "new@example.com",
          name: "New Viewer",
          password: "correct horse battery staple",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-up", "email"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.not.toHaveProperty(
      "callbackURL",
    )
  })

  it("passes unrelated auth routes through to Better Auth", async () => {
    authPost.mockResolvedValueOnce(Response.json({ ok: true }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-out", {
        method: "POST",
      }),
      { params: Promise.resolve({ all: ["sign-out"] }) },
    )

    expect(response.status).toBe(200)
    expect(authPost).toHaveBeenCalledOnce()
  })

  it("forwards OAuth continuation as callbackURL through social sign-in", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ url: "https://google.test" }),
    )
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          oauth_query: "client_id=jfp_admin_local&sig=signed",
          provider: "google",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "social"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      callbackURL:
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_local&sig=signed",
      errorCallbackURL:
        "http://localhost:3004/login?client_id=jfp_admin_local&sig=signed",
      provider: "google",
    })
  })

  it("consumes interactive OAuth prompts after social sign-in", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ url: "https://google.test" }),
    )
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          oauth_query:
            "client_id=jfp_manager_production&prompt=login&sig=signed",
          provider: "google",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "social"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      callbackURL:
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_manager_production&sig=signed",
      errorCallbackURL:
        "http://localhost:3004/login?client_id=jfp_manager_production&prompt=login&sig=signed",
      provider: "google",
    })
  })

  it("returns OAuth social failures to login without exposing method hints", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ url: "https://google.test" }),
    )
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "USER@example.com",
          expected_login_method: "google",
          oauth_query: "client_id=jfp_admin_local&sig=signed",
          provider: "google",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "social"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    const forwardedBody = (await forwardedRequest.json()) as Record<
      string,
      unknown
    >
    expect(forwardedBody).toMatchObject({
      callbackURL:
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_local&sig=signed",
      errorCallbackURL:
        "http://localhost:3004/login?client_id=jfp_admin_local&sig=signed",
      provider: "google",
    })
    expect(forwardedBody).not.toHaveProperty("email")
    expect(forwardedBody).not.toHaveProperty("expected_login_method")
    expect(forwardedBody).not.toHaveProperty("oauth_query")
  })

  it("forwards valid web watch callbacks through social sign-in", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ url: "https://google.test" }),
    )
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callbackURL: "http://localhost:3000/watch/jesus/english",
          provider: "google",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "social"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      callbackURL: "http://localhost:3000/watch/jesus/english",
      provider: "google",
    })
  })

  it("returns the configured provider for an existing social account", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client")
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret")
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      accounts: [{ providerId: "google" }],
    } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/login-method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "USER@example.com",
          oauth_query: "client_id=jfp_admin_local&sig=signed",
        }),
      }),
      { params: Promise.resolve({ all: ["login-method"] }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      method: "provider",
      provider: "google",
    })
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      select: {
        accounts: {
          select: { providerId: true },
        },
      },
    })
  })

  it("falls back to password when the account has no configured social provider", async () => {
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      accounts: [{ providerId: "credential" }, { providerId: "firebase" }],
    } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/login-method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      }),
      { params: Promise.resolve({ all: ["login-method"] }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ method: "password" })
  })

  it("returns agent-handle for a valid agent login handle", async () => {
    canRedeemAgentLoginHandle.mockResolvedValueOnce(true)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/login-method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "agent+jfp-admin-local.abc@agent-login.jesusfilm.internal",
          oauth_query:
            "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
        }),
      }),
      { params: Promise.resolve({ all: ["login-method"] }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ method: "agent-handle" })
    expect(canRedeemAgentLoginHandle).toHaveBeenCalledWith(expect.anything(), {
      handle: "agent+jfp-admin-local.abc@agent-login.jesusfilm.internal",
      oauthQuery:
        "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
    })
  })

  it("falls back generically for an invalid agent login handle", async () => {
    canRedeemAgentLoginHandle.mockResolvedValueOnce(false)
    const { prisma } = await import("@/db/client")

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/login-method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "agent+jfp-admin-local.bad@agent-login.jesusfilm.internal",
          oauth_query:
            "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
        }),
      }),
      { params: Promise.resolve({ all: ["login-method"] }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ method: "password" })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("does not expose provider lookup failures when rate limited", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/login-method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      }),
      { params: Promise.resolve({ all: ["login-method"] }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ method: "password" })
    expect(authPost).not.toHaveBeenCalled()
    expect(canRedeemAgentLoginHandle).not.toHaveBeenCalled()
  })

  it("forwards OAuth continuation as callbackURL through email sign-in", async () => {
    authPost.mockResolvedValueOnce(Response.json({ ok: true }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "USER@example.com",
          oauth_query: "client_id=jfp_admin_local&sig=signed",
          password: "password",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "email"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      callbackURL:
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_local&sig=signed",
      email: "user@example.com",
      password: "password",
    })
  })

  it("forwards valid web watch callbacks through email sign-in", async () => {
    authPost.mockResolvedValueOnce(Response.json({ ok: true }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callbackURL: "http://localhost:3000/watch/jesus/english",
          email: "USER@example.com",
          password: "password",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "email"] }) },
    )

    expect(response.status).toBe(200)
    const forwardedRequest = authPost.mock.calls[0]?.[0] as Request
    await expect(forwardedRequest.json()).resolves.toMatchObject({
      callbackURL: "http://localhost:3000/watch/jesus/english",
      email: "user@example.com",
      password: "password",
    })
  })

  it("redirects browser email sign-in forms back to OAuth authorize after credentials succeed", async () => {
    authPost.mockResolvedValueOnce(
      Response.json(
        { redirect: true },
        { headers: { "set-cookie": "better-auth.session=abc; Path=/" } },
      ),
    )
    const { POST } = await import("./route")
    const body = new URLSearchParams({
      email: "user@example.com",
      oauth_query: "client_id=jfp_admin_local&sig=signed",
      password: "password",
    })

    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
      { params: Promise.resolve({ all: ["sign-in", "email"] }) },
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_local&sig=signed",
    )
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session=abc",
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_auth_last_login_method=email",
    )
  })

  it("redirects browser email sign-in forms back to login when credentials fail", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ error: "Invalid email or password" }, { status: 401 }),
    )
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email: "user@example.com",
          oauth_query: "client_id=jfp_admin_local&sig=signed",
          password: "wrong-password",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "email"] }) },
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3004/login?client_id=jfp_admin_local&sig=signed&error=credentials&email=user%40example.com",
    )
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "forge_auth_last_login_method",
    )
  })

  it("rate limits browser email sign-in forms before reading the body", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const request = new Request(
      "http://localhost:3004/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer:
            "http://localhost:3004/login?client_id=jfp_admin_local&sig=signed",
        },
        body: new URLSearchParams({
          email: "user@example.com",
          oauth_query: "client_id=jfp_admin_local&sig=signed",
          password: "password",
        }),
      },
    )

    const { POST } = await import("./route")
    const response = await POST(request, {
      params: Promise.resolve({ all: ["sign-in", "email"] }),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3004/login?client_id=jfp_admin_local&sig=signed&error=credentials",
    )
    expect(authPost).not.toHaveBeenCalled()
  })

  it("keeps JSON email sign-in failures as 401 responses", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ error: "Invalid email or password" }, { status: 401 }),
    )
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          oauth_query: "client_id=jfp_admin_local&sig=signed",
          password: "wrong-password",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "email"] }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid email or password",
    })
  })

  it("uses the same OAuth continuation after Firebase fallback migration", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ error: "Nope" }, { status: 401 }),
    )
    const { prisma } = await import("@/db/client")
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null)
    const { signInWithFirebasePassword } = await import("@/auth/firebase-rest")
    vi.mocked(signInWithFirebasePassword).mockResolvedValueOnce({
      email: "user@example.com",
      idToken: "firebase_id_token",
    })
    const { verifyFirebaseIdToken } = await import("@/auth/firebase-admin")
    vi.mocked(verifyFirebaseIdToken).mockResolvedValueOnce({
      email: "user@example.com",
      uid: "firebase_uid",
    })
    signUpEmail.mockResolvedValueOnce(
      Response.json(
        { redirect: true },
        { headers: { "set-cookie": "better-auth.session=abc; Path=/" } },
      ),
    )

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email: "USER@example.com",
          oauth_query: "client_id=jfp_admin_local&sig=signed",
          password: "password",
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "email"] }) },
    )

    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          callbackURL:
            "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_local&sig=signed",
          email: "user@example.com",
        }),
      }),
    )
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_local&sig=signed",
    )
    expect(accountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          providerId: "firebase",
          issuer: "local:firebase",
          accountId: "firebase_uid",
        }),
      }),
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_auth_last_login_method=email",
    )
  })

  it("sets last used provider only after a successful social callback", async () => {
    authGet.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://localhost:3004/api/auth/oauth2/authorize",
          "set-cookie": "better-auth.session=abc; Path=/",
        },
      }),
    )

    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3004/api/auth/callback/google"),
      { params: Promise.resolve({ all: ["callback", "google"] }) },
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session=abc",
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_auth_last_login_method=google",
    )
  })

  it("does not set last used provider after a failed social callback", async () => {
    authGet.mockResolvedValueOnce(
      Response.redirect(
        "http://localhost:3004/login?error=account_not_linked",
        302,
      ),
    )

    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3004/api/auth/callback/google"),
      { params: Promise.resolve({ all: ["callback", "google"] }) },
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "forge_auth_last_login_method",
    )
  })

  it("does not set last used provider without a session cookie", async () => {
    authGet.mockResolvedValueOnce(
      Response.redirect("http://localhost:3004/api/auth/oauth2/authorize", 302),
    )

    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3004/api/auth/callback/google"),
      { params: Promise.resolve({ all: ["callback", "google"] }) },
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "forge_auth_last_login_method",
    )
  })

  it("allows agent sessions to authorize approved local clients", async () => {
    const { prisma } = await import("@/db/client")
    getSession.mockResolvedValueOnce({ user: { id: "agent_user_1" } })
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      actorType: "AGENT",
    } as never)
    vi.mocked(prisma.appEnvironment.findUnique).mockResolvedValueOnce({
      kind: "LOCAL",
      status: "APPROVED",
      app: { status: "ACTIVE" },
      grants: [{ id: "grant_1" }],
    } as never)

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(200)
    expect(authGet).toHaveBeenCalled()
  })

  it("blocks agent sessions from authorizing production clients", async () => {
    const { prisma } = await import("@/db/client")
    getSession.mockResolvedValueOnce({ user: { id: "agent_user_1" } })
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      actorType: "AGENT",
    } as never)
    vi.mocked(prisma.appEnvironment.findUnique).mockResolvedValueOnce({
      kind: "PRODUCTION",
      status: "APPROVED",
      app: { status: "ACTIVE" },
      grants: [{ id: "grant_1" }],
    } as never)

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3004/api/auth/oauth2/authorize?client_id=jfp_admin_production&redirect_uri=https%3A%2F%2Fadmin.jesusfilm.org%2Fapi%2Fauth%2Fcallback",
      ),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )

    expect(response.status).toBe(403)
    expect(authGet).not.toHaveBeenCalled()
  })
})

describe("device grant rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authPost.mockResolvedValue(Response.json({ ok: true }))
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
  })

  /**
   * The catch-all hands plugin endpoints straight to better-auth, which applies
   * no limiter of its own. These branches are the only per-IP throttle in front
   * of the device endpoints, so each one is pinned individually — a deleted
   * branch must fail a test rather than silently unthrottle an endpoint.
   */
  const throttled = [
    ["device", "code"],
    ["device", "token"],
    ["device", "approve"],
    ["device", "deny"],
  ] as const

  for (const segments of throttled) {
    const path = segments.join("/")

    it(`throttles POST ${path} before reaching better-auth`, async () => {
      rateLimitAuthRoute.mockResolvedValueOnce({
        allowed: false,
        source: "local",
      })

      const { POST } = await import("./route")
      const response = await POST(
        new Request(`http://localhost:3004/api/auth/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        { params: Promise.resolve({ all: [...segments] }) },
      )

      expect(response.status).toBe(429)
      // RFC 8628's own back-off signal, so a conforming client already knows
      // how to react to it.
      await expect(response.json()).resolves.toMatchObject({
        error: "slow_down",
      })
      expect(authPost).not.toHaveBeenCalled()
    })

    it(`passes ${path} through when under the limit`, async () => {
      const { POST } = await import("./route")
      const response = await POST(
        new Request(`http://localhost:3004/api/auth/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        { params: Promise.resolve({ all: [...segments] }) },
      )

      expect(response.status).toBe(200)
      expect(authPost).toHaveBeenCalled()
    })
  }

  it("throttles GET device/status", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })

    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3004/api/auth/device/status?user_code=1"),
      { params: Promise.resolve({ all: ["device", "status"] }) },
    )

    expect(response.status).toBe(429)
    expect(authGet).not.toHaveBeenCalled()
  })

  it("leaves non-device routes on their existing limits", async () => {
    // Anti-vacuous companion: proves the device branch is selective rather than
    // a blanket limiter that would have caught this path anyway.
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })

    const { GET } = await import("./route")
    await GET(new Request("http://localhost:3004/api/auth/ok"), {
      params: Promise.resolve({ all: ["ok"] }),
    })

    expect(rateLimitAuthRoute).not.toHaveBeenCalled()
    expect(authGet).toHaveBeenCalled()
  })

  it("gives each device endpoint its own bucket", async () => {
    // A shared bucket would let ~180 legitimate polls exhaust the issuance
    // allowance for everyone behind the same NAT.
    const { POST } = await import("./route")
    await POST(
      new Request("http://localhost:3004/api/auth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ all: ["device", "code"] }) },
    )

    expect(rateLimitAuthRoute).toHaveBeenCalledWith(
      expect.objectContaining({ route: "device/code" }),
    )
  })

  it("allows a full 15-minute poll run without throttling the TV", async () => {
    // 15 minutes at the advertised 5s interval is ~180 polls; the ceiling must
    // sit above that or a well-behaved device throttles itself out.
    const { POST } = await import("./route")
    await POST(
      new Request("http://localhost:3004/api/auth/device/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ all: ["device", "token"] }) },
    )

    const call = rateLimitAuthRoute.mock.calls[0][0] as {
      limit: number
      windowMs: number
    }
    expect(call.limit).toBeGreaterThan((15 * 60) / 5)
  })
})

describe("device sign-in continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
  })

  async function signInWith(oauthQuery: string): Promise<string | undefined> {
    authPost.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { "set-cookie": "better-auth.session_token=abc" },
      }),
    )

    const { POST } = await import("./route")
    await POST(
      new Request("http://localhost:3004/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "viewer@example.com",
          password: "correct-horse",
          oauth_query: oauthQuery,
        }),
      }),
      { params: Promise.resolve({ all: ["sign-in", "email"] }) },
    )

    const forwarded = authPost.mock.calls[0]?.[0] as Request | undefined
    if (!forwarded) return undefined
    return (JSON.parse(await forwarded.text()) as { callbackURL?: string })
      .callbackURL
  }

  it("returns a device sign-in to the approval page", async () => {
    // Reverting the device branch sends this to /api/auth/oauth2/authorize,
    // which strands the viewer away from the code they were approving.
    await expect(signInWith("user_code=0194507302&prompt=login")).resolves.toBe(
      "http://localhost:3004/device?user_code=0194507302",
    )
  })

  it("normalizes a pasted code before returning to the page", async () => {
    await expect(signInWith("user_code=019-450-7302")).resolves.toBe(
      "http://localhost:3004/device?user_code=0194507302",
    )
  })

  it("leaves an ordinary OAuth sign-in on the authorize hop", async () => {
    // Anti-vacuous companion: proves the device branch is selective rather than
    // capturing every continuation.
    await expect(
      signInWith(
        "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback&scope=openid",
      ),
    ).resolves.toContain("/api/auth/oauth2/authorize")
  })

  it("preserves repeated native resource indicators through login", async () => {
    const continuation = await signInWith(
      "client_id=dynamic_native&redirect_uri=http%3A%2F%2F127.0.0.1%3A49173%2Fcallback&resource=https%3A%2F%2Fresource-a.example%2Fmcp&resource=https%3A%2F%2Fresource-b.example%2Fmcp&prompt=login",
    )
    const url = new URL(continuation!)

    expect(url.searchParams.getAll("resource")).toEqual([
      "https://resource-a.example/mcp",
      "https://resource-b.example/mcp",
    ])
    expect(url.searchParams.has("prompt")).toBe(false)
  })

  it("does not let a user code divert an OAuth authorize continuation", async () => {
    // Appending user_code= to a legitimate /login?client_id=… link must not
    // redirect that sign-in to the approval page.
    await expect(
      signInWith(
        "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback&user_code=0194507302",
      ),
    ).resolves.toContain("/api/auth/oauth2/authorize")
  })

  it("ignores a user code that normalizes to nothing", async () => {
    // Falls back to the ordinary continuation rather than sending the viewer to
    // an approval page for a code that cannot exist.
    await expect(signInWith("user_code=!!!")).resolves.not.toContain("/device?")
  })

  it("carries nothing but the code across to the page", async () => {
    // The URL is rebuilt rather than forwarded, so an injected parameter cannot
    // ride along into the approval page.
    const url = await signInWith(
      "user_code=0194507302&redirectTo=https%3A%2F%2Fevil.example&prompt=login",
    )
    expect(url).toBe("http://localhost:3004/device?user_code=0194507302")
    expect(url).not.toContain("evil.example")
  })
})

describe("device responses are never cached", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
  })

  /**
   * The plugin passes Cache-Control to ctx.json, but better-call@1.3.5 drops
   * per-response headers (it shadows its own `headers` binding while copying
   * them). Measured: /device/token returned only content-type while its body
   * carried an access token. RFC 6749 §5.1 makes no-store a MUST there, so the
   * guarantee is enforced here instead of depending on the dependency.
   */
  it("sets no-store on the token response, which carries bearer tokens", async () => {
    authPost.mockResolvedValueOnce(
      Response.json({ access_token: "jfp_at_x", refresh_token: "jfp_rt_y" }),
    )

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/device/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ all: ["device", "token"] }) },
    )

    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("pragma")).toBe("no-cache")
    // The body must survive being rewrapped.
    await expect(response.json()).resolves.toMatchObject({
      access_token: "jfp_at_x",
    })
  })

  it("sets no-store on the issuance response, which carries a live user code", async () => {
    authPost.mockResolvedValueOnce(Response.json({ user_code: "0194507302" }))

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ all: ["device", "code"] }) },
    )

    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("sets no-store on the status lookup", async () => {
    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3004/api/auth/device/status?user_code=1"),
      { params: Promise.resolve({ all: ["device", "status"] }) },
    )

    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("leaves non-device responses alone", async () => {
    // Anti-vacuous companion: proves this is scoped to the device lane rather
    // than a blanket rewrite of every auth response.
    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3004/api/auth/ok"),
      { params: Promise.resolve({ all: ["ok"] }) },
    )

    expect(response.headers.get("cache-control")).toBeNull()
  })
})
