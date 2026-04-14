import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockAuthPost = vi.fn()
const mockSignUpEmail = vi.fn()
const mockSignInWithFirebasePassword = vi.fn()
const mockVerifyFirebaseIdToken = vi.fn()
const mockRateLimitAuthRoute = vi.fn()
const mockPrismaUserFindFirst = vi.fn()
const mockPrismaUserUpdate = vi.fn()
const mockPrismaAccountUpsert = vi.fn()
const mockPrismaTransaction = vi.fn()

vi.mock("@/auth/config", () => ({
  auth: {
    api: { signUpEmail: mockSignUpEmail },
  },
  authRouteHandlers: {
    POST: mockAuthPost,
    GET: vi.fn(),
    PATCH: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
}))

vi.mock("@/auth/firebase-rest", () => ({
  signInWithFirebasePassword: mockSignInWithFirebasePassword,
}))

vi.mock("@/auth/firebase-admin", () => ({
  verifyFirebaseIdToken: mockVerifyFirebaseIdToken,
}))

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: mockRateLimitAuthRoute,
}))

vi.mock("@/db/client", () => ({
  prisma: {
    user: {
      findFirst: mockPrismaUserFindFirst,
      update: mockPrismaUserUpdate,
    },
    account: {
      upsert: mockPrismaAccountUpsert,
    },
    $transaction: mockPrismaTransaction,
  },
}))

vi.mock("@/config/env", () => ({
  env: {
    FIREBASE_MIGRATION_CUTOFF_AT: undefined,
    FIREBASE_WEB_API_KEY: "test-firebase-key",
  },
}))

function signInRequest(
  email = "editor@example.com",
  password = "secret",
): Request {
  return new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
}

const signInContext = { params: Promise.resolve({ all: ["sign-in", "email"] }) }
const signUpContext = { params: Promise.resolve({ all: ["sign-up", "email"] }) }

describe("auth route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("BA hit → session issued, Firebase never consulted", async () => {
    const ok = Response.json({ token: "ba-session" }, { status: 200 })
    mockAuthPost.mockResolvedValueOnce(ok)

    const { POST } = await import("./route")
    const res = await POST(signInRequest(), signInContext)

    expect(res.status).toBe(200)
    expect(mockSignInWithFirebasePassword).not.toHaveBeenCalled()
  })

  it("BA miss + Firebase success → creates user and returns session", async () => {
    mockAuthPost.mockResolvedValueOnce(
      Response.json({ error: "invalid" }, { status: 401 }),
    )
    mockPrismaUserFindFirst.mockResolvedValueOnce(null)
    mockSignInWithFirebasePassword.mockResolvedValueOnce({
      email: "editor@example.com",
      idToken: "firebase-id-token",
    })
    mockVerifyFirebaseIdToken.mockResolvedValueOnce({
      email: "editor@example.com",
      uid: "firebase-uid",
    })
    const signUpRes = Response.json({ token: "new-session" }, { status: 200 })
    mockSignUpEmail.mockResolvedValueOnce(signUpRes)
    mockPrismaTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          user: {
            findFirst: vi.fn().mockResolvedValueOnce({ id: "new-user-id" }),
            update: mockPrismaUserUpdate,
          },
          account: { upsert: mockPrismaAccountUpsert },
        })
      },
    )

    const { POST } = await import("./route")
    const res = await POST(signInRequest(), signInContext)

    expect(res.status).toBe(200)
    expect(mockVerifyFirebaseIdToken).toHaveBeenCalledWith("firebase-id-token")
    expect(mockPrismaTransaction).toHaveBeenCalled()
  })

  it("BA miss + Firebase fail → generic 401", async () => {
    mockAuthPost.mockResolvedValueOnce(
      Response.json({ error: "invalid" }, { status: 401 }),
    )
    mockPrismaUserFindFirst.mockResolvedValueOnce(null)
    mockSignInWithFirebasePassword.mockResolvedValueOnce(null)

    const { POST } = await import("./route")
    const res = await POST(signInRequest(), signInContext)

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body).toEqual({ error: "Invalid email or password" })
    expect(mockVerifyFirebaseIdToken).not.toHaveBeenCalled()
  })

  it("Firebase email_verified=false → generic 401", async () => {
    mockAuthPost.mockResolvedValueOnce(
      Response.json({ error: "invalid" }, { status: 401 }),
    )
    mockPrismaUserFindFirst.mockResolvedValueOnce(null)
    mockSignInWithFirebasePassword.mockResolvedValueOnce({
      email: "editor@example.com",
      idToken: "firebase-id-token",
    })
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(null)

    const { POST } = await import("./route")
    const res = await POST(signInRequest(), signInContext)

    expect(res.status).toBe(401)
    expect(mockSignUpEmail).not.toHaveBeenCalled()
  })

  it("existing BA user with wrong password → returns BA 401, no Firebase", async () => {
    mockAuthPost.mockResolvedValueOnce(
      Response.json({ error: "invalid" }, { status: 401 }),
    )
    mockPrismaUserFindFirst.mockResolvedValueOnce({ id: "existing-user" })

    const { POST } = await import("./route")
    const res = await POST(signInRequest(), signInContext)

    expect(res.status).toBe(401)
    expect(mockSignInWithFirebasePassword).not.toHaveBeenCalled()
  })

  it("rate limited → generic 401, no auth attempted", async () => {
    mockRateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })

    const { POST } = await import("./route")
    const res = await POST(signInRequest(), signInContext)

    expect(res.status).toBe(401)
    expect(mockAuthPost).not.toHaveBeenCalled()
  })

  it("POST sign-up/email → 404 (no public registration)", async () => {
    const { POST } = await import("./route")
    const req = new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "p" }),
    })
    const res = await POST(req, signUpContext)

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body).toEqual({ error: "Not found" })
  })

  it("all failure paths return identical 401 response bodies", async () => {
    const expected = { error: "Invalid email or password" }

    // Path 1: rate limited
    mockRateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const { POST } = await import("./route")
    const r1 = await POST(signInRequest(), signInContext)
    expect(await r1.json()).toEqual(expected)

    // Path 2: BA miss + no Firebase creds
    mockRateLimitAuthRoute.mockResolvedValueOnce({
      allowed: true,
      source: "local",
    })
    mockAuthPost.mockResolvedValueOnce(
      Response.json({ error: "invalid" }, { status: 401 }),
    )
    mockPrismaUserFindFirst.mockResolvedValueOnce(null)
    mockSignInWithFirebasePassword.mockResolvedValueOnce(null)
    const r2 = await POST(signInRequest(), signInContext)
    expect(await r2.json()).toEqual(expected)
  })
})
