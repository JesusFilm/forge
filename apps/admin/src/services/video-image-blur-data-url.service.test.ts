import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildVideoImageBlurUrl,
  getOrCreateVideoImageBlurDataUrl,
  isPublicHttpsImageUrl,
} from "./video-image-blur-data-url.service"

function buildPrisma(existingBlurDataUrl: string | null = null) {
  return {
    videoImage: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          existingBlurDataUrl ? { blurDataUrl: existingBlurDataUrl } : null,
        ),
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

describe("buildVideoImageBlurUrl", () => {
  it("rewrites Cloudflare-style width, height, and quality variant segments", () => {
    expect(
      buildVideoImageBlurUrl(
        "https://imagedelivery.net/account/image-id/w=448,h=336,q=80,fit=cover",
      ),
    ).toBe(
      "https://imagedelivery.net/account/image-id/w=24,h=14,q=40,fit=cover",
    )
  })

  it("leaves URLs without a width variant untouched", () => {
    expect(buildVideoImageBlurUrl("https://cdn.example.com/image.jpg")).toBe(
      "https://cdn.example.com/image.jpg",
    )
  })
})

describe("isPublicHttpsImageUrl", () => {
  it("accepts public HTTPS URLs", () => {
    expect(
      isPublicHttpsImageUrl("https://imagedelivery.net/account/image-id/w=24"),
    ).toBe(true)
  })

  it("rejects non-HTTPS and local/private hosts", () => {
    expect(isPublicHttpsImageUrl("http://imagedelivery.net/image.jpg")).toBe(
      false,
    )
    expect(isPublicHttpsImageUrl("https://localhost/image.jpg")).toBe(false)
    expect(isPublicHttpsImageUrl("https://127.0.0.1/image.jpg")).toBe(false)
    expect(isPublicHttpsImageUrl("https://192.168.0.1/image.jpg")).toBe(false)
    expect(isPublicHttpsImageUrl("https://service.local/image.jpg")).toBe(false)
  })
})

describe("getOrCreateVideoImageBlurDataUrl", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns existing stored blur data without fetching", async () => {
    const prisma = buildPrisma("data:image/jpeg;base64,EXISTING")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      getOrCreateVideoImageBlurDataUrl({
        prisma: prisma as never,
        imageId: "image-1",
        imageUrl: "https://imagedelivery.net/account/image-id/w=448",
      }),
    ).resolves.toBe("data:image/jpeg;base64,EXISTING")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.videoImage.update).not.toHaveBeenCalled()
  })

  it("does not fetch blocked URLs", async () => {
    const prisma = buildPrisma()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      getOrCreateVideoImageBlurDataUrl({
        prisma: prisma as never,
        imageId: "image-1",
        imageUrl: "http://localhost/image.jpg",
      }),
    ).resolves.toBeNull()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.videoImage.update).not.toHaveBeenCalled()
  })

  it("does not store non-image responses", async () => {
    const prisma = buildPrisma()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not an image", {
          headers: { "content-type": "text/plain" },
          status: 200,
        }),
      ),
    )

    await expect(
      getOrCreateVideoImageBlurDataUrl({
        prisma: prisma as never,
        imageId: "image-1",
        imageUrl: "https://imagedelivery.net/account/image-id/w=448",
      }),
    ).resolves.toBeNull()

    expect(prisma.videoImage.update).not.toHaveBeenCalled()
  })

  it("stores small image responses as data URLs", async () => {
    const prisma = buildPrisma()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
          status: 200,
        }),
      ),
    )

    await expect(
      getOrCreateVideoImageBlurDataUrl({
        prisma: prisma as never,
        imageId: "image-1",
        imageUrl: "https://imagedelivery.net/account/image-id/w=448",
      }),
    ).resolves.toBe("data:image/jpeg;base64,AQID")

    expect(prisma.videoImage.update).toHaveBeenCalledWith({
      where: { id: "image-1" },
      data: { blurDataUrl: "data:image/jpeg;base64,AQID" },
    })
  })
})
