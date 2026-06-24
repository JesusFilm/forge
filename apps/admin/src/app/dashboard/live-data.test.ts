import { beforeEach, describe, expect, it, vi } from "vitest"

const { prismaMock, videoListMock } = vi.hoisted(() => ({
  prismaMock: {
    video: {
      findMany: vi.fn(),
    },
    videoDub: {
      findMany: vi.fn(),
    },
    videoImage: {
      findMany: vi.fn(),
    },
    videoLocale: {
      findMany: vi.fn(),
    },
    videoRelation: {
      findMany: vi.fn(),
    },
    videoStudyQuestion: {
      findMany: vi.fn(),
    },
    bibleCitation: {
      findMany: vi.fn(),
    },
  },
  videoListMock: vi.fn(),
}))

vi.mock("@/db/client", () => ({
  prisma: prismaMock,
}))

vi.mock("@/i18n/server", () => ({
  getAdminLocale: vi.fn(async () => "en"),
}))

vi.mock("@/services", () => ({
  createServices: vi.fn(() => ({
    video: {
      list: videoListMock,
    },
  })),
}))

import { loadVideoRows, videoIdsFromExperienceBlocks } from "./live-data"

const principal = { id: "user-1", role: "ADMIN" } as never
const now = new Date("2026-05-11T00:00:00.000Z")

function videoRow(id: string, coreId: string, slug: string, updatedAt = now) {
  return {
    id,
    coreId,
    source: "CORE",
    slug,
    label: null,
    videoSource: null,
    publishedAt: null,
    locked: false,
    noIndex: false,
    aiMetadata: false,
    primaryLanguageId: null,
    originId: null,
    syncedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt,
  }
}

describe("dashboard live data", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.videoDub.findMany.mockResolvedValue([])
    prismaMock.videoRelation.findMany.mockResolvedValue([])
    prismaMock.videoStudyQuestion.findMany.mockResolvedValue([])
    prismaMock.bibleCitation.findMany.mockResolvedValue([])
  })

  it("extracts video ids from nested experience blocks", () => {
    expect(
      videoIdsFromExperienceBlocks([
        {
          t: "section",
          sectionKey: "watch-next",
          content: [
            {
              t: "mediaCollection",
              sectionKey: "related",
              variant: "grid",
              itemsSource: "manual",
              showItemNumbers: false,
              items: [
                { videoId: "older-video-1" },
                { videoId: "older-video-2" },
              ],
            },
          ],
        },
      ]),
    ).toEqual(["older-video-1", "older-video-2"])
  })

  it("hydrates explicitly referenced videos outside the recent-video page", async () => {
    videoListMock.mockResolvedValue([
      videoRow("recent-video", "core-recent", "recent"),
    ])
    prismaMock.video.findMany.mockResolvedValue([
      videoRow("older-video", "core-older", "older"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "recent-video",
        locale: "en",
        title: "Recent Video",
        description: null,
        updatedAt: now,
      },
      {
        videoId: "older-video",
        locale: "en",
        title: "Older Video",
        description: "Referenced by the current experience.",
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([
      {
        videoId: "older-video",
        url: "https://example.com/older.jpg",
        kind: null,
        createdAt: now,
      },
    ])

    const rows = await loadVideoRows(principal, {
      includeVideoIds: ["older-video", "recent-video"],
    })

    expect(prismaMock.video.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["older-video"] }, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        coreId: true,
        slug: true,
        label: true,
        videoSource: true,
        updatedAt: true,
      },
    })
    expect(rows.map((row) => row.key)).toEqual(["recent-video", "older-video"])
    expect(rows.find((row) => row.key === "older-video")?.previewImageUrl).toBe(
      "https://example.com/older.jpg",
    )
  })

  it("skips the top-up query when every includeVideoIds is already on the first page", async () => {
    videoListMock.mockResolvedValue([
      videoRow("recent-video", "core-recent", "recent"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "recent-video",
        locale: "en",
        title: "Recent Video",
        description: null,
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([])

    const rows = await loadVideoRows(principal, {
      includeVideoIds: ["recent-video"],
    })

    expect(prismaMock.video.findMany).not.toHaveBeenCalled()
    expect(rows.map((row) => row.key)).toEqual(["recent-video"])
  })

  it("dedupes includeVideoIds before the top-up query", async () => {
    videoListMock.mockResolvedValue([
      videoRow("recent-video", "core-recent", "recent"),
    ])
    prismaMock.video.findMany.mockResolvedValue([
      videoRow("older-video", "core-older", "older"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "recent-video",
        locale: "en",
        title: "Recent Video",
        description: null,
        updatedAt: now,
      },
      {
        videoId: "older-video",
        locale: "en",
        title: "Older Video",
        description: null,
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([])

    const rows = await loadVideoRows(principal, {
      includeVideoIds: ["older-video", "older-video"],
    })

    expect(prismaMock.video.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.video.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["older-video"] }, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        coreId: true,
        slug: true,
        label: true,
        videoSource: true,
        updatedAt: true,
      },
    })
    expect(rows.map((row) => row.key)).toEqual(["recent-video", "older-video"])
  })

  it("flags hasGrounding for a video with at least one study question", async () => {
    videoListMock.mockResolvedValue([
      videoRow("grounded-video", "core-grounded", "grounded"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "grounded-video",
        locale: "en",
        title: "Grounded Video",
        description: null,
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([])
    prismaMock.videoStudyQuestion.findMany.mockResolvedValue([
      { videoId: "grounded-video" },
    ])

    const rows = await loadVideoRows(principal)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe("grounded-video")
    expect(rows[0]?.hasGrounding).toBe(true)
  })

  it("flags hasGrounding for a video with a citation but no study questions", async () => {
    videoListMock.mockResolvedValue([
      videoRow("cited-video", "core-cited", "cited"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "cited-video",
        locale: "en",
        title: "Cited Video",
        description: null,
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([])
    prismaMock.videoStudyQuestion.findMany.mockResolvedValue([])
    prismaMock.bibleCitation.findMany.mockResolvedValue([
      { videoId: "cited-video" },
    ])

    const rows = await loadVideoRows(principal)

    expect(rows[0]?.hasGrounding).toBe(true)
  })

  it("leaves hasGrounding false when a video has neither study questions nor citations", async () => {
    videoListMock.mockResolvedValue([
      videoRow("bare-video", "core-bare", "bare"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "bare-video",
        locale: "en",
        title: "Bare Video",
        description: null,
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([])

    const rows = await loadVideoRows(principal)

    expect(rows[0]?.key).toBe("bare-video")
    expect(rows[0]?.hasGrounding).toBe(false)
  })
})
