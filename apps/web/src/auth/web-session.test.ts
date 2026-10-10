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
