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

import {
  loadVideoCollectionChildren,
  loadVideoRows,
  videoIdsFromExperienceBlocks,
} from "./live-data"

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

  it("passes a video category through the picker row loader", async () => {
    videoListMock.mockResolvedValue([])

    await loadVideoRows(principal, {
      category: "collections",
      preferredLocale: "es",
    })

    expect(videoListMock).toHaveBeenCalledWith({
      input: {
        category: "collections",
        collection: undefined,
        language: undefined,
        limit: 30,
        offset: 0,
        search: undefined,
        sort: undefined,
      },
      query: {},
    })
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

  it("hydrates direct collection children in relation order", async () => {
    const firstCreated = new Date("2026-05-01T00:00:00.000Z")
    const secondCreated = new Date("2026-05-02T00:00:00.000Z")
    const unorderedCreated = new Date("2026-05-03T00:00:00.000Z")
    prismaMock.videoRelation.findMany
      .mockResolvedValueOnce([
        {
          childId: "unordered-child",
          order: null,
          createdAt: unorderedCreated,
        },
        { childId: "second-child", order: 2, createdAt: secondCreated },
        { childId: "first-child", order: 1, createdAt: firstCreated },
      ])
      .mockResolvedValueOnce([])
    prismaMock.video.findMany.mockResolvedValue([
      videoRow("unordered-child", "core-unordered", "unordered"),
      videoRow("second-child", "core-second", "second"),
      videoRow("first-child", "core-first", "first"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "first-child",
        locale: "en",
        title: "First",
        description: null,
        updatedAt: now,
      },
      {
        videoId: "second-child",
        locale: "en",
        title: "Second",
        description: null,
        updatedAt: now,
      },
      {
        videoId: "unordered-child",
        locale: "en",
        title: "Unordered",
        description: null,
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([])

    const rows = await loadVideoCollectionChildren(principal, "collection-1", {
      preferredLocale: "en",
    })

    expect(rows.map((row) => row.key)).toEqual([
      "first-child",
      "second-child",
      "unordered-child",
    ])
    expect(prismaMock.videoRelation.findMany).toHaveBeenNthCalledWith(1, {
      where: { parentId: "collection-1", child: { deletedAt: null } },
      select: { childId: true, order: true, createdAt: true },
    })
  })

  it("omits unresolved collection children without disturbing order", async () => {
    prismaMock.videoRelation.findMany
      .mockResolvedValueOnce([
        { childId: "missing-child", order: 1, createdAt: now },
        { childId: "available-child", order: 2, createdAt: now },
      ])
      .mockResolvedValueOnce([])
    prismaMock.video.findMany.mockResolvedValue([
      videoRow("available-child", "core-available", "available"),
    ])
    prismaMock.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "available-child",
        locale: "en",
        title: "Available",
        description: null,
        updatedAt: now,
      },
    ])
    prismaMock.videoImage.findMany.mockResolvedValue([])

    const rows = await loadVideoCollectionChildren(principal, "collection-1")

    expect(rows.map((row) => row.key)).toEqual(["available-child"])
  })

  it("returns no collection children without running video hydration", async () => {
    prismaMock.videoRelation.findMany.mockResolvedValue([])

    await expect(
      loadVideoCollectionChildren(principal, "empty-collection"),
    ).resolves.toEqual([])
    expect(prismaMock.video.findMany).not.toHaveBeenCalled()
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
