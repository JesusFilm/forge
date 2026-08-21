/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ returnTo: "//attacker.example.test/watch" }))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name.endsWith("return-to") ? { value: mocks.returnTo } : undefined,
    ),
  })),
}))

vi.mock("@/auth/oauth-client", () => ({
  getWebOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.example.test/api/auth",
    clientId: "jfp_web_local",
    webBaseUrl: "http://localhost:3000",
  })),
  exchangeWebAuthorizationCode: vi.fn(),
  verifyWebIdToken: vi.fn(),
}))

afterEach(() => {
  mocks.returnTo = "//attacker.example.test/watch"
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("GET /watch/api/auth/callback", () => {
  it("revalidates the return cookie and redirects invalid state only to relative Watch", async () => {
    vi.resetModules()
    vi.stubEnv("WEB_AUTH_BASE_URL", "https://auth.example.test")
    vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
    vi.stubEnv(
      "WEB_SESSION_SECRET",
      "test-session-secret-at-least-thirty-two-chars",
    )
    const { GET } = await import("./route")

    const response = await GET(
      new Request("http://localhost:3102/watch/api/auth/callback?state=bad"),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3102/watch?auth=failed&reason=invalid_state",
    )
  })
})
