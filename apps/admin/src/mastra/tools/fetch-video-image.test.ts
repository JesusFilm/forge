import { beforeEach, describe, expect, it, vi } from "vitest"

function assertOk<T>(value: T): Exclude<T, { error: unknown }> {
  if (typeof value === "object" && value !== null && "error" in value) {
    throw new Error("tool returned a ValidationError instead of a result")
  }
  return value as Exclude<T, { error: unknown }>
}

const findManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/db/client", () => ({
  prisma: {
    videoImage: {
      findMany: findManyMock,
    },
  },
}))

describe("fetchVideoImageTool", () => {
  beforeEach(() => {
    findManyMock.mockReset()
    vi.resetModules()
  })

  it("returns null when the video has no images", async () => {
    findManyMock.mockResolvedValue([])
    const { fetchVideoImageTool } = await import("./fetch-video-image")
    const result = assertOk(
      await fetchVideoImageTool.execute!(
        { videoId: "vid-1" },
        undefined as never,
      ),
    )
    expect(result).toEqual({ imageUrl: null, variant: null })
  })

  it("prefers mobileCinematicHigh when present", async () => {
    findManyMock.mockResolvedValue([
      {
        mobileCinematicHigh: "https://cdn/mch.jpg",
        videoStill: "https://cdn/still.jpg",
        thumbnail: "https://cdn/thumb.jpg",
        url: "https://cdn/url.jpg",
      },
    ])
    const { fetchVideoImageTool } = await import("./fetch-video-image")
    const result = assertOk(
      await fetchVideoImageTool.execute!(
        { videoId: "vid-1" },
        undefined as never,
      ),
    )
    expect(result).toEqual({
      imageUrl: "https://cdn/mch.jpg",
      variant: "mobileCinematicHigh",
    })
  })

  it("falls through priority order when higher-rank fields are null", async () => {
    findManyMock.mockResolvedValue([
      {
        mobileCinematicHigh: null,
        videoStill: null,
        thumbnail: "https://cdn/thumb.jpg",
        url: null,
      },
    ])
    const { fetchVideoImageTool } = await import("./fetch-video-image")
    const result = assertOk(
      await fetchVideoImageTool.execute!(
        { videoId: "vid-1" },
        undefined as never,
      ),
    )
    expect(result).toEqual({
      imageUrl: "https://cdn/thumb.jpg",
      variant: "thumbnail",
    })
  })

  it("considers all images when picking a variant (scans across rows for the highest-priority field)", async () => {
    findManyMock.mockResolvedValue([
      {
        mobileCinematicHigh: null,
        videoStill: null,
        thumbnail: null,
        url: null,
      },
      {
        mobileCinematicHigh: "https://cdn/mch-from-row-2.jpg",
        videoStill: null,
        thumbnail: null,
        url: null,
      },
    ])
    const { fetchVideoImageTool } = await import("./fetch-video-image")
    const result = assertOk(
      await fetchVideoImageTool.execute!(
        { videoId: "vid-1" },
        undefined as never,
      ),
    )
    expect(result).toEqual({
      imageUrl: "https://cdn/mch-from-row-2.jpg",
      variant: "mobileCinematicHigh",
    })
  })

  it("returns null when every variant on every image is empty/null", async () => {
    findManyMock.mockResolvedValue([
      {
        mobileCinematicHigh: "",
        videoStill: null,
        thumbnail: "",
        url: null,
      },
    ])
    const { fetchVideoImageTool } = await import("./fetch-video-image")
    const result = assertOk(
      await fetchVideoImageTool.execute!(
        { videoId: "vid-1" },
        undefined as never,
      ),
    )
    expect(result).toEqual({ imageUrl: null, variant: null })
  })

  it("rejects empty videoId via Zod", async () => {
    const { fetchVideoImageInputSchema } = await import("./fetch-video-image")
    const parse = fetchVideoImageInputSchema.safeParse({ videoId: "" })
    expect(parse.success).toBe(false)
  })
})
