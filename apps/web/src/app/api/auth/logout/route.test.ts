/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

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

const AUTH_COOKIES = [
  "forge_web_session",
  "forge_web_oauth_state",
  "forge_web_oauth_verifier",
  "forge_web_oauth_return_to",
]

describe("GET /watch/api/auth/logout", () => {
  it("clears every auth cookie at the scoped path AND at the legacy origin-wide path", async () => {
    // FGE-235 rollout hazard: the cookies move from Path=/ to Path=/watch in
    // this same change. A sign-out that only cleared the new scope would
    // leave the pre-rollout session cookie alive for its full 7-day life, so
    // the user stays signed in after clicking sign out.
    const { GET } = await importRoute()

    const response = GET(
      new Request("http://localhost:3102/watch/api/auth/logout"),
    )
    const setCookies = response.headers.getSetCookie()

    for (const name of AUTH_COOKIES) {
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

  it("re-arms the force-login cookie inside the Watch scope only", async () => {
    const { GET } = await importRoute()

    const response = GET(
      new Request("http://localhost:3102/watch/api/auth/logout"),
    )

    expect(response.cookies.get("forge_web_force_login")?.path).toBe("/watch")
  })
})
