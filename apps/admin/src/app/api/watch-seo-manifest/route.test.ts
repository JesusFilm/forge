import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidConsumerBearerMock = vi.fn()
const getLatestMock = vi.fn()

vi.mock("@/auth/consumer-bearer", () => ({
  isValidConsumerBearer: isValidConsumerBearerMock,
}))

vi.mock("@/db/client", () => ({
  prisma: {},
}))

vi.mock("@/services/watch-seo-manifest-store", () => ({
  WatchSeoManifestStore: vi.fn(() => ({
    getLatest: getLatestMock,
  })),
}))

const { GET } = await import("./route")

const manifest = {
  version: "version-1",
  generatedAt: "2026-06-12T12:00:00.000Z",
  videoRouteGroups: [
    {
      contentSlug: "jesus",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  episodeRouteGroups: [],
  skippedHreflangValues: {},
}

function request(headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/watch-seo-manifest", {
    method: "GET",
    headers,
  })
}

describe("GET /api/watch-seo-manifest", () => {
  beforeEach(() => {
    isValidConsumerBearerMock.mockReset()
    getLatestMock.mockReset()
    isValidConsumerBearerMock.mockReturnValue({
      valid: true,
      bucketKey: "web-key",
    })
    getLatestMock.mockResolvedValue({
      key: "latest",
      version: manifest.version,
      generatedAt: new Date(manifest.generatedAt),
      payload: manifest,
      payloadSizeBytes: 123,
      createdAt: new Date("2026-06-12T12:00:01.000Z"),
      updatedAt: new Date("2026-06-12T12:00:02.000Z"),
    })
  })

  it("returns the latest manifest for a valid consumer bearer", async () => {
    const response = await GET(
      request({ authorization: "Bearer test-consumer-key" }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("etag")).toBe('"version-1"')
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=0, must-revalidate",
    )
    await expect(response.json()).resolves.toEqual(manifest)
    expect(isValidConsumerBearerMock).toHaveBeenCalledWith(
      "Bearer test-consumer-key",
    )
  })

  it("returns 304 when the caller already has the current version", async () => {
    const response = await GET(
      request({
        authorization: "Bearer test-consumer-key",
        "if-none-match": '"version-1"',
      }),
    )

    expect(response.status).toBe(304)
    expect(await response.text()).toBe("")
  })

  it("rejects missing or invalid bearer without revealing snapshot state", async () => {
    isValidConsumerBearerMock.mockReturnValue({
      valid: false,
      bucketKey: null,
    })

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="watch-seo-manifest"',
    )
    await expect(response.json()).resolves.toEqual({
      error: "Authorization required",
    })
    expect(getLatestMock).not.toHaveBeenCalled()
  })

  it("returns a clear 503 when no snapshot exists", async () => {
    getLatestMock.mockResolvedValueOnce(null)

    const response = await GET(request({ authorization: "Bearer key" }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Watch SEO manifest unavailable",
      reason: "missing_snapshot",
    })
  })

  it("returns a controlled 500 when the store read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    getLatestMock.mockRejectedValueOnce(new Error("database secret detail"))

    const response = await GET(request({ authorization: "Bearer key" }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Watch SEO manifest read failed",
      reason: "read_failed",
    })
    expect(warn.mock.calls[0][0]).toContain("watch_seo_manifest.read.failed")
    warn.mockRestore()
  })
})
