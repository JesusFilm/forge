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
              primaryLanguageId: "lang-en",
              source: "mux",
              origin: { id: "origin-1" },
              title: [{ value: "Title", language: { id: "lang-en" } }],
              description: [
                { value: "Description", language: { id: "lang-en" } },
              ],
              snippet: [{ value: "Snippet", language: { id: "lang-en" } }],
              imageAlt: [{ value: "Alt", language: { id: "lang-en" } }],
              studyQuestions: [
                {
                  id: "sq-1",
                  value: "Question?",
                  primary: true,
                  order: 1,
                  language: { id: "lang-en" },
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
              children: [{ id: "child-core-1" }],
              locked: false,
              noIndex: false,
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
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "child-1" }),
        upsert: vi.fn().mockResolvedValue({ id: "video-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoLocale: { upsert: vi.fn().mockResolvedValue(undefined) },
      videoImage: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoStudyQuestion: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      bibleCitation: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      videoKeyword: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue(undefined),
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
        create: vi.fn().mockResolvedValue(undefined),
      },
    }
    const prisma = {
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "language-1", coreId: "lang-en", bcp47: "en" },
          ]),
      },
      videoOrigin: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "origin-1", coreId: "origin-1" }]),
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
    expect(tx.video.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          label: "EPISODE",
          videoSource: "MUX",
          originId: "origin-1",
        }),
      }),
    )
    expect(tx.videoStudyQuestion.upsert).toHaveBeenCalled()
    expect(tx.videoImage.upsert).not.toHaveBeenCalled()
    expect(tx.videoSubtitle.upsert).not.toHaveBeenCalled()
    expect(tx.videoRelation.create).toHaveBeenCalledWith({
      data: { parentId: "video-1", childId: "child-1" },
    })
  })
})
