import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The endpoint itself is real — only its collaborators are mocked — so the
 * declared path, method, and body schema are under test alongside the branch
 * logic. `sessionMiddleware` is swapped for a pass-through because the session
 * arrives on `ctx.context`, which each case supplies directly.
 */
vi.mock("better-auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/api")>()
  return {
    ...actual,
    sessionMiddleware: actual.createAuthMiddleware(async () => ({})),
  }
})

const prismaMock = vi.hoisted(() => ({
  account: { findFirst: vi.fn(), update: vi.fn() },
}))
vi.mock("@/db/client", () => ({ prisma: prismaMock }))

const getAppleNativeClientConfig = vi.hoisted(() => vi.fn())
vi.mock("@/config/env", () => ({ getAppleNativeClientConfig }))

const exchangeAppleAuthorizationCode = vi.hoisted(() => vi.fn())
vi.mock("@/services/apple-native.service", () => ({
  exchangeAppleAuthorizationCode,
}))

import { mobileAppleCredentialPlugin } from "./mobile-apple-plugin"

const CONFIG = { bundleId: "org.jesusfilm.forgewatch", clientSecret: "jwt" }

function endpoint() {
  return mobileAppleCredentialPlugin().endpoints.attachAppleNativeCredential
}

/** A signed-in mobile session unless a case overrides `clientKind`.
 *  Returns a real Response so the status codes are actually asserted —
 *  `ctx.json(body, { status })` drops the status when unwrapped. */
function call(options: { clientKind?: string | null; body?: unknown } = {}) {
  return endpoint()({
    body: options.body ?? { authorizationCode: "code-123" },
    context: {
      session: {
        user: { id: "user-1" },
        session: {
          clientKind:
            options.clientKind === undefined ? "mobile" : options.clientKind,
        },
      },
    },
    asResponse: true,
  } as never) as Promise<Response>
}

beforeEach(() => {
  vi.clearAllMocks()
  getAppleNativeClientConfig.mockReturnValue(CONFIG)
  prismaMock.account.findFirst.mockResolvedValue({ id: "account-1" })
  prismaMock.account.update.mockResolvedValue({})
  exchangeAppleAuthorizationCode.mockResolvedValue({
    ok: true,
    refreshToken: "refresh-abc",
  })
})

describe("mobile Apple native-credential endpoint", () => {
  it("is registered as a POST behind the session middleware", () => {
    const registered = endpoint()
    expect(registered.path).toBe("/mobile/apple/native-credential")
    expect(registered.options.method).toBe("POST")
    // Without the middleware the handler would read an absent session and
    // every branch below would throw instead of rejecting.
    expect(registered.options.use?.length).toBeGreaterThan(0)
  })

  it("stores the refresh token that account deletion later revokes", async () => {
    const response = await call()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })

    expect(exchangeAppleAuthorizationCode).toHaveBeenCalledWith(
      CONFIG,
      "code-123",
    )
    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: { refreshToken: "refresh-abc" },
    })
  })

  it("carries the access token and its expiry when Apple returns them", async () => {
    const expiresAt = new Date("2026-08-04T00:00:00.000Z")
    exchangeAppleAuthorizationCode.mockResolvedValue({
      ok: true,
      refreshToken: "refresh-abc",
      accessToken: "access-abc",
      accessTokenExpiresAt: expiresAt,
    })

    await call()

    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        refreshToken: "refresh-abc",
        accessToken: "access-abc",
        accessTokenExpiresAt: expiresAt,
      },
    })
  })

  it("rejects an empty authorization code before reaching Apple", async () => {
    await expect(call({ body: { authorizationCode: "" } })).rejects.toThrow()
    expect(exchangeAppleAuthorizationCode).not.toHaveBeenCalled()
  })

  it("refuses a non-mobile session — a web session must not attach here", async () => {
    // The credential is scoped to the native sheet; any other signed-in
    // session reaching this endpoint would write a credential it never issued.
    const response = await call({ clientKind: "web" })

    expect(response.status).toBe(403)
    expect(exchangeAppleAuthorizationCode).not.toHaveBeenCalled()
    expect(prismaMock.account.update).not.toHaveBeenCalled()
  })

  it("refuses a session with no client kind at all", async () => {
    const response = await call({ clientKind: null })

    expect(response.status).toBe(403)
    expect(exchangeAppleAuthorizationCode).not.toHaveBeenCalled()
  })

  it("degrades to 503 when Apple native config is absent", async () => {
    // The env vars are `.optional()`, so an unprovisioned environment must
    // answer rather than throw out of the endpoint.
    getAppleNativeClientConfig.mockReturnValue(null)

    const response = await call()

    expect(response.status).toBe(503)
    expect(prismaMock.account.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when the user has no linked Apple account", async () => {
    prismaMock.account.findFirst.mockResolvedValue(null)

    const response = await call()

    expect(response.status).toBe(404)
    expect(exchangeAppleAuthorizationCode).not.toHaveBeenCalled()
  })

  it("looks the account up scoped to the caller, not by code alone", async () => {
    await call()

    expect(prismaMock.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", providerId: "apple" },
      }),
    )
  })

  it("returns 502 without writing when the exchange fails", async () => {
    // A half-write here would leave a stale refresh token that deletion would
    // then try — and fail — to revoke.
    exchangeAppleAuthorizationCode.mockResolvedValue({ ok: false })

    const response = await call()

    expect(response.status).toBe(502)
    expect(prismaMock.account.update).not.toHaveBeenCalled()
  })
})
