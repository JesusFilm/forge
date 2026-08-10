import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "./errors"
import {
  mapVideoSearchSocialError,
  VideoSearchSocialInvalidAssetError,
  VideoSearchSocialService,
  VideoSearchSocialStaleDraftError,
} from "./video-search-social.service"

const { emitRevalidateWebhook } = vi.hoisted(() => ({
  emitRevalidateWebhook: vi.fn(),
}))

vi.mock("./revalidate-webhook", () => ({ emitRevalidateWebhook }))

function mockPrisma() {
  const tx = {
    $queryRaw: vi.fn(),
    contentRevision: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    videoLocale: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    mediaAsset: { findFirst: vi.fn() },
  }
  return {
    ...tx,
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  }
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }
const auditLog = vi.spyOn(console, "log").mockImplementation(() => undefined)

const activeLocale = {
  id: "locale-1",
  videoId: "video-1",
  locale: "en",
  languageSlug: "english",
  languageId: "language-1",
  languageCoreId: "529",
  source: "MANAGER",
  status: "PUBLISHED",
  title: "JESUS",
  description: "Visible description",
  snippet: null,
  imageAlt: null,
  searchTitle: null,
  searchDescription: null,
  socialImageAssetId: null,
  publishedAt: new Date("2026-07-01T00:00:00.000Z"),
  syncedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T12:00:00.000Z"),
  video: { slug: "jesus" },
}

function seoDraftSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    data: {
      id: activeLocale.id,
      videoId: activeLocale.videoId,
      locale: activeLocale.locale,
      updatedAt: activeLocale.updatedAt.toISOString(),
      title: "JESUS — Watch",
      description: activeLocale.description,
      snippet: activeLocale.snippet,
      imageAlt: activeLocale.imageAlt,
      searchTitle: "Watch JESUS",
      searchDescription: "Watch the JESUS film.",
      socialImageAssetId: null,
      ...overrides,
    },
  }
}

