import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "./errors"
import {
  mapVideoSearchSocialError,
  VideoSearchSocialInvalidAssetError,
  VideoSearchSocialService,
} from "./video-search-social.service"

const { emitRevalidateWebhook } = vi.hoisted(() => ({
  emitRevalidateWebhook: vi.fn(),
}))

vi.mock("./revalidate-webhook", () => ({ emitRevalidateWebhook }))

function mockPrisma() {
  const tx = {
    videoLocale: {
      findFirst: vi.fn(),
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
  status: "PUBLISHED",
  title: "JESUS",
  description: "Visible description",
  searchTitle: null,
  searchDescription: null,
  socialImageAssetId: null,
  video: { slug: "jesus" },
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
})

afterAll(() => auditLog.mockRestore())
