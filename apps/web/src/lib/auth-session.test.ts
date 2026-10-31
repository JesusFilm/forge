/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

async function importAuthSession() {
  vi.resetModules()
  vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example.test/graphql")
  vi.stubEnv("WEB_ADMIN_API_KEYS", "test-key")
  return import("./auth-session")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("session availability", () => {
  it.each(["503", "timeout", "malformed body"])(
    "keeps %s unavailable for bootstrap and anonymous for legacy callers",
    async (failure) => {
      vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
      const { verifyAuthSession, verifyAuthSessionAvailability } =
        await importAuthSession()
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failure === "timeout") throw new Error("local timeout")
          return failure === "503"
            ? new Response(null, { status: 503 })
            : Response.json({ unexpected: true })
        }),
      )
      const headers = new Headers({
        cookie: "better-auth.session_token=local-fixture",
      })
      await expect(verifyAuthSessionAvailability(headers)).resolves.toBeNull()
      await expect(verifyAuthSession(headers)).resolves.toEqual({
        authenticated: false,
      })
    },
  )
})

describe("resolveAuthBaseURL", () => {
  it("defaults to the production Auth service in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("WEB_AUTH_BASE_URL", "")

    const { resolveAuthBaseURL } = await importAuthSession()

    expect(resolveAuthBaseURL()?.toString()).toBe("https://auth.jesusfilm.org/")
  })

  it("rejects localhost Auth URLs in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")

    const { resolveAuthBaseURL } = await importAuthSession()

    expect(resolveAuthBaseURL()).toBeNull()
  })
})