describe("VideoSearchSocialService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: VideoSearchSocialService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new VideoSearchSocialService(prisma as never)
    emitRevalidateWebhook.mockReset()
    auditLog.mockClear()
    emitRevalidateWebhook.mockResolvedValue({ status: "sent", httpStatus: 200 })
  })

  it("authorizes before parsing or looking up resources", async () => {
    await expect(
      service.save({ user: EDITOR, input: { videoLocaleId: "" } }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.videoLocale.findFirst).not.toHaveBeenCalled()
    expect(prisma.mediaAsset.findFirst).not.toHaveBeenCalled()
  })

  it("validates and writes only normalized overlay fields atomically", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)
    prisma.mediaAsset.findFirst.mockResolvedValue({ id: "asset-1" })
    prisma.videoLocale.updateMany.mockResolvedValue({ count: 1 })

    const result = await service.save({
      user: ADMIN,
      input: {
        videoLocaleId: "locale-1",
        searchTitle: "  Better title  ",
        searchDescription: "   ",
        socialImageAssetId: "asset-1",
      },
    })

    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        kind: "IMAGE",
        status: "READY",
        visibility: "PUBLIC",
        OR: [{ objectKey: { not: null } }, { previewObjectKey: { not: null } }],
      },
      select: { id: true },
    })
    expect(prisma.videoLocale.updateMany).toHaveBeenCalledWith({
      where: {
        id: "locale-1",
        deletedAt: null,
        status: { not: "ARCHIVED" },
        video: { deletedAt: null },
      },
      data: {
        searchTitle: "Better title",
        searchDescription: null,
        socialImageAssetId: "asset-1",
      },
    })
    expect(result).toMatchObject({
      searchTitle: "Better title",
      searchDescription: null,
      socialImageAssetId: "asset-1",
    })
  })

  it("loads one exact active locale for an authorized admin", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)

    await expect(
      service.get({ user: ADMIN, input: { videoLocaleId: "locale-1" } }),
    ).resolves.toMatchObject({
      videoLocaleId: "locale-1",
      slug: "jesus",
      sourceTitle: "JESUS",
    })
    expect(prisma.videoLocale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "ARCHIVED" } }),
      }),
    )
  })

  it("rejects an invalid managed asset before any overlay update", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)
    prisma.mediaAsset.findFirst.mockResolvedValue(null)

    await expect(
      service.save({
        user: ADMIN,
        input: {
          videoLocaleId: "locale-1",
          searchTitle: "Better title",
          searchDescription: null,
          socialImageAssetId: "private-asset",
        },
      }),
    ).rejects.toBeInstanceOf(VideoSearchSocialInvalidAssetError)

    expect(prisma.videoLocale.updateMany).not.toHaveBeenCalled()
  })

  it("revalidates exact published route identity after commit", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)
    prisma.videoLocale.updateMany.mockResolvedValue({ count: 1 })

    await service.save({
      user: ADMIN,
      input: {
        videoLocaleId: "locale-1",
        searchTitle: null,
        searchDescription: null,
        socialImageAssetId: null,
      },
    })

    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      emitRevalidateWebhook.mock.invocationCallOrder[0],
    )
    expect(emitRevalidateWebhook).toHaveBeenCalledWith({
      model: "video",
      slug: "jesus",
      locale: "en",
      languageSlug: "english",
    })
    expect(auditLog).toHaveBeenCalledTimes(1)
    const audit = String(auditLog.mock.calls[0]?.[0])
    expect(audit).toContain('"event":"video_search_social.updated"')
    expect(audit).not.toContain("Safe public title")
    expect(audit).not.toContain("Visible description")
  })

  it("does not revalidate a draft locale", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue({
      ...activeLocale,
      status: "DRAFT",
    })
    prisma.videoLocale.updateMany.mockResolvedValue({ count: 1 })

    await service.save({
      user: ADMIN,
      input: {
        videoLocaleId: "locale-1",
        searchTitle: null,
        searchDescription: null,
        socialImageAssetId: null,
      },
    })

    expect(emitRevalidateWebhook).not.toHaveBeenCalled()
  })

  it("maps only allowlisted public errors", () => {
    expect(mapVideoSearchSocialError(new ForbiddenError())).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "You do not have permission to edit search metadata.",
    })
    expect(mapVideoSearchSocialError(new Error("database password"))).toEqual({
      ok: false,
      code: "SAVE_FAILED",
      message: "Search metadata could not be saved. Please try again.",
    })
  })

  it("keeps a failed webhook best-effort and out of the saved result", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)
    prisma.videoLocale.updateMany.mockResolvedValue({ count: 1 })
    emitRevalidateWebhook.mockResolvedValueOnce({
      status: "failed",
      reason: "network",
      detail: "secret transport detail",
    })

    await expect(
      service.save({
        user: ADMIN,
        input: {
          videoLocaleId: "locale-1",
          searchTitle: "Safe public title",
          searchDescription: null,
          socialImageAssetId: null,
        },
      }),
    ).resolves.toMatchObject({ searchTitle: "Safe public title" })
  })

  it("does not hold the save response open for webhook delivery", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)
    prisma.videoLocale.updateMany.mockResolvedValue({ count: 1 })
    emitRevalidateWebhook.mockReturnValueOnce(new Promise(() => undefined))

    await expect(
      service.save({
        user: ADMIN,
        input: {
          videoLocaleId: "locale-1",
          searchTitle: "Safe public title",
          searchDescription: null,
          socialImageAssetId: null,
        },
      }),
    ).resolves.toMatchObject({ searchTitle: "Safe public title" })
  })

  it("publishes one exact current SEO draft and revalidates after commit", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)
    prisma.contentRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      snapshot: seoDraftSnapshot(),
    })
    prisma.contentRevision.create.mockResolvedValue({ id: "history-1" })
    prisma.videoLocale.update.mockResolvedValue({
      ...activeLocale,
      title: "JESUS — Watch",
      searchTitle: "Watch JESUS",
      searchDescription: "Watch the JESUS film.",
    })
    prisma.contentRevision.update.mockResolvedValue({ id: "revision-1" })

    await expect(
      service.publishDraft({
        user: ADMIN,
        input: { videoLocaleId: "locale-1", revisionId: "revision-1" },
      }),
    ).resolves.toMatchObject({
      sourceTitle: "JESUS — Watch",
      searchTitle: "Watch JESUS",
      seoDraft: null,
    })

    expect(prisma.contentRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "VideoLocale",
        entityId: "locale-1",
        status: "HISTORICAL",
        revisedBy: "admin-1",
        revisedByKind: "USER",
      }),
    })
    expect(prisma.videoLocale.update).toHaveBeenCalledWith({
      where: { id: "locale-1" },
      data: {
        title: "JESUS — Watch",
        description: "Visible description",
        snippet: null,
        imageAlt: null,
        searchTitle: "Watch JESUS",
        searchDescription: "Watch the JESUS film.",
        socialImageAssetId: null,
      },
      include: { video: { select: { slug: true } } },
    })
    expect(prisma.contentRevision.update).toHaveBeenCalledWith({
      where: { id: "revision-1" },
      data: { status: "HISTORICAL", appliedAt: expect.any(Date) },
    })
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      emitRevalidateWebhook.mock.invocationCallOrder[0],
    )
    expect(emitRevalidateWebhook).toHaveBeenCalledTimes(1)
  })

  it("refuses a stale SEO draft without canonical or revision writes", async () => {
    prisma.videoLocale.findFirst.mockResolvedValue(activeLocale)
    prisma.contentRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      snapshot: seoDraftSnapshot({ updatedAt: "2026-07-31T12:00:00.000Z" }),
    })

    await expect(
      service.publishDraft({
        user: ADMIN,
        input: { videoLocaleId: "locale-1", revisionId: "revision-1" },
      }),
    ).rejects.toBeInstanceOf(VideoSearchSocialStaleDraftError)

    expect(prisma.contentRevision.create).not.toHaveBeenCalled()
    expect(prisma.videoLocale.update).not.toHaveBeenCalled()
    expect(prisma.contentRevision.update).not.toHaveBeenCalled()
    expect(emitRevalidateWebhook).not.toHaveBeenCalled()
  })

  it("discards a selected draft without touching canonical content", async () => {
    prisma.contentRevision.updateMany.mockResolvedValue({ count: 1 })

    await expect(
      service.discardDraft({
        user: ADMIN,
        input: { videoLocaleId: "locale-1", revisionId: "revision-1" },
      }),
    ).resolves.toEqual({ revisionId: "revision-1", status: "DISCARDED" })

    expect(prisma.contentRevision.updateMany).toHaveBeenCalledWith({
      where: {
        id: "revision-1",
        entityType: "VideoLocale",
        entityId: "locale-1",
        status: "DRAFT",
      },
      data: { status: "DISCARDED" },
    })
    expect(prisma.videoLocale.update).not.toHaveBeenCalled()
    expect(emitRevalidateWebhook).not.toHaveBeenCalled()
  })
})

afterAll(() => auditLog.mockRestore())
