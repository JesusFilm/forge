/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
}))

vi.mock("@/auth/oauth-client", () => ({
  getWebOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.example.test/api/auth",
    clientId: "jfp_web_local",
    webBaseUrl: "http://localhost:3000",
  })),
  buildWebAuthorizeUrl: vi.fn(
    () => new URL("https://auth.example.test/api/auth/oauth2/authorize"),
  ),
}))

vi.mock("@/auth/oauth-state", () => ({
  createOAuthState: vi.fn(() => ({
    state: "state-123",
    codeVerifier: "verifier-123",
    codeChallenge: "challenge-123",
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
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("GET /watch/api/auth/login", () => {
  it("stores the request-origin homepage for returnTo=/watch", async () => {
    const { GET } = await importRoute()
    const { WEB_AUTH_RETURN_TO_COOKIE } = await import("@/auth/web-session")

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/login?returnTo=%2Fwatch",
      ),
    )

    expect(response.status).toBe(307)
    expect(response.cookies.get(WEB_AUTH_RETURN_TO_COOKIE)?.value).toBe(
      "http://localhost:3102/watch",
    )
  })

  it("uses the configured homepage fallback for unsafe returnTo values", async () => {
    const { GET } = await importRoute()
    const { WEB_AUTH_RETURN_TO_COOKIE } = await import("@/auth/web-session")

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/login?returnTo=%2Fwatch%2Fapi%2Fdownload",
      ),
    )

    expect(response.status).toBe(307)
    expect(response.cookies.get(WEB_AUTH_RETURN_TO_COOKIE)?.value).toBe(
      "http://localhost:3000/watch",
    )
  })
})
