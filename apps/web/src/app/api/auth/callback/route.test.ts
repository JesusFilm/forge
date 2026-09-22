/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

const cookieJar = new Map<string, string>()

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => {
      const value = cookieJar.get(name)
      return value == null ? undefined : { name, value }
    }),
  })),
}))

vi.mock("@/auth/oauth-client", () => ({
  getWebOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.example.test/api/auth",
    clientId: "jfp_web_local",
    webBaseUrl: "http://localhost:3000",
  })),
  exchangeWebAuthorizationCode: vi.fn(async () => ({
    id_token: "id-token",
    access_token: "jfp_at_secret",
    expires_in: 3600,
    scope: "openid",
  })),
  verifyWebIdToken: vi.fn(async () => ({
    subject: "user_123",
    email: "user@example.test",
    name: "Example User",
    image: undefined,
    scopes: ["openid"],
  })),
}))

async function importRoute() {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "https://auth.example.test")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  return import("./route")
}

afterEach(() => {
  cookieJar.clear()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("GET /watch/api/auth/callback", () => {
  it("writes the session cookie inside the Watch scope", async () => {
    cookieJar.set("forge_web_oauth_state", "state-123")
    cookieJar.set("forge_web_oauth_verifier", "verifier-123")
    cookieJar.set("forge_web_oauth_return_to", "http://localhost:3102/watch")
    const { GET } = await importRoute()

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/callback?code=abc&state=state-123",
      ),
    )

    const session = response.cookies.get("forge_web_session")
    expect(session?.value).toBeTruthy()
    expect(session?.path).toBe("/watch")
  })

  it("clears the consumed PKCE cookies at both the scoped and legacy paths", async () => {
    // The verifier is the live PKCE secret. Leaving the pre-rollout Path=/
    // copy behind keeps it readable by every other app on the origin after
    // the exchange has already happened.
    cookieJar.set("forge_web_oauth_state", "state-123")
    cookieJar.set("forge_web_oauth_verifier", "verifier-123")
    const { GET } = await importRoute()

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/callback?code=abc&state=state-123",
      ),
    )
    const setCookies = response.headers.getSetCookie()

    for (const name of [
      "forge_web_oauth_state",
      "forge_web_oauth_verifier",
      "forge_web_oauth_return_to",
    ]) {
      const lines = setCookies.filter((line) => line.startsWith(`${name}=`))
      expect(
        lines.some((line) => line.includes("Path=/watch")),
        name,
      ).toBe(true)
      expect(
        lines.some((line) => /Path=\/(?:;|$)/.test(line)),
        name,
      ).toBe(true)
    }
  })

  it("clears the PKCE cookies at both paths on the rejected-state path too", async () => {
    const { GET } = await importRoute()

    const response = await GET(
      new Request("http://localhost:3102/watch/api/auth/callback"),
    )
    const setCookies = response.headers.getSetCookie()
    const lines = setCookies.filter((line) =>
      line.startsWith("forge_web_oauth_verifier="),
    )

    expect(lines.some((line) => line.includes("Path=/watch"))).toBe(true)
    expect(lines.some((line) => /Path=\/(?:;|$)/.test(line))).toBe(true)
  })
})
