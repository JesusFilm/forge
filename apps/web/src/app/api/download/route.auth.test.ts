/**
 * @vitest-environment node
 *
 * Account-gate tests for the same-origin streaming download proxy.
 * These tests intentionally assert the auth gate runs before URL validation,
 * DNS pre-flight, or any upstream media fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock("node:dns", () => ({
  promises: {
    resolve4: vi.fn(async () => ["203.0.113.1"]),
    resolve6: vi.fn(async () => {
      throw new Error("ENODATA")
    }),
  },
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: queryMock,
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

function adminVideoDub() {
  return {
    videoDub: {
      documentId: "variant-1",
      downloadable: true,
      downloads: [
        {
          documentId: "download-1",
          url: "https://stream.mux.com/abc.mp4",
        },
      ],
      published: true,
      slug: "jesus/english",
    },
  }
}

async function importRouteWithGate(enabled: boolean) {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT", String(enabled))
  vi.stubEnv("LAUNCHDARKLY_SDK_KEY", "")
  return import("./route")
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  queryMock.mockReset()
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
    expect(response.headers.get("set-cookie")).toContain(
      "forge_download_gate_rollout=",
    )
    expect(dns.resolve4).toHaveBeenCalled()
  })

  it("resolves signed-in downloads by opaque IDs instead of requiring the browser to send a CDN URL", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub(),
    })
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
          downloadId: "download-1",
          filename: "jesus-highest.mp4",
          variantId: "variant-1",
          videoSlug: "jesus",
        },
        { headers: { cookie: "better-auth.session=abc" } },
      ),
    )

    expect(response.status).toBe(200)
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { variantId: "variant-1" },
      }),
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://stream.mux.com/abc.mp4",
    )
  })

  it("returns a shaped 503 when opaque ID lookup fails before GET can fetch the CDN", async () => {
    queryMock.mockRejectedValueOnce(new Error("admin unavailable"))
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRouteWithGate(false)
    const response = await GET(
      makeRequest({
        downloadId: "download-1",
        filename: "jesus-highest.mp4",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Download lookup unavailable",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns a shaped 404 when opaque IDs do not resolve to a downloadable target", async () => {
    queryMock.mockResolvedValueOnce({ data: { videoDub: null } })
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRouteWithGate(false)
    const response = await GET(
      makeRequest({
        downloadId: "download-1",
        filename: "jesus-highest.mp4",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Download unavailable",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
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

describe("HEAD /watch/api/download - opaque download target", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("resolves file-size probes by opaque IDs instead of requiring a browser CDN URL", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub(),
    })
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": "123456",
            "content-type": "video/mp4",
          },
        })
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const { HEAD } = await importRouteWithGate(false)
    const response = await HEAD(
      makeRequest({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-length")).toBe("123456")
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { variantId: "variant-1" },
      }),
    )
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://stream.mux.com/abc.mp4",
    )
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "HEAD" }),
    )
  })

  it("returns a shaped 503 when opaque ID lookup fails before HEAD can fetch the CDN", async () => {
    queryMock.mockRejectedValueOnce(new Error("admin unavailable"))
    const fetchMock = vi.fn(async () => new Response(null))
    vi.stubGlobal("fetch", fetchMock)

    const { HEAD } = await importRouteWithGate(false)
    const response = await HEAD(
      makeRequest({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Download lookup unavailable",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
