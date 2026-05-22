import { beforeEach, describe, expect, it, vi } from "vitest"

const authPost = vi.fn()
const rateLimitAuthRoute = vi.fn(async (_input: unknown) => ({
  allowed: true,
  source: "local",
}))
const signUpEmail = vi.fn()

vi.mock("@/auth/config", () => ({
  auth: {
    api: {
      signUpEmail: (...args: unknown[]) => signUpEmail(...args),
    },
  },
  authRouteHandlers: {
    GET: vi.fn(async () => Response.json({ ok: true })),
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
    },
  },
}))

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: (input: unknown) => rateLimitAuthRoute(input),
}))

vi.mock("@/auth/firebase-rest", () => ({
  signInWithFirebasePassword: vi.fn(async () => null),
}))

vi.mock("@/auth/firebase-admin", () => ({
  verifyFirebaseIdToken: vi.fn(async () => null),
}))

describe("Auth route wrapper", () => {
  beforeEach(() => {
    authPost.mockReset()
    rateLimitAuthRoute.mockReset()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    signUpEmail.mockReset()
  })

  it("blocks public email signup", async () => {
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

  it("passes non-email-signin routes through to Better Auth", async () => {
    authPost.mockResolvedValueOnce(Response.json({ ok: true }))
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/auth/sign-in/social", {
        method: "POST",
      }),
      { params: Promise.resolve({ all: ["sign-in", "social"] }) },
    )

    expect(response.status).toBe(200)
    expect(authPost).toHaveBeenCalledOnce()
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
      "http://localhost:3004/login?client_id=jfp_admin_local&sig=signed&error=credentials",
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
  })
})
