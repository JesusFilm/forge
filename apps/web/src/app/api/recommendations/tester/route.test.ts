import { runInNewContext } from "node:vm"
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
import { GET, POST } from "./route"
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
  it.each(["success", "rejected", "timeout", "empty"])(
    "clears fragment history and redirects after %s activation",
    async (outcome) => {
      vi.useFakeTimers()
      const history = { replaceState: vi.fn() }
      const location = {
        hash: outcome === "empty" ? "" : "#local-fixture-token",
        pathname: "/watch/api/recommendations/tester",
        replace: vi.fn(),
      }
      const fetch = vi.fn((_url: string, options: RequestInit) => {
        expect(history.replaceState).toHaveBeenCalledWith(
          null,
          "",
          location.pathname,
        )
        if (outcome === "success") return Promise.resolve({ status: 204 })
        if (outcome === "rejected")
          return Promise.reject(new TypeError("offline"))
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new TypeError("timeout")),
          )
        })
      })
      const html = await GET().text()
      const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
      expect(script).toBeTruthy()
      const finished = runInNewContext(script!, {
        history,
        location,
        fetch,
        AbortController,
        setTimeout,
        clearTimeout,
      })
      if (outcome === "timeout") await vi.advanceTimersByTimeAsync(5000)
      await finished
      if (outcome === "empty") expect(fetch).not.toHaveBeenCalled()
      else
        expect(fetch).toHaveBeenCalledWith(
          location.pathname,
          expect.objectContaining({
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            body: JSON.stringify({ token: "local-fixture-token" }),
          }),
        )
      expect(location.replace).toHaveBeenCalledExactlyOnceWith("/watch")
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it("serves a blank, isolated, non-cacheable fragment bridge with a fresh CSP nonce", async () => {
    const response = GET()
    const html = await response.text()
    expect(response.headers.get("cache-control")).toContain("private, no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("x-robots-tag")).toContain("noindex")
    const nonce = html.match(/nonce="([^"]+)"/)?.[1]
    expect(nonce).toBeTruthy()
    expect(response.headers.get("content-security-policy")).toContain(
      `script-src 'nonce-${nonce}'`,
    )
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    )
    expect(html.indexOf("history.replaceState")).toBeLessThan(
      html.indexOf("fetch("),
    )
    expect(html).toContain('location.replace("/watch")')
    expect(html).not.toMatch(
      /<script[^>]+src=|<button|<form|<input|datadog|gtag/,
    )
    expect(GET().headers.get("content-security-policy")).not.toBe(
      response.headers.get("content-security-policy"),
    )
  })

  it("exchanges a real signed link for a scoped secure cookie and evaluates only the tester ID", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const token = await activationToken()
    const response = await POST(request(token))
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
    const setCookie = response.headers.get("set-cookie")!
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=lax/i)
    expect(setCookie).toContain("Path=/watch/api/recommendations")
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
