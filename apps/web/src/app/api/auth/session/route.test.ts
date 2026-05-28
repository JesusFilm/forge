/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

const ROUTE_URL = "https://example.test/watch/api/auth/session"

function makeRequest(callbackURL: string): Request {
  const url = new URL(ROUTE_URL)
  url.searchParams.set("callbackURL", callbackURL)
  return new Request(url)
}

async function importRouteWithGate(enabled: boolean) {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT", String(enabled))
  vi.stubEnv("LAUNCHDARKLY_SDK_KEY", "")
  return import("./route")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GET /watch/api/auth/session", () => {
  it("returns the rollout-disabled shape without a login URL", async () => {
    const { GET } = await importRouteWithGate(false)
    const response = await GET(
      makeRequest("http://localhost:3000/watch/jesus/english"),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      gateEnabled: false,
    })
  })

  it("returns a sanitized auth login URL for signed-out watch-page callbacks", async () => {
    const { GET } = await importRouteWithGate(true)
    const response = await GET(
      makeRequest("http://localhost:3000/watch/jesus/english"),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      authenticated: boolean
      gateEnabled: boolean
      loginUrl: string
    }
    expect(body.authenticated).toBe(false)
    expect(body.gateEnabled).toBe(true)
    expect(body.loginUrl).toBe(
      "http://localhost:3004/login?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fwatch%2Fjesus%2Fenglish",
    )
    expect(body.loginUrl).not.toContain("stream.mux.com")
  })

  it("rejects callbacks that point at the download API", async () => {
    const { GET } = await importRouteWithGate(true)
    const response = await GET(
      makeRequest(
        "http://localhost:3000/watch/api/download?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
      ),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid auth destination",
    })
  })
})
