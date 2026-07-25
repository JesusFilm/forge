import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getById,
  mediaAssetFindFirst,
  readMediaObject,
  resolvePrincipalFromRequest,
} = vi.hoisted(() => ({
  getById: vi.fn(),
  mediaAssetFindFirst: vi.fn(),
  readMediaObject: vi.fn(),
  resolvePrincipalFromRequest: vi.fn(),
}))

vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest,
}))

vi.mock("@/db/client", () => ({
  prisma: {
    mediaAsset: {
      findFirst: mediaAssetFindFirst,
    },
  },
}))

vi.mock("@/services", () => ({
  createServices: () => ({
    mediaAsset: {
      getById,
    },
  }),
}))

vi.mock("@/storage/media", () => ({
  readMediaObject,
  safeMediaFilename: (name: string) => name.replace(/[^a-zA-Z0-9_.-]/g, "_"),
}))

import { GET } from "./route"

const readyImageAsset = {
  id: "asset-1",
  backend: "LOCAL",
  kind: "IMAGE",
  status: "READY",
  mimeType: "image/webp",
  originalFilename: "Hero image.webp",
  objectKey: "media-assets/asset-1/original/hero.webp",
  previewObjectKey: "media-assets/asset-1/preview/hero.webp",
  muxPlaybackId: null,
}

describe("GET /api/media-assets/[id]/[variant]", () => {
  beforeEach(() => {
    getById.mockReset()
    mediaAssetFindFirst.mockReset()
    readMediaObject.mockReset()
    resolvePrincipalFromRequest.mockReset()
  })

  it("serves READY preview bytes publicly for app consumers", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    mediaAssetFindFirst.mockResolvedValueOnce(readyImageAsset)
    readMediaObject.mockResolvedValueOnce(new Uint8Array([1, 2, 3]))

    const response = await GET(
      new Request(
        "https://admin.example.test/api/media-assets/asset-1/preview",
      ),
      { params: Promise.resolve({ id: "asset-1", variant: "preview" }) },
    )

    expect(mediaAssetFindFirst).toHaveBeenCalledWith({
      where: { id: "asset-1", status: "READY" },
    })
    expect(getById).not.toHaveBeenCalled()
    expect(readMediaObject).toHaveBeenCalledWith({
      backend: "LOCAL",
      key: "media-assets/asset-1/preview/hero.webp",
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("public, max-age=60")
    expect(response.headers.get("content-type")).toBe("image/webp")
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3,
    ])
  })

  it("keeps downloads behind admin auth", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)

    const response = await GET(
      new Request(
        "https://admin.example.test/api/media-assets/asset-1/download",
      ),
      { params: Promise.resolve({ id: "asset-1", variant: "download" }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://admin.example.test/api/auth/login?returnTo=/dashboard",
    )
    expect(mediaAssetFindFirst).not.toHaveBeenCalled()
    expect(readMediaObject).not.toHaveBeenCalled()
  })

  it("does not serve non-ready previews publicly", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    mediaAssetFindFirst.mockResolvedValueOnce(null)

    const response = await GET(
      new Request(
        "https://admin.example.test/api/media-assets/asset-1/preview",
      ),
      { params: Promise.resolve({ id: "asset-1", variant: "preview" }) },
    )

    expect(response.status).toBe(404)
    expect(readMediaObject).not.toHaveBeenCalled()
  })
})
