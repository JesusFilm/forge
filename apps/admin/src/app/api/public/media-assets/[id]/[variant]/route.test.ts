import { beforeEach, describe, expect, it, vi } from "vitest"

const findFirstMock = vi.hoisted(() => vi.fn())
const readMediaObjectMock = vi.hoisted(() => vi.fn())

vi.mock("@/db/client", () => ({
  prisma: {
    mediaAsset: {
      findFirst: findFirstMock,
    },
  },
}))

vi.mock("@/storage/media", () => ({
  readMediaObject: readMediaObjectMock,
}))

const { GET } = await import("./route")

function context(id = "asset-1", variant = "preview") {
  return {
    params: Promise.resolve({ id, variant }),
  }
}

describe("GET /api/public/media-assets/:id/:variant", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("serves public ready previews without requiring an admin session", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "asset-1",
      backend: "S3",
      status: "READY",
      visibility: "PUBLIC",
      mimeType: "image/webp",
      objectKey: "media-assets/asset-1/original/hero.webp",
      previewObjectKey: null,
      muxPlaybackId: null,
    })
    readMediaObjectMock.mockResolvedValueOnce(Buffer.from("image-bytes"))

    const response = await GET(
      new Request("https://admin.test/api/public/media-assets/asset-1/preview"),
      context(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/webp")
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400",
    )
    await expect(response.text()).resolves.toBe("image-bytes")
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "asset-1",
          status: "READY",
          visibility: "PUBLIC",
        },
      }),
    )
  })

  it("does not expose unsupported variants", async () => {
    const response = await GET(
      new Request(
        "https://admin.test/api/public/media-assets/asset-1/download",
      ),
      context("asset-1", "download"),
    )

    expect(response.status).toBe(404)
    expect(findFirstMock).not.toHaveBeenCalled()
  })

  it("returns 404 when the asset is not public and ready", async () => {
    findFirstMock.mockResolvedValueOnce(null)

    const response = await GET(
      new Request("https://admin.test/api/public/media-assets/asset-1/preview"),
      context(),
    )

    expect(response.status).toBe(404)
    expect(readMediaObjectMock).not.toHaveBeenCalled()
  })
})
