import { describe, expect, it, vi } from "vitest"

import { syncVideoLocalizedMetadata } from "./video-localized-metadata"

function buildPrisma() {
  return {
    videoLocale: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "locale-1" }),
      update: vi.fn().mockResolvedValue({ id: "locale-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    videoStudyQuestion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "question-1" }),
      update: vi.fn().mockResolvedValue({ id: "question-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
}

describe("syncVideoLocalizedMetadata", () => {
  it("persists BCP-47 and no-BCP47 display rows by language identity", async () => {
    const prisma = buildPrisma()

    const result = await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          publishedAt: "2026-01-01T00:00:00.000Z",
          title: [
            { value: "English", language: { id: "lang-en" } },
            { value: "Mystery", language: { id: "lang-no-bcp47" } },
          ],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [],
        },
      ],
      languageIdByCoreId: new Map([
        ["lang-en", "language-en"],
        ["lang-no-bcp47", "language-no-bcp47"],
      ]),
      bcp47ByCoreId: new Map([
        ["lang-en", "en"],
        ["lang-no-bcp47", null],
      ]),
      slugByCoreId: new Map([
        ["lang-en", "english"],
        ["lang-no-bcp47", "mystery-language"],
      ]),
    })

    expect(result.videoLocalesUpserted).toBe(2)
    expect(prisma.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          videoId: "video-1",
          locale: "en",
          languageId: "language-en",
          languageSlug: "english",
          languageCoreId: "lang-en",
          title: "English",
        }),
      }),
    )
    for (const [{ data }] of prisma.videoLocale.create.mock.calls) {
      expect(data).not.toHaveProperty("searchTitle")
      expect(data).not.toHaveProperty("searchDescription")
      expect(data).not.toHaveProperty("socialImageAssetId")
    }
    expect(prisma.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          videoId: "video-1",
          locale: null,
          languageId: "language-no-bcp47",
          languageSlug: "mystery-language",
          languageCoreId: "lang-no-bcp47",
          title: "Mystery",
        }),
      }),
    )
  })

  it("persists two display rows when variants share one BCP-47 locale", async () => {
    const prisma = buildPrisma()

    const result = await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [
            { value: "Russian", language: { id: "lang-ru" } },
            { value: "Russian Alt", language: { id: "lang-ru-alt" } },
          ],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [],
        },
      ],
      languageIdByCoreId: new Map([
        ["lang-ru", "language-ru"],
        ["lang-ru-alt", "language-ru-alt"],
      ]),
      bcp47ByCoreId: new Map([
        ["lang-ru", "ru"],
        ["lang-ru-alt", "ru"],
      ]),
      slugByCoreId: new Map([
        ["lang-ru", "russian"],
        ["lang-ru-alt", "russian-alt"],
      ]),
    })

    expect(result.videoLocalesUpserted).toBe(2)
    expect(prisma.videoLocale.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { videoId: "video-1", languageId: "language-ru" },
      }),
    )
    expect(prisma.videoLocale.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { videoId: "video-1", languageId: "language-ru-alt" },
      }),
    )
    expect(prisma.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locale: "ru",
          languageId: "language-ru",
          languageSlug: "russian",
          languageCoreId: "lang-ru",
          title: "Russian",
        }),
      }),
    )
    expect(prisma.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locale: "ru",
          languageId: "language-ru-alt",
          languageSlug: "russian-alt",
          languageCoreId: "lang-ru-alt",
          title: "Russian Alt",
        }),
      }),
    )
  })

  it("persists study questions by video, Core question, and language identity", async () => {
    const prisma = buildPrisma()

    const result = await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [
            {
              id: "question-core-1",
              value: "Russian question?",
              language: { id: "lang-ru" },
            },
            {
              id: "question-core-1",
              value: "Russian alt question?",
              language: { id: "lang-ru-alt" },
            },
          ],
        },
      ],
      languageIdByCoreId: new Map([
        ["lang-ru", "language-ru"],
        ["lang-ru-alt", "language-ru-alt"],
      ]),
      bcp47ByCoreId: new Map([
        ["lang-ru", "ru"],
        ["lang-ru-alt", "ru"],
      ]),
      slugByCoreId: new Map([
        ["lang-ru", "russian"],
        ["lang-ru-alt", "russian-alt"],
      ]),
      complete: false,
    })

    expect(result.studyQuestionsUpserted).toBe(2)
    expect(prisma.videoStudyQuestion.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          videoId: "video-1",
          coreId: "question-core-1",
          languageId: "language-ru",
        },
      }),
    )
    expect(prisma.videoStudyQuestion.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          videoId: "video-1",
          coreId: "question-core-1",
          languageId: "language-ru-alt",
        },
      }),
    )
    expect(prisma.videoStudyQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          videoId: "video-1",
          coreId: "question-core-1",
          languageId: "language-ru",
          languageSlug: "russian",
          languageCoreId: "lang-ru",
          text: "Russian question?",
        }),
      }),
    )
    expect(prisma.videoStudyQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          videoId: "video-1",
          coreId: "question-core-1",
          languageId: "language-ru-alt",
          languageSlug: "russian-alt",
          languageCoreId: "lang-ru-alt",
          text: "Russian alt question?",
        }),
      }),
    )
  })

  it("reports missing local language rows without logging localized text", async () => {
    const prisma = buildPrisma()

    const result = await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [{ value: "Do not log me", language: { id: "lang-missing" } }],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [],
        },
      ],
      languageIdByCoreId: new Map(),
      bcp47ByCoreId: new Map([["lang-missing", "zz"]]),
      slugByCoreId: new Map([["lang-missing", "missing-language"]]),
    })

    expect(result.skippedLanguages).toBe(1)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        languageCoreId: "lang-missing",
        reason: "missing_local_language",
      }),
    ])
    expect(JSON.stringify(result.diagnostics)).not.toContain("Do not log me")
    expect(prisma.videoLocale.create).not.toHaveBeenCalled()
  })

  it("does not overwrite manager-owned localized display rows", async () => {
    const prisma = buildPrisma()
    prisma.videoLocale.findFirst.mockResolvedValueOnce({
      id: "locale-1",
      source: "MANAGER",
    })

    const result = await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [{ value: "Core title", language: { id: "lang-en" } }],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [],
        },
      ],
      languageIdByCoreId: new Map([["lang-en", "language-en"]]),
      bcp47ByCoreId: new Map([["lang-en", "en"]]),
      slugByCoreId: new Map([["lang-en", "english"]]),
    })

    expect(result.videoLocalesUpserted).toBe(0)
    expect(prisma.videoLocale.update).not.toHaveBeenCalled()
    expect(prisma.videoLocale.create).not.toHaveBeenCalled()
  })

  it("preserves editor-owned overlays while refreshing a Core locale", async () => {
    const prisma = buildPrisma()
    prisma.videoLocale.findFirst.mockResolvedValueOnce({
      id: "locale-1",
      source: "CORE",
    })

    await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [{ value: "Refreshed title", language: { id: "lang-en" } }],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [],
        },
      ],
      languageIdByCoreId: new Map([["lang-en", "language-en"]]),
      bcp47ByCoreId: new Map([["lang-en", "en"]]),
      slugByCoreId: new Map([["lang-en", "english"]]),
    })

    const update = prisma.videoLocale.update.mock.calls[0]?.[0]
    expect(update?.data).toMatchObject({
      title: "Refreshed title",
      deletedAt: null,
    })
    expect(update?.data).not.toHaveProperty("searchTitle")
    expect(update?.data).not.toHaveProperty("searchDescription")
    expect(update?.data).not.toHaveProperty("socialImageAssetId")
  })

  it("does not update a locale-keyed row when Core language identity is known", async () => {
    const prisma = buildPrisma()
    prisma.videoLocale.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "legacy-locale", source: "CORE" })
    prisma.videoStudyQuestion.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "legacy-question", source: "CORE" })

    await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [{ value: "French title", language: { id: "lang-fr" } }],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [
            {
              id: "question-core-1",
              value: "Question francaise?",
              language: { id: "lang-fr" },
            },
          ],
        },
      ],
      languageIdByCoreId: new Map([["lang-fr", "language-fr"]]),
      bcp47ByCoreId: new Map([["lang-fr", "fr"]]),
      slugByCoreId: new Map([["lang-fr", "french"]]),
    })

    expect(prisma.videoLocale.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { videoId: "video-1", languageId: "language-fr" },
      }),
    )
    expect(prisma.videoLocale.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          videoId: "video-1",
          languageId: "language-fr",
          languageSlug: "french",
          languageCoreId: "lang-fr",
          locale: "fr",
        }),
      }),
    )
    expect(prisma.videoLocale.update).not.toHaveBeenCalled()
    expect(prisma.videoStudyQuestion.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.videoStudyQuestion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          videoId: "video-1",
          coreId: "question-core-1",
          languageId: "language-fr",
        },
      }),
    )
    expect(prisma.videoStudyQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coreId: "question-core-1",
          languageId: "language-fr",
          languageSlug: "french",
          languageCoreId: "lang-fr",
          locale: "fr",
        }),
      }),
    )
    expect(prisma.videoStudyQuestion.update).not.toHaveBeenCalled()
  })

  it("stales untouched Core rows after a complete sync", async () => {
    const prisma = buildPrisma()
    prisma.videoLocale.create.mockResolvedValueOnce({ id: "locale-touched" })
    prisma.videoStudyQuestion.create.mockResolvedValueOnce({
      id: "question-touched",
    })
    prisma.videoLocale.updateMany.mockResolvedValueOnce({ count: 1 })
    prisma.videoStudyQuestion.updateMany.mockResolvedValueOnce({ count: 2 })
    const now = new Date("2026-06-01T00:00:00.000Z")

    const result = await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [{ value: "English", language: { id: "lang-en" } }],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [
            {
              id: "sq-en",
              value: "Question?",
              language: { id: "lang-en" },
            },
          ],
        },
      ],
      languageIdByCoreId: new Map([["lang-en", "language-en"]]),
      bcp47ByCoreId: new Map([["lang-en", "en"]]),
      slugByCoreId: new Map([["lang-en", "english"]]),
      now,
    })

    expect(result.videoLocalesStaled).toBe(1)
    expect(result.studyQuestionsStaled).toBe(2)
    expect(prisma.videoLocale.updateMany).toHaveBeenCalledWith({
      where: {
        videoId: "video-1",
        source: "CORE",
        id: { notIn: ["locale-touched"] },
        deletedAt: null,
      },
      data: { deletedAt: now },
    })
    const staleData = prisma.videoLocale.updateMany.mock.calls[0]?.[0]?.data
    expect(staleData).not.toHaveProperty("searchTitle")
    expect(staleData).not.toHaveProperty("searchDescription")
    expect(staleData).not.toHaveProperty("socialImageAssetId")
    expect(prisma.videoStudyQuestion.updateMany).toHaveBeenCalledWith({
      where: {
        videoId: "video-1",
        source: "CORE",
        id: { notIn: ["question-touched"] },
        deletedAt: null,
      },
      data: { deletedAt: now },
    })
  })

  it("does not stale rows when the localized response skipped an unresolved language", async () => {
    const prisma = buildPrisma()

    const result = await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [{ value: "Missing", language: { id: "lang-missing" } }],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [],
        },
      ],
      languageIdByCoreId: new Map(),
      bcp47ByCoreId: new Map([["lang-missing", null]]),
      slugByCoreId: new Map([["lang-missing", "missing-language"]]),
    })

    expect(result.skippedLanguages).toBe(1)
    expect(prisma.videoLocale.updateMany).not.toHaveBeenCalled()
    expect(prisma.videoStudyQuestion.updateMany).not.toHaveBeenCalled()
  })

  it("skips stale cleanup when complete is false", async () => {
    const prisma = buildPrisma()

    await syncVideoLocalizedMetadata({
      prisma: prisma as never,
      adminVideos: [{ id: "video-1", coreId: "core-video-1" }],
      coreVideos: [
        {
          id: "core-video-1",
          title: [{ value: "English", language: { id: "lang-en" } }],
          description: [],
          snippet: [],
          imageAlt: [],
          studyQuestions: [],
        },
      ],
      languageIdByCoreId: new Map([["lang-en", "language-en"]]),
      bcp47ByCoreId: new Map([["lang-en", "en"]]),
      slugByCoreId: new Map([["lang-en", "english"]]),
      complete: false,
    })

    expect(prisma.videoLocale.updateMany).not.toHaveBeenCalled()
    expect(prisma.videoStudyQuestion.updateMany).not.toHaveBeenCalled()
  })
})
