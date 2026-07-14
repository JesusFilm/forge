import { beforeEach, describe, expect, it, vi } from "vitest"

const authPost = vi.fn()
const authGet = vi.fn(async (_request: unknown) => Response.json({ ok: true }))
const rateLimitAuthRoute = vi.fn(async (_input: unknown) => ({
  allowed: true,
  source: "local",
}))
const signUpEmail = vi.fn()
const getSession = vi.fn()
const canRedeemAgentLoginHandle = vi.fn(
  async (_prisma: unknown, _input: unknown) => false,
)

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
          upsert: vi.fn(),
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
    vi.unstubAllEnvs()
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
