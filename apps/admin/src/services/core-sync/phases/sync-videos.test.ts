import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncVideos } from "./sync-videos"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncVideos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes nested Core video entities into admin-native rows", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce({
        data: {
          bibleBooks: [
            {
              id: "book-1",
              osisId: "John",
              alternateName: null,
              paratextAbbreviation: "JHN",
              isNewTestament: true,
              order: 43,
              name: [{ value: "John", language: { bcp47: "en" } }],
            },
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              id: "video-core-1",
              slug: "video",
              label: "episode",
              publishedAt: "2026-01-01T00:00:00.000Z",
              primaryLanguageId: "lang-es",
              source: "mux",
              origin: { id: "origin-1" },
              title: [
                { value: "Title", language: { id: "lang-en" } },
                { value: "Russian title", language: { id: "lang-ru" } },
              ],
              description: [
                { value: "Description", language: { id: "lang-en" } },
                { value: "Descripcion", language: { id: "lang-es" } },
              ],
              snippet: [
                { value: "Snippet", language: { id: "lang-en" } },
                { value: "Resumen", language: { id: "lang-es" } },
              ],
              imageAlt: [{ value: "Alt", language: { id: "lang-en" } }],
              studyQuestions: [
                {
                  id: "sq-1",
                  value: "Question?",
                  primary: true,
                  order: 1,
                  language: { id: "lang-en" },
                },
                {
                  id: "sq-ru",
                  value: "Russian question?",
                  primary: false,
                  order: 1,
                  language: { id: "lang-ru" },
                },
              ],
              bibleCitations: [
                {
                  id: "citation-1",
                  osisId: "John.3.16",
                  chapterStart: 3,
                  chapterEnd: 3,
                  verseStart: 16,
                  verseEnd: 16,
                  order: 1,
                  bibleBook: { id: "book-1", osisId: "John" },
                },
              ],
              keywords: [{ id: "keyword-1" }],
              children: [
                { id: "child-core-1" },
                { id: "missing-child-core" },
                { id: "child-core-3" },
              ],
              locked: false,
              noIndex: false,
              restrictViewPlatforms: ["watch", "arclight"],
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        },
      } as never)

    const tx = {
      bibleBook: {
        upsert: vi.fn().mockResolvedValue({ id: "book-1" }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "book-1", coreId: "book-1" }]),
      },
      keyword: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "keyword-1", coreId: "keyword-1" }]),
      },
      videoOrigin: {
        upsert: vi.fn().mockResolvedValue({ id: "origin-1" }),
      },
      video: {
        findUnique: vi.fn().mockResolvedValueOnce(null),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { id: "child-1", coreId: "child-core-1" },
            { id: "child-3", coreId: "child-core-3" },
          ]),
        upsert: vi.fn().mockResolvedValue({ id: "video-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoLocale: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "video-locale-1" }),
        update: vi.fn().mockResolvedValue({ id: "video-locale-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoImage: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoStudyQuestion: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "question-1" }),
        update: vi.fn().mockResolvedValue({ id: "question-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      bibleCitation: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoKeyword: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoEdition: {
        upsert: vi.fn().mockResolvedValue({ id: "edition-1" }),
      },
      videoSubtitle: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoRelation: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
    }
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      language: {
        findMany: vi.fn().mockResolvedValue([
          { id: "language-1", coreId: "lang-en", bcp47: "en" },
          { id: "language-es", coreId: "lang-es", bcp47: "es" },
          { id: "language-ru", coreId: "lang-ru", bcp47: "ru" },
        ]),
      },
      videoOrigin: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "origin-1", coreId: "origin-1" }]),
      },
      keyword: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "keyword-1", coreId: "keyword-1" }]),
      },
      bibleBook: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "book-1", coreId: "book-1" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      video: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    const videosQuery = mockedCoreQuery.mock.calls[1][0]
    expect(videosQuery).toContain("title(primary: false)")
    expect(videosQuery).toContain("description(primary: false)")
    expect(videosQuery).toContain("snippet(primary: false)")
    expect(videosQuery).toContain("imageAlt(primary: false)")
    expect(videosQuery).toContain("studyQuestions(primary: false)")
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(tx.video.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          label: "EPISODE",
          videoSource: "MUX",
          originId: "origin-1",
          primaryLanguageId: "language-es",
          restrictViewPlatforms: ["watch", "arclight"],
        }),
        update: expect.objectContaining({
          primaryLanguageId: "language-es",
          restrictViewPlatforms: ["watch", "arclight"],
        }),
      }),
    )
    expect(tx.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locale: "es",
          languageId: "language-es",
          description: "Descripcion",
          snippet: "Resumen",
        }),
      }),
    )
    expect(tx.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locale: "ru",
          languageId: "language-ru",
          title: "Russian title",
        }),
      }),
    )
    expect(tx.videoStudyQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coreId: "sq-ru",
          locale: "ru",
          languageId: "language-ru",
          text: "Russian question?",
        }),
      }),
    )
    expect(tx.videoImage.upsert).not.toHaveBeenCalled()
    expect(tx.videoSubtitle.upsert).not.toHaveBeenCalled()
    expect(tx.videoKeyword.deleteMany).toHaveBeenCalledWith({
      where: { videoId: { in: ["video-1"] } },
    })
    expect(tx.videoRelation.deleteMany).toHaveBeenCalledWith({
      where: { parentId: { in: ["video-1"] } },
    })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
    const relationInsertCall = tx.$executeRaw.mock.calls.find((call) =>
      String.raw({ raw: call[0] as unknown as string[] }).includes(
        'INSERT INTO "video_relation"',
      ),
    )
    expect(relationInsertCall).toBeDefined()
    const relationInsertSql = relationInsertCall
      ? String.raw({ raw: relationInsertCall[0] as unknown as string[] })
      : ""
    expect(relationInsertSql).toContain('"order"')
    expect(relationInsertCall?.[4]).toBe('{"1","3"}')
  })

  it("retries a page transaction when Prisma reports P2024 pool pressure", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce({ data: { bibleBooks: [] } } as never)
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              id: "video-core-1",
              slug: "video",
              label: null,
              publishedAt: null,
              primaryLanguageId: null,
              source: null,
              origin: null,
              title: [
                {
                  value: "Unmapped title",
                  language: { id: "lang-missing" },
                },
              ],
              description: [],
              snippet: [],
              imageAlt: [],
              studyQuestions: [],
              bibleCitations: [],
              keywords: [],
              children: [],
              locked: false,
              noIndex: false,
              restrictViewPlatforms: [],
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        },
      } as never)
      .mockResolvedValueOnce({ data: { videos: [] } } as never)

    const tx = {
      video: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: "video-1" }),
      },
      videoLocale: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoStudyQuestion: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      bibleCitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoKeyword: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoRelation: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const prisma = {
      language: { findMany: vi.fn().mockResolvedValue([]) },
      videoOrigin: { findMany: vi.fn().mockResolvedValue([]) },
      keyword: { findMany: vi.fn().mockResolvedValue([]) },
      bibleBook: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi
        .fn()
        .mockImplementationOnce(
          async (fn: (trx: typeof tx) => Promise<void>) => {
            await fn(tx)
            throw Object.assign(new Error("pool exhausted"), { code: "P2024" })
          },
        )
        .mockImplementationOnce(async (fn: (trx: typeof tx) => Promise<void>) =>
          fn(tx),
        ),
      video: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(stats.updated).toBe(1)
    expect(stats.errors).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "core-sync.video-localized-metadata.skipped-languages",
      ),
    )
    warnSpy.mockRestore()
  })
})
