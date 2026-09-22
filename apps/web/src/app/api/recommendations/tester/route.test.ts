import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  createRecommendationTesterLink,
  RECOMMENDATION_TESTER_COOKIE,
  RECOMMENDATION_TESTER_CONTEXT_KIND,
  TESTER_SESSION_SECONDS,
} from "@/lib/recommendation-tester-token"

const { config, variation, readSession } = vi.hoisted(() => ({
  config: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
    WATCH_RECOMMENDATION_TESTER_SECRET: "local-route-test-secret-".repeat(4) as
      | string
      | undefined,
    WATCH_FOR_YOU_ENABLED: "true",
  },
  variation: vi.fn(),
  readSession: vi.fn(),
}))
vi.mock("@/env", () => ({ env: config }))
vi.mock("@/lib/feature-flags", () => ({
  isWatchHomepageRecommendationsEnabled: variation,
}))
vi.mock("@/auth/web-session", () => ({
  WEB_AUTH_SESSION_COOKIE: "forge_web_session",
  readWebAuthSessionCookie: readSession,
}))
import { POST } from "./route"
import { GET as availability } from "../for-you/availability/route"

const testerId = "37a72bda-b57b-4171-93aa-688d0fba94a7"
const endpoint = `${config.NEXT_PUBLIC_CANONICAL_ORIGIN}/watch/api/recommendations/tester`
function tokenConfig() {
  return {
    origin: config.NEXT_PUBLIC_CANONICAL_ORIGIN,
    secret: config.WATCH_RECOMMENDATION_TESTER_SECRET,
  }
}
function request(token: string, headers: Record<string, string> = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      origin: config.NEXT_PUBLIC_CANONICAL_ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ token }),
  })
}
async function activationToken() {
  return new URL(
    await createRecommendationTesterLink(tokenConfig(), testerId),
  ).hash.slice(1)
}
beforeEach(() => {
  vi.clearAllMocks()
  config.WATCH_RECOMMENDATION_TESTER_SECRET = "local-route-test-secret-".repeat(
    4,
  )
  config.WATCH_FOR_YOU_ENABLED = "true"
  readSession.mockResolvedValue(null)
  variation.mockImplementation(
    async (context) =>
      context.kind === RECOMMENDATION_TESTER_CONTEXT_KIND &&
      context.key === testerId,
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("tester activation and homepage availability", () => {
  it("exchanges a 29-day-old link and keeps the scoped cookie subject to LD revocation", async () => {
    vi.useFakeTimers()
    const issuedAt = new Date("2026-09-21T12:00:00Z")
    vi.setSystemTime(issuedAt)
    vi.stubEnv("NODE_ENV", "production")
    const token = await activationToken()
    vi.setSystemTime(issuedAt.getTime() + 29 * 24 * 60 * 60 * 1000)
    const response = await POST(request(token))
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
    const setCookie = response.headers.get("set-cookie")!
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=lax/i)
    expect(setCookie).toContain("Path=/watch/api/recommendations")
    expect(setCookie).toContain("Max-Age=86400")
    expect(setCookie).not.toMatch(/Domain=|forge_web_session/i)
    expect(setCookie).not.toContain(token)
    expect(
      response.cookies.get(RECOMMENDATION_TESTER_COOKIE)?.value,
    ).toBeTruthy()
    const check = new NextRequest(
      `${config.NEXT_PUBLIC_CANONICAL_ORIGIN}/watch/api/recommendations/for-you/availability`,
      {
        headers: { cookie: setCookie.split(";")[0] },
      },
    )
    const result = await availability(check)
    expect(await result.json()).toEqual({ enabled: true })
    expect(result.headers.get("cache-control")).toContain("private, no-store")
    expect(variation).toHaveBeenCalledWith({
      kind: RECOMMENDATION_TESTER_CONTEXT_KIND,
      key: testerId,
      anonymous: true,
      custom: { surface: "watch-homepage-recommendations" },
    })
    expect(readSession).not.toHaveBeenCalled()
    // A valid credential never overrides LD revocation or the Web kill switch.
    variation.mockResolvedValue(false)
    expect(await (await availability(check)).json()).toEqual({ enabled: false })
    variation.mockClear()
    config.WATCH_FOR_YOU_ENABLED = "false"
    expect(await (await availability(check)).json()).toEqual({ enabled: false })
    expect(variation).not.toHaveBeenCalled()
  })

  it("rejects expired activation and session credentials without enabling anonymous viewers", async () => {
    vi.useFakeTimers()
    const time = new Date("2026-09-21T12:00:00Z")
    vi.setSystemTime(time)
    const token = await activationToken()
    const response = await POST(request(token))
    const cookie = response.headers.get("set-cookie")!.split(";")[0]
    vi.setSystemTime(time.getTime() + TESTER_SESSION_SECONDS * 1000)
    expect((await POST(request(token))).status).toBe(403)
    expect(
      await (
        await availability(new Request(endpoint, { headers: { cookie } }))
      ).json(),
    ).toEqual({ enabled: false })
    expect(variation).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "watch-anonymous" }),
    )
  })

  it.each<Record<string, string>>([
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
    { "content-type": "text/plain" },
    { "content-encoding": "gzip" },
    { "content-length": "9999" },
  ])(
    "rejects invalid request headers without issuing a cookie: %j",
    async (headers) => {
      const response = await POST(request(await activationToken(), headers))
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.headers.get("set-cookie")).toBeNull()
    },
  )

  it("rejects invalid tokens, missing secrets, and oversized bodies without reflection", async () => {
    for (const token of ["not-a-credential", "x".repeat(3000)]) {
      const response = await POST(request(token))
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(await response.text()).not.toContain(token)
    }
    const token = await activationToken()
    config.WATCH_RECOMMENDATION_TESTER_SECRET = undefined
    expect((await POST(request(token))).status).toBe(403)
  })

  it("does not treat query identity, raw UUID cookies, or activation tokens as tester sessions", async () => {
    for (const value of [testerId, await activationToken(), "invalid"]) {
      const result = await availability(
        new Request(`${endpoint}?testerId=${testerId}`, {
          headers: { cookie: `${RECOMMENDATION_TESTER_COOKIE}=${value}` },
        }),
      )
      expect(await result.json()).toEqual({ enabled: false })
      expect(variation).toHaveBeenLastCalledWith(
        expect.objectContaining({ key: "watch-anonymous", kind: "user" }),
      )
    }
  })
})
