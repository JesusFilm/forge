import { afterEach, describe, expect, it, vi } from "vitest"

async function importSession() {
  vi.resetModules()
  vi.stubEnv("ADMIN_GRAPHQL_URL", "http://localhost:3003/api/graphql")
  vi.stubEnv("WEB_ADMIN_API_KEYS", "test-key")
  vi.stubEnv("REVALIDATION_SECRET", "test-secret")
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  return import("./web-session")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("Web auth session cookies", () => {
  it("encrypts and reads a Web auth session", async () => {
    const { createWebAuthSessionCookie, readWebAuthSessionCookie } =
      await importSession()

    const cookie = await createWebAuthSessionCookie({
      subject: "user_123",
      email: "user@example.test",
      name: "Example User",
      scopes: ["openid", "web:watch-events:write"],
      accessToken: "jfp_at_secret",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    })

    expect(cookie).not.toContain("jfp_at_secret")
    await expect(readWebAuthSessionCookie(cookie)).resolves.toMatchObject({
      subject: "user_123",
      email: "user@example.test",
      name: "Example User",
      scopes: ["openid", "web:watch-events:write"],
      accessToken: "jfp_at_secret",
    })
  })

  it("treats tampered, plaintext, and expired cookies as anonymous", async () => {
    const { createWebAuthSessionCookie, readWebAuthSessionCookie } =
      await importSession()
    const expired = await createWebAuthSessionCookie({
      subject: "user_123",
      scopes: ["openid"],
      accessToken: "jfp_at_secret",
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    })

    await expect(readWebAuthSessionCookie("plaintext")).resolves.toBeNull()
    await expect(readWebAuthSessionCookie(`${expired}x`)).resolves.toBeNull()
    await expect(readWebAuthSessionCookie(expired)).resolves.toBeNull()
  })
})

describe("Web auth cookie scope", () => {
  it("scopes auth cookies to the Watch basePath, not the whole origin", async () => {
    // FGE-235: `path: "/"` sent the encrypted session cookie and the live
    // OAuth state / PKCE verifier to the WordPress half of
    // www.jesusfilm.org, which is a different application on the same origin.
    const { webAuthCookieOptions } = await importSession()
    expect(webAuthCookieOptions().path).toBe("/watch")
  })

  it("keeps the rest of the cookie hardening intact", async () => {
    const { webAuthCookieOptions } = await importSession()
    expect(webAuthCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
    })
  })

  it("retires ONLY the legacy copy when the same response writes a fresh one", async () => {
    // A full dual-path clear here would expire the cookie the response is
    // establishing. Only the `/` copy may go.
    const { clearLegacyWebAuthCookie, WEB_AUTH_SESSION_COOKIE } =
      await importSession()
    const headers = new Headers()

    clearLegacyWebAuthCookie(headers, WEB_AUTH_SESSION_COOKIE)

    const setCookies = headers.getSetCookie()
    expect(setCookies).toHaveLength(1)
    expect(setCookies[0]).toMatch(/Path=\/(?:;|$)/)
    expect(setCookies[0]).not.toContain("Path=/watch")
  })

  it("a stale legacy cookie would otherwise win the read over the fresh one", async () => {
    // Real-contract companion, and the reason clearLegacyWebAuthCookie exists.
    // Next parses the Cookie header into a Map keyed by NAME, so the last pair
    // wins; RFC 6265 sends the longer path FIRST, which puts the stale `/`
    // cookie last. Asserted against Next's own parser, not our reading of it.
    const { RequestCookies } =
      await import("next/dist/compiled/@edge-runtime/cookies")
    const headers = new Headers()
    headers.set(
      "cookie",
      "forge_web_session=fresh-watch-scoped; forge_web_session=stale-legacy",
    )

    expect(new RequestCookies(headers).get("forge_web_session")?.value).toBe(
      "stale-legacy",
    )
  })

  it("clears both the scoped cookie and the legacy origin-wide one", async () => {
    // A cookie previously written at Path=/ is invisible to a delete scoped
    // to /watch, so a signed-in user would stay signed in after sign-out for
    // the whole life of that cookie. Both Set-Cookie lines must go out.
    const { clearWebAuthCookie, WEB_AUTH_SESSION_COOKIE } =
      await importSession()
    const headers = new Headers()

    clearWebAuthCookie(headers, WEB_AUTH_SESSION_COOKIE)

    const setCookies = headers.getSetCookie()
    expect(setCookies).toHaveLength(2)
    expect(setCookies.some((line) => line.includes("Path=/watch"))).toBe(true)
    expect(setCookies.some((line) => /Path=\/(?:;|$)/.test(line))).toBe(true)
    for (const line of setCookies) {
      expect(line).toContain(`${WEB_AUTH_SESSION_COOKIE}=`)
      expect(line).toContain("Max-Age=0")
      expect(line).toContain("HttpOnly")
    }
  })
})
