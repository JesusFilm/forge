/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { stubWebAuthEnv } from "../test-support"
import {
  WEB_AUTH_RETURN_TO_COOKIE,
  WEB_AUTH_SESSION_COOKIE,
  WEB_AUTH_STATE_COOKIE,
  WEB_AUTH_VERIFIER_COOKIE,
} from "@/auth/web-session"

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
  stubWebAuthEnv()
  return import("./route")
}

afterEach(() => {
  cookieJar.clear()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("GET /watch/api/auth/callback", () => {
  it("writes the session cookie inside the Watch scope", async () => {
    cookieJar.set(WEB_AUTH_STATE_COOKIE, "state-123")
    cookieJar.set(WEB_AUTH_VERIFIER_COOKIE, "verifier-123")
    cookieJar.set(WEB_AUTH_RETURN_TO_COOKIE, "http://localhost:3102/watch")
    const { GET } = await importRoute()

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/callback?code=abc&state=state-123",
      ),
    )

    const session = response.cookies.get(WEB_AUTH_SESSION_COOKIE)
    expect(session?.value).toBeTruthy()
    expect(session?.path).toBe("/watch")
  })

  it("retires the legacy session cookie that would shadow the one it just wrote", async () => {
    // Without this, a user signed in before the rollout who signs in again
    // keeps reading their STALE session for the rest of its 7-day life,
    // because Next's cookie parser resolves the duplicate name to the
    // legacy-path copy.
    cookieJar.set(WEB_AUTH_STATE_COOKIE, "state-123")
    cookieJar.set(WEB_AUTH_VERIFIER_COOKIE, "verifier-123")
    const { GET } = await importRoute()

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/callback?code=abc&state=state-123",
      ),
    )
    const sessionLines = response.headers
      .getSetCookie()
      .filter((line) => line.startsWith(`${WEB_AUTH_SESSION_COOKIE}=`))

    // The fresh cookie at /watch survives...
    expect(
      sessionLines.some(
        (line) => line.includes("Path=/watch") && !line.includes("Max-Age=0"),
      ),
    ).toBe(true)
    // ...and the legacy one is expired in the same response.
    expect(
      sessionLines.some(
        (line) => /Path=\/(?:;|$)/.test(line) && line.includes("Max-Age=0"),
      ),
    ).toBe(true)
  })

  it("clears the consumed PKCE cookies at both the scoped and legacy paths", async () => {
    // The verifier is the live PKCE secret. Leaving the pre-rollout Path=/
    // copy behind keeps it readable by every other app on the origin after
    // the exchange has already happened.
    cookieJar.set(WEB_AUTH_STATE_COOKIE, "state-123")
    cookieJar.set(WEB_AUTH_VERIFIER_COOKIE, "verifier-123")
    const { GET } = await importRoute()

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/callback?code=abc&state=state-123",
      ),
    )
    const setCookies = response.headers.getSetCookie()

    for (const name of [
      WEB_AUTH_STATE_COOKIE,
      WEB_AUTH_VERIFIER_COOKIE,
      WEB_AUTH_RETURN_TO_COOKIE,
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
