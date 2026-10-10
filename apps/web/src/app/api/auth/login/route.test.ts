/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { stubWebAuthEnv } from "../test-support"
import {
  WEB_AUTH_FORCE_LOGIN_COOKIE,
  WEB_AUTH_RETURN_TO_COOKIE,
  WEB_AUTH_STATE_COOKIE,
  WEB_AUTH_VERIFIER_COOKIE,
} from "@/auth/web-session"

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
  stubWebAuthEnv()
  return import("./route")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("GET /watch/api/auth/login", () => {
  it("stores the request-origin homepage for returnTo=/watch", async () => {
    const { GET } = await importRoute()

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

describe("GET /watch/api/auth/login cookie scope", () => {
  it("writes the OAuth handshake cookies inside the Watch scope", async () => {
    // Call-site pin: webAuthCookieOptions() is the seam, but a one-line
    // `path: "/"` override at this call site would restore the leak with the
    // module-level test still green.
    const { GET } = await importRoute()

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/login?returnTo=%2Fwatch",
      ),
    )

    for (const name of [
      WEB_AUTH_STATE_COOKIE,
      WEB_AUTH_VERIFIER_COOKIE,
      WEB_AUTH_RETURN_TO_COOKIE,
    ]) {
      expect(response.cookies.get(name)?.path, name).toBe("/watch")
    }
  })

  it("clears the force-login marker at the legacy path as well", async () => {
    // This call site moved from `cookies.delete()` (single path) to the
    // dual-path clear. Without this case, reverting that one line leaves a
    // pre-rollout Path=/ marker alive and no test goes red.
    const { GET } = await importRoute()

    const response = await GET(
      new Request(
        "http://localhost:3102/watch/api/auth/login?returnTo=%2Fwatch",
      ),
    )
    const lines = response.headers
      .getSetCookie()
      .filter((line) => line.startsWith(`${WEB_AUTH_FORCE_LOGIN_COOKIE}=`))

    expect(lines.some((line) => line.includes("Path=/watch"))).toBe(true)
    expect(lines.some((line) => /Path=\/(?:;|$)/.test(line))).toBe(true)
  })
})
