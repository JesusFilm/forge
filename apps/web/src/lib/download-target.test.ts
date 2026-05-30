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
  vi.resetModules()
})

function adminVideo({
  downloadId = "download-1",
  published = true,
  url = "https://stream.mux.com/abc.mp4",
  variantId = "variant-1",
}: {
  downloadId?: string
  published?: boolean
  url?: string | null
  variantId?: string
} = {}) {
  return {
    videoBySlug: {
      variants: [
        {
          documentId: variantId,
          published,
          downloads: [{ documentId: downloadId, url }],
        },
      ],
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
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
  })

  it("rejects unpublished variants", async () => {
    queryMock.mockResolvedValueOnce({ data: adminVideo({ published: false }) })
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
      data: adminVideo({ downloadId: "download-2", variantId: "variant-2" }),
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
    queryMock.mockResolvedValueOnce({ data: adminVideo({ url: "" }) })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
  })

  it("returns the server-side URL for the matching published variant download", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideo({ url: "https://stream.mux.com/abc.mp4" }),
    })
    const { resolveWatchDownloadTarget } = await import("./download-target")

    await expect(
      resolveWatchDownloadTarget({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    ).resolves.toEqual({ ok: true, url: "https://stream.mux.com/abc.mp4" })
  })
})
