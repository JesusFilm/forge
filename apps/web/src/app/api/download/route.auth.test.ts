/**
 * @vitest-environment node
 *
 * Account-gate tests for the same-origin streaming download proxy.
 * These tests intentionally assert the auth gate runs before URL validation,
 * DNS pre-flight, or any upstream media fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:dns", () => ({
  promises: {
    resolve4: vi.fn(async () => ["203.0.113.1"]),
    resolve6: vi.fn(async () => {
      throw new Error("ENODATA")
    }),
  },
}))

import { promises as dns } from "node:dns"

const ROUTE_URL = "https://example.test/watch/api/download"

function makeRequest(
  query: Record<string, string>,
  init: RequestInit = {},
): Request {
  const url = new URL(ROUTE_URL)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return new Request(url, init)
}

async function importRouteWithGate(enabled: boolean) {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("WEB_DOWNLOAD_ACCOUNT_GATE_FALLBACK", String(enabled))
  vi.stubEnv("LAUNCHDARKLY_SDK_KEY", "")
  return import("./route")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GET /watch/api/download - account gate", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("returns 401 before DNS or upstream fetch when the gate is enabled and the request has no auth cookie", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRouteWithGate(true)
    const response = await GET(
      makeRequest({
        filename: "jesus-highest.mp4",
        url: "https://stream.mux.com/abc.mp4",
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("preserves legacy unauthenticated downloads while the gate flag is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("video-bytes", { status: 200 })),
    )

    const { GET } = await importRouteWithGate(false)
    const response = await GET(
      makeRequest({
        filename: "jesus-highest.mp4",
        url: "https://stream.mux.com/abc.mp4",
      }),
    )

    expect(response.status).toBe(200)
    expect(dns.resolve4).toHaveBeenCalled()
  })

  it("streams the proxy download when the gate is enabled and Auth confirms the session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/auth/get-session")) {
        return Response.json({ user: { id: "user_123" } })
      }
      return new Response("video-bytes", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRouteWithGate(true)
    const response = await GET(
      makeRequest(
        {
          filename: "jesus-highest.mp4",
          url: "https://stream.mux.com/abc.mp4",
        },
        { headers: { cookie: "better-auth.session=abc" } },
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toContain(
      'attachment; filename="jesus-highest.mp4"',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/auth/get-session",
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://stream.mux.com/abc.mp4",
    )
  })
})
