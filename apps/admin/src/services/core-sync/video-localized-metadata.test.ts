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
    })

    expect(result.videoLocalesUpserted).toBe(2)
    expect(prisma.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          videoId: "video-1",
          locale: "en",
          languageId: "language-en",
          title: "English",
        }),
      }),
    )
    expect(prisma.videoLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          videoId: "video-1",
          locale: null,
          languageId: "language-no-bcp47",
          title: "Mystery",
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
    })

    expect(result.videoLocalesUpserted).toBe(0)
    expect(prisma.videoLocale.update).not.toHaveBeenCalled()
    expect(prisma.videoLocale.create).not.toHaveBeenCalled()
  })

  it("updates legacy locale-keyed rows when language identity is newly available", async () => {
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
    })

    expect(prisma.videoLocale.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { videoId: "video-1", languageId: "language-fr" },
      }),
    )
    expect(prisma.videoLocale.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { videoId: "video-1", locale: "fr" },
      }),
    )
    expect(prisma.videoLocale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "legacy-locale" },
        data: expect.objectContaining({
          languageId: "language-fr",
          locale: "fr",
          deletedAt: null,
        }),
      }),
    )
    expect(prisma.videoLocale.create).not.toHaveBeenCalled()
    expect(prisma.videoStudyQuestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "legacy-question" },
        data: expect.objectContaining({
          languageId: "language-fr",
          locale: "fr",
          deletedAt: null,
        }),
      }),
    )
    expect(prisma.videoStudyQuestion.create).not.toHaveBeenCalled()
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
      complete: false,
    })

    expect(prisma.videoLocale.updateMany).not.toHaveBeenCalled()
    expect(prisma.videoStudyQuestion.updateMany).not.toHaveBeenCalled()
  })
})
