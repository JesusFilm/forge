import { beforeEach, describe, expect, it, vi } from "vitest"

const authPost = vi.fn()

vi.mock("@/auth/config", () => ({
  auth: {
    api: {
      signUpEmail: vi.fn(),
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
    user: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(async () => ({ allowed: true, source: "local" })),
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
})
