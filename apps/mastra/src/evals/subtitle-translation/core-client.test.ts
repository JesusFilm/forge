import { describe, expect, it, vi } from "vitest"

import { downloadCoreVtt, fetchCoreSubtitleRows } from "./core-client"

describe("subtitle eval Core client", () => {
  it("queries exact video subtitle rows without credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: {
          videoSubtitles: [
            {
              id: "subtitle-1",
              videoId: "video-1",
              languageId: "529",
              primary: true,
              edition: "base",
              vttSrc: "https://api-media-core.jesusfilm.org/video-1/source.vtt",
              updatedAt: "2026-08-20T00:00:00.000Z",
              videoEdition: { id: "edition-1" },
            },
          ],
        },
      }),
    )

    const rows = await fetchCoreSubtitleRows({ videoId: "video-1", fetchImpl })

    expect(rows[0]?.id).toBe("subtitle-1")
    const request = fetchImpl.mock.calls[0]
    expect(request?.[0].toString()).toBe(
      "https://api-gateway.central.jesusfilm.org/",
    )
    expect(request?.[1]?.headers).not.toHaveProperty("authorization")
    expect(request?.[1]?.body).toContain('"videoId":"video-1"')
  })

  it("refuses media redirects to an untrusted host", async () => {
    await expect(
      downloadCoreVtt({
        sourceUrl: "https://example.com/reference.vtt",
        fetchImpl: vi.fn<typeof fetch>(),
      }),
    ).rejects.toThrow("api-media-core.jesusfilm.org")
  })
})
