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

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

afterEach(() => {
  queryMock.mockReset()
  vi.restoreAllMocks()
  vi.resetModules()
})

function adminVideoDub({
  published = true,
  subtitleId = "subtitle-1",
  subtitleVideoId = "video-1",
  url = "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
  variantId = "variant-1",
  videoId = "video-1",
}: {
  published?: boolean
  subtitleId?: string
  subtitleVideoId?: string | null
  url?: string | null
  variantId?: string
  videoId?: string
} = {}) {
  return {
    videoDub: {
      documentId: variantId,
      published,
      videoId,
      videoEdition: {
        subtitles: [
          {
            documentId: subtitleId,
            vttSrc: url,
            video:
              subtitleVideoId == null ? null : { documentId: subtitleVideoId },
          },
        ],
      },
    },
  }
}

describe("resolveWatchSubtitleTarget", () => {
  it("returns missing-params without querying admin", async () => {
    const { resolveWatchSubtitleTarget } = await import("./subtitle-target")

    await expect(
      resolveWatchSubtitleTarget({
        subtitleId: "subtitle-1",
        variantId: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing-params" })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it("resolves the subtitle URL from the published variant edition", async () => {
    queryMock.mockResolvedValueOnce({ data: adminVideoDub() })
    const { resolveWatchSubtitleTarget } = await import("./subtitle-target")

    await expect(
      resolveWatchSubtitleTarget({
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    ).resolves.toEqual({
      ok: true,
      target: "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
    })
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { variantId: "variant-1" } }),
    )
  })

  it("allows edition-wide subtitles without a video owner", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ subtitleVideoId: null }),
    })
    const { resolveWatchSubtitleTarget } = await import("./subtitle-target")

    await expect(
      resolveWatchSubtitleTarget({
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  it("rejects unpublished or mismatched variants", async () => {
    queryMock
      .mockResolvedValueOnce({ data: adminVideoDub({ published: false }) })
      .mockResolvedValueOnce({
        data: adminVideoDub({ variantId: "variant-2" }),
      })
    const { resolveWatchSubtitleTarget } = await import("./subtitle-target")
    const input = { subtitleId: "subtitle-1", variantId: "variant-1" }

    await expect(resolveWatchSubtitleTarget(input)).resolves.toEqual({
      ok: false,
      reason: "not-found",
    })
    await expect(resolveWatchSubtitleTarget(input)).resolves.toEqual({
      ok: false,
      reason: "not-found",
    })
  })

  it("rejects subtitles owned by a sibling video", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub({ subtitleVideoId: "video-2" }),
    })
    const { resolveWatchSubtitleTarget } = await import("./subtitle-target")

    await expect(
      resolveWatchSubtitleTarget({
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" })
  })

  it("returns unavailable when lookup fails or the VTT URL is empty", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    queryMock
      .mockRejectedValueOnce(new Error("admin down"))
      .mockResolvedValueOnce({ data: adminVideoDub({ url: "" }) })
    const { resolveWatchSubtitleTarget } = await import("./subtitle-target")
    const input = { subtitleId: "subtitle-1", variantId: "variant-1" }

    await expect(resolveWatchSubtitleTarget(input)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    })
    await expect(resolveWatchSubtitleTarget(input)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    })
    expect(consoleError).toHaveBeenCalledTimes(2)
  })
})
