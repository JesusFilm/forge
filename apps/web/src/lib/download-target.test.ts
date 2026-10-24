/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: queryMock,
  },
}))

afterEach(() => {
  queryMock.mockReset()
  vi.restoreAllMocks()
  vi.resetModules()
})

function adminVideoDub({
  downloadable = true,
  downloadId = "download-1",
  published = true,
  slug = "jesus/english",
  url = "https://stream.mux.com/abc.mp4",
  variantId = "variant-1",
  videoId = "video-1",
}: {
  downloadable?: boolean
  downloadId?: string
  published?: boolean
  slug?: string | null
  url?: string | null
  variantId?: string
  videoId?: string
} = {}) {
  return {
    videoDub: {
      downloadable,
      documentId: variantId,
      videoId,
      language: { documentId: "language-1" },
      downloads: [{ documentId: downloadId, url }],
      published,
      slug,
    },
  }
}

describe("resolveWatchDownloadTarget", () => {
  it("returns missing-params without querying admin when any identifier is absent", async () => {
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing-params" })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it("returns unavailable when the admin lookup rejects", async () => {
    queryMock.mockRejectedValueOnce(new Error("admin down"))
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
    expect(consoleError).toHaveBeenCalledWith(
      "[watch-download-target] admin lookup failed",
      expect.objectContaining({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )
  })

  it("queries admin by variant id only", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ url: "https://stream.mux.com/abc.mp4" }),
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({
      ok: true,
      url: "https://stream.mux.com/abc.mp4",
      event: {
        videoId: "video-1",
        videoDubId: "variant-1",
        languageId: "language-1",
      },
    })
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { variantId: "variant-1" },
      }),
    )
  })

  it("rejects missing dubs", async () => {
    queryMock.mockResolvedValueOnce({
      data: { videoDub: null },
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" })
  })

  it("rejects unpublished variants", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ published: false }),
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" })
  })

  it("rejects non-downloadable variants", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ downloadable: false }),
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" })
  })

  it("rejects dubs whose slug belongs to another video", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ slug: "other-video/english" }),
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" })
  })

  it("rejects mismatched variants and downloads", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ downloadId: "download-2", variantId: "variant-2" }),
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" })
  })

  it("treats empty admin URLs as unavailable", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    queryMock.mockResolvedValueOnce({ data: adminVideoDub({ url: "" }) })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
    expect(consoleError).toHaveBeenCalledWith(
      "[watch-download-target] resolved empty download url",
      expect.objectContaining({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )
  })

  it("returns the server-side URL for the matching published variant download", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ url: "https://stream.mux.com/abc.mp4" }),
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toMatchObject({
      ok: true,
      url: "https://stream.mux.com/abc.mp4",
      event: {
        videoId: "video-1",
        videoDubId: "variant-1",
        languageId: "language-1",
      },
    })
  })
})
