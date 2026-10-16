import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    WATCH_SEO_API_KEYS?: string
    WEB_ADMIN_API_KEYS?: string
  },
}))

const { env } = await import("@/config/env")
const { authorizeWatchSeoRequest } = await import("./authorization")
const { WATCH_SEO_USER_TOKEN_HEADER } = await import("./contract")

const mutable = env as {
  WATCH_SEO_API_KEYS?: string
  WEB_ADMIN_API_KEYS?: string
}

function request(headers: Record<string, string> = {}) {
  return new Request("http://admin.test/api/watch-seo/capability", { headers })
}

const goodHeaders = {
  authorization: "Bearer seo-key",
  [WATCH_SEO_USER_TOKEN_HEADER]: "Bearer user-token",
}

function dbWith(user: { id: string; role: string } | null) {
  return {
    user: { findUnique: vi.fn(async () => user) },
  } as unknown as Parameters<typeof authorizeWatchSeoRequest>[1] & {
    user: { findUnique: ReturnType<typeof vi.fn> }
  }
}

const verifyOk = vi.fn(async () => ({ ok: true as const, subject: "user-1" }))

describe("authorizeWatchSeoRequest", () => {
  beforeEach(() => {
    mutable.WATCH_SEO_API_KEYS = "seo-key"
    mutable.WEB_ADMIN_API_KEYS = "web-consumer"
    verifyOk.mockClear()
  })

  it("grants an active Admin with both credentials", async () => {
    const db = dbWith({ id: "user-1", role: "ADMIN" })
    await expect(
      authorizeWatchSeoRequest(request(goodHeaders), db, {
        verifyUserToken: verifyOk,
      }),
    ).resolves.toEqual({ ok: true, adminUserId: "user-1" })
    // Subject-only mapping: the lookup key is the token `sub`, nothing else.
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true, role: true },
    })
    expect(verifyOk).toHaveBeenCalledWith("Bearer user-token")
  })

  it("fails closed when the service-key list is not configured", async () => {
    mutable.WATCH_SEO_API_KEYS = undefined
    const db = dbWith({ id: "user-1", role: "ADMIN" })
    await expect(
      authorizeWatchSeoRequest(request(goodHeaders), db, {
        verifyUserToken: verifyOk,
      }),
    ).resolves.toEqual({ ok: false, reason: "config_absent" })
    expect(verifyOk).not.toHaveBeenCalled()
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it("rejects the Web consumer bearer as the service key", async () => {
    const db = dbWith({ id: "user-1", role: "ADMIN" })
    await expect(
      authorizeWatchSeoRequest(
        request({ ...goodHeaders, authorization: "Bearer web-consumer" }),
        db,
        { verifyUserToken: verifyOk },
      ),
    ).resolves.toEqual({ ok: false, reason: "service_key_invalid" })
  })

  it("never spends an Auth introspection on a caller without the service key", async () => {
    // Token-only request.
    const db = dbWith({ id: "user-1", role: "ADMIN" })
    await expect(
      authorizeWatchSeoRequest(
        request({ [WATCH_SEO_USER_TOKEN_HEADER]: "Bearer user-token" }),
        db,
        { verifyUserToken: verifyOk },
      ),
    ).resolves.toEqual({ ok: false, reason: "service_key_invalid" })
    expect(verifyOk).not.toHaveBeenCalled()
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a service-key-only request (no user token)", async () => {
    const db = dbWith({ id: "user-1", role: "ADMIN" })
    const verifyMissing = vi.fn(async () => ({
      ok: false as const,
      reason: "missing_token" as const,
    }))
    await expect(
      authorizeWatchSeoRequest(
        request({ authorization: "Bearer seo-key" }),
        db,
        {
          verifyUserToken: verifyMissing,
        },
      ),
    ).resolves.toEqual({ ok: false, reason: "missing_token" })
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it("propagates a rejected user token without reading the database", async () => {
    const db = dbWith({ id: "user-1", role: "ADMIN" })
    const verifyDenied = vi.fn(async () => ({
      ok: false as const,
      reason: "client_not_web" as const,
    }))
    await expect(
      authorizeWatchSeoRequest(request(goodHeaders), db, {
        verifyUserToken: verifyDenied,
      }),
    ).resolves.toEqual({ ok: false, reason: "client_not_web" })
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it.each(["EDITOR", "VIEWER", "WEB_USER", "SYSTEM", "admin", ""])(
    "denies role %j",
    async (role) => {
      await expect(
        authorizeWatchSeoRequest(
          request(goodHeaders),
          dbWith({ id: "user-1", role }),
          {
            verifyUserToken: verifyOk,
          },
        ),
      ).resolves.toEqual({ ok: false, reason: "role_not_admin" })
    },
  )

  it("denies a token subject with no Admin user (no email fallback)", async () => {
    const db = dbWith(null)
    await expect(
      authorizeWatchSeoRequest(request(goodHeaders), db, {
        verifyUserToken: verifyOk,
      }),
    ).resolves.toEqual({ ok: false, reason: "user_not_found" })
    expect(db.user.findUnique).toHaveBeenCalledTimes(1)
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    )
  })

  it("re-reads the role on every request so a downgrade takes effect immediately", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: "user-1", role: "ADMIN" })
      .mockResolvedValueOnce({ id: "user-1", role: "EDITOR" })
    const db = { user: { findUnique } } as unknown as Parameters<
      typeof authorizeWatchSeoRequest
    >[1]
    const deps = { verifyUserToken: verifyOk }
    await expect(
      authorizeWatchSeoRequest(request(goodHeaders), db, deps),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      authorizeWatchSeoRequest(request(goodHeaders), db, deps),
    ).resolves.toEqual({ ok: false, reason: "role_not_admin" })
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it("fails closed when the role lookup throws", async () => {
    const db = {
      user: {
        findUnique: vi.fn(async () => Promise.reject(new Error("db down"))),
      },
    } as unknown as Parameters<typeof authorizeWatchSeoRequest>[1]
    await expect(
      authorizeWatchSeoRequest(request(goodHeaders), db, {
        verifyUserToken: verifyOk,
      }),
    ).resolves.toEqual({ ok: false, reason: "lookup_failed" })
  })
})
