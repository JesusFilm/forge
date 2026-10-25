import { beforeEach, describe, expect, it, vi } from "vitest"

type EnvShape = {
  NODE_ENV?: string
  AUTH_ISSUER_URL: string
  AUTH_WEB_USER_INTROSPECTION_CLIENT_ID?: string
  AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET?: string
  AUTH_WEB_USER_CLIENT_IDS?: string
  AUTH_WEB_USER_TOKEN_ENVIRONMENT?: string
}

vi.mock("@/config/env", () => ({ env: {} as EnvShape }))

const { env } = await import("@/config/env")
const { verifyWatchSeoUserToken } = await import("@/auth/watch-seo-user-token")

const mutable = env as EnvShape
const ENV_CLAIM = "https://jesusfilm.org/claims/environment"
const NOW_MS = Date.UTC(2026, 9, 16, 12, 0, 0)
const FUTURE = Math.floor(NOW_MS / 1000) + 600

function good(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    iss: "https://auth.example.test/api/auth",
    client_id: "jfp_web_production",
    exp: FUTURE,
    sub: "user-1",
    [ENV_CLAIM]: "production",
    ...overrides,
  }
}

function fetchReturning(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), init),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const verify = (header: string | null, fetchImpl: typeof fetch) =>
  verifyWatchSeoUserToken(header, { fetchImpl, now: () => NOW_MS })

describe("verifyWatchSeoUserToken", () => {
  beforeEach(() => {
    mutable.NODE_ENV = "production"
    mutable.AUTH_ISSUER_URL = "https://auth.example.test/api/auth/"
    mutable.AUTH_WEB_USER_INTROSPECTION_CLIENT_ID = "introspector"
    mutable.AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET = "secret"
    mutable.AUTH_WEB_USER_CLIENT_IDS = undefined
    mutable.AUTH_WEB_USER_TOKEN_ENVIRONMENT = "production"
  })

  it("returns the subject for an active, exact-issuer, web-client token", async () => {
    const fetchImpl = fetchReturning(good())
    await expect(verify("Bearer tok", fetchImpl)).resolves.toEqual({
      ok: true,
      subject: "user-1",
    })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe("https://auth.example.test/api/auth/oauth2/introspect")
    // Redirects are refused so the Basic credential cannot be forwarded.
    expect(init.redirect).toBe("error")
  })

  it("fails closed when introspection credentials are absent", async () => {
    mutable.AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET = undefined
    const fetchImpl = fetchReturning(good())
    await expect(verify("Bearer tok", fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "config_absent",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("fails closed in production without a configured environment", async () => {
    mutable.AUTH_WEB_USER_TOKEN_ENVIRONMENT = undefined
    const fetchImpl = fetchReturning(good())
    await expect(verify("Bearer tok", fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "environment_unconfigured",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("requires the environment claim in production", async () => {
    await expect(
      verify("Bearer tok", fetchReturning(good({ [ENV_CLAIM]: undefined }))),
    ).resolves.toEqual({ ok: false, reason: "environment_mismatch" })
    await expect(
      verify("Bearer tok", fetchReturning(good({ [ENV_CLAIM]: "staging" }))),
    ).resolves.toEqual({ ok: false, reason: "environment_mismatch" })
  })

  it("allows an unset environment outside production but still enforces a set one", async () => {
    mutable.NODE_ENV = "development"
    mutable.AUTH_WEB_USER_TOKEN_ENVIRONMENT = undefined
    await expect(
      verify("Bearer tok", fetchReturning(good({ [ENV_CLAIM]: undefined }))),
    ).resolves.toMatchObject({ ok: true })
    mutable.AUTH_WEB_USER_TOKEN_ENVIRONMENT = "local"
    await expect(
      verify("Bearer tok", fetchReturning(good({ [ENV_CLAIM]: "production" }))),
    ).resolves.toEqual({ ok: false, reason: "environment_mismatch" })
  })

  it("rejects inactive tokens, wrong issuers, and expired tokens", async () => {
    await expect(
      verify("Bearer tok", fetchReturning(good({ active: false }))),
    ).resolves.toEqual({ ok: false, reason: "inactive" })
    await expect(
      verify(
        "Bearer tok",
        fetchReturning(good({ iss: "https://auth.example.test" })),
      ),
    ).resolves.toEqual({ ok: false, reason: "issuer_mismatch" })
    await expect(
      verify("Bearer tok", fetchReturning(good({ exp: FUTURE - 1_000 }))),
    ).resolves.toEqual({ ok: false, reason: "expired" })
    await expect(
      verify("Bearer tok", fetchReturning(good({ exp: "soon" }))),
    ).resolves.toEqual({ ok: false, reason: "expired" })
  })

  it("rejects an empty, missing, or oversized subject", async () => {
    for (const sub of ["", undefined, 42, "x".repeat(192)]) {
      await expect(
        verify("Bearer tok", fetchReturning(good({ sub }))),
      ).resolves.toEqual({ ok: false, reason: "subject_missing" })
    }
  })

  it("accepts web clients only — never TV, admin, or MCP clients", async () => {
    for (const client_id of [
      "jfp_tv_production",
      "jfp_admin_production",
      "jfp_chat_production",
      undefined,
    ]) {
      await expect(
        verify("Bearer tok", fetchReturning(good({ client_id }))),
      ).resolves.toEqual({ ok: false, reason: "client_not_web" })
    }
  })

  it("filters TV ids out of a configured client list", async () => {
    mutable.AUTH_WEB_USER_CLIENT_IDS = "jfp_web_production,jfp_tv_production"
    await expect(
      verify(
        "Bearer tok",
        fetchReturning(good({ client_id: "jfp_tv_production" })),
      ),
    ).resolves.toEqual({ ok: false, reason: "client_not_web" })
    await expect(
      verify("Bearer tok", fetchReturning(good())),
    ).resolves.toMatchObject({ ok: true })
  })

  it("fails closed when the configured client list has no web ids", async () => {
    mutable.AUTH_WEB_USER_CLIENT_IDS = "jfp_tv_production"
    const fetchImpl = fetchReturning(good())
    await expect(verify("Bearer tok", fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "config_absent",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a missing or malformed token without calling Auth", async () => {
    const fetchImpl = fetchReturning(good())
    for (const header of [
      null,
      "",
      "Bearer ",
      "Basic tok",
      "tok",
      `Bearer ${"a".repeat(5000)}`,
    ]) {
      await expect(verify(header, fetchImpl)).resolves.toEqual({
        ok: false,
        reason: "missing_token",
      })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps transport errors, non-2xx, malformed, and oversized bodies to introspection_failed", async () => {
    const reject = vi.fn(async () => {
      throw new Error("boom")
    }) as unknown as typeof fetch
    await expect(verify("Bearer tok", reject)).resolves.toEqual({
      ok: false,
      reason: "introspection_failed",
    })
    await expect(
      verify("Bearer tok", fetchReturning(good(), { status: 500 })),
    ).resolves.toEqual({ ok: false, reason: "introspection_failed" })
    const malformed = vi.fn(
      async () => new Response("not json", { status: 200 }),
    ) as unknown as typeof fetch
    await expect(verify("Bearer tok", malformed)).resolves.toEqual({
      ok: false,
      reason: "introspection_failed",
    })
    await expect(
      verify(
        "Bearer tok",
        fetchReturning(good({ padding: "x".repeat(40_000) })),
      ),
    ).resolves.toEqual({ ok: false, reason: "introspection_failed" })
  })
})
