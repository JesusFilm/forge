import { describe, expect, it, vi } from "vitest"
import { ForbiddenError } from "@/services/errors"
import {
  loadVideoSearchSocialMediaLibrary,
  loadInitialVideoSearchSocialState,
  searchVideoSearchSocialLocales,
} from "./video-search-social-data"

const admin = { id: "admin-1", role: "ADMIN" } as const
const editor = { id: "editor-1", role: "EDITOR" } as const

function client() {
  return {
    videoLocale: { findMany: vi.fn(), findFirst: vi.fn() },
    mediaFolder: { findMany: vi.fn() },
    mediaAsset: { findMany: vi.fn() },
  }
}

describe("video Search and Social dashboard data", () => {
  it("authorizes before an exact-locale lookup", async () => {
    const db = client()

    await expect(
      searchVideoSearchSocialLocales({
        user: editor,
        videoId: "video-1",
        query: "English",
        client: db as never,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(db.videoLocale.findMany).not.toHaveBeenCalled()
  })

  it("searches the full video locale relation with a bounded exact result", async () => {
    const db = client()
    db.videoLocale.findMany.mockResolvedValue([
      {
        id: "locale-beyond-sample",
        locale: "es-419",
        languageSlug: "latin-american-spanish",
        status: "PUBLISHED",
        title: "JESÚS",
        language: {
          bcp47: "es-419",
          iso3: "spa",
          name: { en: "Latin American Spanish" },
          slug: "latin-american-spanish",
        },
      },
    ])

    const result = await searchVideoSearchSocialLocales({
      user: admin,
      videoId: "video-1",
      query: "latin american",
      client: db as never,
    })

    expect(result).toEqual([
      expect.objectContaining({
        id: "locale-beyond-sample",
        languageName: "Latin American Spanish",
        languageCode: "es-419",
        status: "PUBLISHED",
      }),
    ])
    expect(db.videoLocale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ videoId: "video-1" }),
        take: 40,
      }),
    )
    expect(
      db.videoLocale.findMany.mock.calls[0]?.[0].where.OR[3].language.is.OR,
    ).toEqual(
      expect.arrayContaining([
        {
          locales: {
            some: {
              deletedAt: null,
              value: {
                contains: "latin american",
                mode: "insensitive",
              },
            },
          },
        },
      ]),
    )
  })

  it("honors a valid locale deep link even when it is outside the first result page", async () => {
    const db = client()
    db.videoLocale.findMany.mockResolvedValue([])
    db.videoLocale.findFirst = vi.fn().mockResolvedValue({
      id: "locale-deep",
      videoId: "video-1",
      locale: "fr",
      languageSlug: "french",
      status: "PUBLISHED",
      title: "JÃ‰SUS",
      description: "Description",
      snippet: null,
      searchTitle: null,
      searchDescription: null,
      socialImageAssetId: null,
      socialImageAsset: null,
      video: { slug: "jesus" },
      language: {
        bcp47: "fr",
        iso3: "fra",
        name: { en: "French" },
        slug: "french",
      },
    })

    const state = await loadInitialVideoSearchSocialState({
      user: admin,
      videoId: "video-1",
      requestedVideoLocaleId: "locale-deep",
      client: db as never,
    })

    expect(state.initialLocale?.videoLocaleId).toBe("locale-deep")
    expect(state.initialOptions[0]?.id).toBe("locale-deep")
  })

  it("offers only public ready images with a crawler-resolvable object", async () => {
    const db = client()
    db.mediaFolder.findMany.mockResolvedValue([])
    db.mediaAsset.findMany.mockResolvedValue([])

    await loadVideoSearchSocialMediaLibrary({
      user: admin,
      client: db as never,
    })

    expect(db.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: "IMAGE",
          status: "READY",
          visibility: "PUBLIC",
          OR: [
            { objectKey: { not: null } },
            { previewObjectKey: { not: null } },
          ],
        },
      }),
    )
  })
})
