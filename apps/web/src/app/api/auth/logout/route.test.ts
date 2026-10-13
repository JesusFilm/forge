/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { stubWebAuthEnv } from "../test-support"
import {
  WEB_AUTH_FORCE_LOGIN_COOKIE,
  WEB_AUTH_RETURN_TO_COOKIE,
  WEB_AUTH_SESSION_COOKIE,
  WEB_AUTH_STATE_COOKIE,
  WEB_AUTH_VERIFIER_COOKIE,
} from "@/auth/web-session"

async function importRoute() {
  vi.resetModules()
  stubWebAuthEnv()
  return import("./route")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const AUTH_COOKIES = [
  WEB_AUTH_SESSION_COOKIE,
  WEB_AUTH_STATE_COOKIE,
  WEB_AUTH_VERIFIER_COOKIE,
  WEB_AUTH_RETURN_TO_COOKIE,
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

    expect(response.cookies.get(WEB_AUTH_FORCE_LOGIN_COOKIE)?.path).toBe(
      "/watch",
    )
  })
})
