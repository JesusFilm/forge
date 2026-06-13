import { beforeEach, describe, expect, it, vi } from "vitest"
import { MANAGER_BACKEND_PRINCIPAL, type Principal } from "@/auth/principal"
import { ManagerReadModelService } from "./manager-read-model.service"

function mockPrisma() {
  return {
    continent: { findMany: vi.fn() },
    country: { findMany: vi.fn() },
    language: { findMany: vi.fn() },
    video: { findMany: vi.fn() },
    videoSubtitle: { groupBy: vi.fn() },
    videoDub: { groupBy: vi.fn() },
    managerCoverageSnapshot: { findMany: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const PUBLIC_USER: Principal | null = null

describe("ManagerReadModelService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ManagerReadModelService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ManagerReadModelService(prisma)
  })

  it("rejects unauthenticated Manager read-model callers", async () => {
    await expect(service.getLanguageGeo({ user: PUBLIC_USER })).rejects.toThrow(
      "Forbidden",
    )
  })

  it("builds the language geo shape from Admin Core reference rows", async () => {
    prisma.continent.findMany.mockResolvedValueOnce([
      {
        id: "cont-1",
        name: { en: "North America" },
        locales: [{ locale: "en", value: "North America" }],
      },
    ])
    prisma.country.findMany.mockResolvedValueOnce([
      {
        id: "country-1",
        name: { en: "Canada" },
        continentId: "cont-1",
        locales: [{ locale: "en", value: "Canada" }],
        countryLanguages: [
          {
            languageId: "lang-1",
            speakers: 100,
            language: {
              id: "lang-1",
              coreId: "529",
              bcp47: "en",
              iso3: "eng",
              name: { en: "English", native: "English" },
              locales: [{ locale: "en", value: "English" }],
            },
          },
        ],
      },
    ])
    prisma.language.findMany.mockResolvedValueOnce([
      {
        id: "lang-1",
        coreId: "529",
        bcp47: "en",
        iso3: "eng",
        name: { en: "English", native: "English" },
        locales: [{ locale: "en", value: "English" }],
      },
    ])

    const result = await service.getLanguageGeo({
      user: MANAGER_BACKEND_PRINCIPAL,
    })

    expect(result).toEqual({
      continents: [{ id: "cont-1", name: "North America" }],
      countries: [{ id: "country-1", name: "Canada", continentId: "cont-1" }],
      languages: [
        {
          id: "lang-1",
          coreId: "529",
          bcp47: "en",
          iso3: "eng",
          englishLabel: "English",
          nativeLabel: "English",
          countryIds: ["country-1"],
          continentIds: ["cont-1"],
          countrySpeakers: { "country-1": 100 },
        },
      ],
    })
  })

  it("preserves the video universe while changing language-scoped counts", async () => {
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-1",
        slug: "video-one",
        label: "SHORT_FILM",
        aiMetadata: true,
        locales: [{ locale: "en", languageId: "lang-en", title: "Video One" }],
        images: [{ url: "https://example.test/image.jpg" }],
        parents: [{ parentId: "parent-1" }],
      },
    ])
    prisma.videoSubtitle.groupBy.mockResolvedValueOnce([
      {
        videoId: "video-1",
        aiGenerated: false,
        _count: { _all: 1 },
      },
    ])
    prisma.videoDub.groupBy.mockResolvedValueOnce([
      {
        videoId: "video-1",
        aiGenerated: false,
        _count: { _all: 1 },
      },
    ])

    const result = await service.getVideoCoverage({
      user: MANAGER_BACKEND_PRINCIPAL,
      languageIds: ["lang-a"],
    })

    expect(result).toEqual([
      {
        documentId: "video-1",
        coreId: "core-1",
        title: "Video One",
        label: "SHORT_FILM",
        slug: "video-one",
        aiMetadata: true,
        imageUrl: "https://example.test/image.jpg",
        parentDocumentIds: ["parent-1"],
        coverage: {
          subtitles: { human: 1, ai: 0 },
          audio: { human: 1, ai: 0 },
        },
      },
    ])
    expect(prisma.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          locales: expect.objectContaining({
            where: {
              deletedAt: null,
              title: { not: null },
              OR: [{ locale: "en" }, { languageId: { in: ["lang-a"] } }],
            },
          }),
        }),
      }),
    )
    expect(prisma.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.not.objectContaining({
          subtitles: expect.anything(),
          dubs: expect.anything(),
        }),
      }),
    )
    expect(prisma.videoSubtitle.groupBy).toHaveBeenCalledWith({
      by: ["videoId", "aiGenerated"],
      where: {
        deletedAt: null,
        videoId: { in: ["video-1"] },
        languageId: { in: ["lang-a"] },
      },
      _count: { _all: true },
    })
    expect(prisma.videoDub.groupBy).toHaveBeenCalledWith({
      by: ["videoId", "aiGenerated"],
      where: {
        deletedAt: null,
        videoId: { in: ["video-1"] },
        languageId: { in: ["lang-a"] },
      },
      _count: { _all: true },
    })
  })

  it("builds enrichment video metadata from selected Admin or Core IDs", async () => {
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-doc-1",
        coreId: "video-core-1",
        primaryLanguage: {
          coreId: "529",
          bcp47: "en",
          iso3: "eng",
        },
        dubs: [
          {
            language: {
              coreId: "529",
              bcp47: "en",
              iso3: "eng",
            },
            muxVideo: {
              assetId: "mux-asset-1",
              playbackId: "mux-playback-1",
            },
            downloads: [
              { url: "https://stream.mux.com/source/720p.mp4" },
              { url: null },
            ],
          },
        ],
      },
    ])

    const result = await service.getVideosForEnrichment({
      user: MANAGER_BACKEND_PRINCIPAL,
      ids: ["video-doc-1", "video-core-1", "video-doc-1"],
    })

    expect(result).toEqual([
      {
        documentId: "video-doc-1",
        coreId: "video-core-1",
        primaryLanguage: {
          coreId: "529",
          bcp47: "en",
          iso3: "eng",
        },
        variants: [
          {
            language: {
              coreId: "529",
              bcp47: "en",
              iso3: "eng",
            },
            muxVideo: {
              assetId: "mux-asset-1",
              playbackId: "mux-playback-1",
            },
            downloads: [
              { url: "https://stream.mux.com/source/720p.mp4" },
              { url: null },
            ],
          },
        ],
      },
    ])
    expect(prisma.video.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          { id: { in: ["video-doc-1", "video-core-1"] } },
          { coreId: { in: ["video-doc-1", "video-core-1"] } },
        ],
      },
      include: expect.objectContaining({
        primaryLanguage: {
          select: { coreId: true, bcp47: true, iso3: true },
        },
        dubs: expect.objectContaining({
          where: { deletedAt: null },
          include: expect.objectContaining({
            language: {
              select: { coreId: true, bcp47: true, iso3: true },
            },
            muxVideo: {
              select: { assetId: true, playbackId: true },
            },
            downloads: expect.objectContaining({
              where: { deletedAt: null },
              select: { url: true },
            }),
          }),
        }),
      }),
    })
  })

  it("caps enrichment video lookup requests at 100 IDs", async () => {
    await expect(
      service.getVideosForEnrichment({
        user: MANAGER_BACKEND_PRINCIPAL,
        ids: Array.from({ length: 101 }, (_, index) => `video-${index}`),
      }),
    ).rejects.toThrow("ids.length=101 exceeds max 100")

    expect(prisma.video.findMany).not.toHaveBeenCalled()
  })

  it("prefers English video titles over newer non-English locales", async () => {
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-1",
        slug: "video-one",
        label: "SHORT_FILM",
        aiMetadata: false,
        locales: [
          { locale: "ja", languageId: "lang-ja", title: "Japanese Title" },
          { locale: "en", languageId: "lang-en", title: "English Title" },
        ],
        images: [],
        parents: [],
      },
    ])
    prisma.videoSubtitle.groupBy.mockResolvedValueOnce([])
    prisma.videoDub.groupBy.mockResolvedValueOnce([])

    const result = await service.getVideoCoverage({
      user: MANAGER_BACKEND_PRINCIPAL,
      languageIds: ["lang-en", "lang-be"],
    })

    expect(result[0]?.title).toBe("English Title")
  })

  it("uses a selected-language title when English is absent", async () => {
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-1",
        slug: "video-one",
        label: "SHORT_FILM",
        aiMetadata: false,
        locales: [
          { locale: "ja", languageId: "lang-ja", title: "Japanese Title" },
          { locale: "be", languageId: "lang-be", title: "Belarusian Title" },
        ],
        images: [],
        parents: [],
      },
    ])
    prisma.videoSubtitle.groupBy.mockResolvedValueOnce([])
    prisma.videoDub.groupBy.mockResolvedValueOnce([])

    const result = await service.getVideoCoverage({
      user: MANAGER_BACKEND_PRINCIPAL,
      languageIds: ["lang-be"],
    })

    expect(result[0]?.title).toBe("Belarusian Title")
  })

  it("falls back to the Manager slug path when no preferred locale exists", async () => {
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-1",
        slug: "video-one",
        label: "SHORT_FILM",
        aiMetadata: false,
        locales: [
          { locale: "ja", languageId: "lang-ja", title: "Japanese Title" },
        ],
        images: [],
        parents: [],
      },
    ])
    prisma.videoSubtitle.groupBy.mockResolvedValueOnce([])
    prisma.videoDub.groupBy.mockResolvedValueOnce([])

    const result = await service.getVideoCoverage({
      user: MANAGER_BACKEND_PRINCIPAL,
      languageIds: ["lang-be"],
    })

    expect(result[0]?.title).toBeNull()
  })
})
