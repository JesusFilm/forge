import type { LocaleStatus, Prisma, PrismaClient } from "@prisma/client"
import { canEditVideo } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import {
  buildMediaLibraryBrowserData,
  type MediaLibraryBrowserData,
} from "@/app/dashboard/media/media-library-browser-data"
import { parseVideoLibraryQuery } from "@/app/dashboard/video-library-utils"
import { ForbiddenError } from "@/services/errors"
import {
  parseVideoSearchSocialLocaleId,
  VideoSearchSocialLocaleNotFoundError,
} from "@/services/video-search-social.service"

const LOCALE_SEARCH_LIMIT = 40

export type VideoSearchSocialLocaleOption = {
  id: string
  languageName: string
  languageCode: string | null
  languageSlug: string | null
  locale: string | null
  status: LocaleStatus
  title: string | null
}

export type VideoSearchSocialLocaleData = {
  videoLocaleId: string
  videoId: string
  slug: string
  locale: string | null
  languageName: string
  languageCode: string | null
  languageSlug: string | null
  status: LocaleStatus
  sourceTitle: string | null
  sourceDescription: string | null
  searchTitle: string | null
  searchDescription: string | null
  socialImageAssetId: string | null
  socialImage: MediaLibraryBrowserData["images"][number] | null
}

type VideoSearchSocialPrisma = Pick<
  PrismaClient,
  "mediaAsset" | "mediaFolder" | "videoLocale"
>

function assertCanReadVideoSearchSocial(user: Principal | null) {
  if (!canEditVideo(user)) throw new ForbiddenError()
}

function compactText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function languageName(value: unknown): string | null {
  const direct = compactText(value)
  if (direct) return direct
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  return (
    compactText(record.en) ??
    Object.values(record).map(compactText).find(Boolean) ??
    null
  )
}

function localeOption(row: {
  id: string
  locale: string | null
  languageSlug: string | null
  status: LocaleStatus
  title: string | null
  language: {
    bcp47: string | null
    iso3: string | null
    name: Prisma.JsonValue
    slug: string | null
  } | null
}): VideoSearchSocialLocaleOption {
  return {
    id: row.id,
    languageName:
      languageName(row.language?.name) ??
      row.languageSlug ??
      row.locale ??
      "Unknown language",
    languageCode:
      row.language?.bcp47 ?? row.language?.iso3 ?? row.locale ?? null,
    languageSlug: row.languageSlug ?? row.language?.slug ?? null,
    locale: row.locale,
    status: row.status,
    title: compactText(row.title),
  }
}

const localeSelect = {
  id: true,
  locale: true,
  languageSlug: true,
  status: true,
  title: true,
  snippet: true,
  language: {
    select: { bcp47: true, iso3: true, name: true, slug: true },
  },
} satisfies Prisma.VideoLocaleSelect

const publicReadyImageWhere = {
  kind: "IMAGE",
  status: "READY",
  visibility: "PUBLIC",
  OR: [{ objectKey: { not: null } }, { previewObjectKey: { not: null } }],
} satisfies Prisma.MediaAssetWhereInput

const mediaLibraryImageSelect = {
  id: true,
  kind: true,
  status: true,
  visibility: true,
  backend: true,
  originalFilename: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  objectKey: true,
  previewObjectKey: true,
  muxPlaybackId: true,
  folderId: true,
  updatedAt: true,
  locales: {
    where: { locale: "en" },
    select: { displayName: true, altText: true },
    take: 1,
  },
} satisfies Prisma.MediaAssetSelect

const localeDetailSelect = {
  id: true,
  videoId: true,
  locale: true,
  languageSlug: true,
  status: true,
  title: true,
  description: true,
  snippet: true,
  searchTitle: true,
  searchDescription: true,
  socialImageAssetId: true,
  video: { select: { slug: true } },
  language: {
    select: { bcp47: true, iso3: true, name: true, slug: true },
  },
  socialImageAsset: { select: mediaLibraryImageSelect },
} satisfies Prisma.VideoLocaleSelect

export async function searchVideoSearchSocialLocales({
  user,
  videoId,
  query = "",
  client = prisma,
}: {
  user: Principal | null
  videoId: string
  query?: string
  client?: VideoSearchSocialPrisma
}): Promise<VideoSearchSocialLocaleOption[]> {
  assertCanReadVideoSearchSocial(user)
  const normalizedVideoId = videoId.trim()
  const normalizedQuery = parseVideoLibraryQuery(query)
  if (!normalizedVideoId) return []

  const rows = await client.videoLocale.findMany({
    where: {
      videoId: normalizedVideoId,
      deletedAt: null,
      status: { not: "ARCHIVED" },
      ...(normalizedQuery
        ? {
            OR: [
              { title: { contains: normalizedQuery, mode: "insensitive" } },
              { locale: { contains: normalizedQuery, mode: "insensitive" } },
              {
                languageSlug: {
                  contains: normalizedQuery,
                  mode: "insensitive",
                },
              },
              {
                language: {
                  is: {
                    OR: [
                      {
                        slug: {
                          contains: normalizedQuery,
                          mode: "insensitive",
                        },
                      },
                      {
                        bcp47: {
                          contains: normalizedQuery,
                          mode: "insensitive",
                        },
                      },
                      {
                        iso3: {
                          contains: normalizedQuery,
                          mode: "insensitive",
                        },
                      },
                      {
                        locales: {
                          some: {
                            deletedAt: null,
                            value: {
                              contains: normalizedQuery,
                              mode: "insensitive",
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    select: localeSelect,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: LOCALE_SEARCH_LIMIT,
  })

  return rows.map(localeOption)
}

export async function loadVideoSearchSocialMediaLibrary({
  user,
  client = prisma,
}: {
  user: Principal | null
  client?: VideoSearchSocialPrisma
}): Promise<MediaLibraryBrowserData> {
  assertCanReadVideoSearchSocial(user)
  const [folders, images] = await Promise.all([
    client.mediaFolder.findMany({
      select: { id: true, name: true, parentId: true },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    }),
    client.mediaAsset.findMany({
      where: publicReadyImageWhere,
      select: mediaLibraryImageSelect,
      orderBy: { updatedAt: "desc" },
    }),
  ])

  return buildMediaLibraryBrowserData({ folders, images })
}

export async function loadVideoSearchSocialLocale({
  user,
  videoLocaleId,
  mediaLibrary,
  client = prisma,
}: {
  user: Principal | null
  videoLocaleId: string
  mediaLibrary?: MediaLibraryBrowserData
  client?: VideoSearchSocialPrisma
}): Promise<VideoSearchSocialLocaleData> {
  assertCanReadVideoSearchSocial(user)
  const normalizedVideoLocaleId = parseVideoSearchSocialLocaleId({
    videoLocaleId,
  })
  const row = await client.videoLocale.findFirst({
    where: {
      id: normalizedVideoLocaleId,
      deletedAt: null,
      status: { not: "ARCHIVED" },
      video: { deletedAt: null },
    },
    select: localeDetailSelect,
  })
  if (!row) {
    throw new VideoSearchSocialLocaleNotFoundError()
  }

  const option = localeOption(row)
  const selectedAsset =
    row.socialImageAsset &&
    row.socialImageAsset.kind === "IMAGE" &&
    row.socialImageAsset.status === "READY" &&
    row.socialImageAsset.visibility === "PUBLIC" &&
    (row.socialImageAsset.objectKey || row.socialImageAsset.previewObjectKey)
      ? [row.socialImageAsset]
      : []
  const selectedImage =
    mediaLibrary?.images.find((asset) => asset.id === row.socialImageAssetId) ??
    buildMediaLibraryBrowserData({ folders: [], images: selectedAsset })
      .images[0] ??
    null

  return {
    videoLocaleId: row.id,
    videoId: row.videoId,
    slug: row.video.slug,
    locale: row.locale,
    languageSlug: row.languageSlug,
    status: row.status,
    sourceTitle: row.title,
    sourceDescription: row.description ?? row.snippet,
    searchTitle: row.searchTitle,
    searchDescription: row.searchDescription,
    socialImageAssetId: row.socialImageAssetId,
    languageName: option.languageName,
    languageCode: option.languageCode,
    socialImage: selectedImage,
  }
}

export async function loadInitialVideoSearchSocialState({
  user,
  videoId,
  requestedVideoLocaleId,
  client = prisma,
}: {
  user: Principal | null
  videoId: string
  requestedVideoLocaleId?: string
  client?: VideoSearchSocialPrisma
}): Promise<{
  initialOptions: VideoSearchSocialLocaleOption[]
  initialLocale: VideoSearchSocialLocaleData | null
}> {
  let initialOptions = await searchVideoSearchSocialLocales({
    user,
    videoId,
    client,
  })
  let initialLocale: VideoSearchSocialLocaleData | null = null

  if (requestedVideoLocaleId) {
    try {
      const requestedLocale = await loadVideoSearchSocialLocale({
        user,
        videoLocaleId: requestedVideoLocaleId,
        client,
      })
      if (requestedLocale.videoId === videoId) initialLocale = requestedLocale
    } catch (error) {
      if (!(error instanceof VideoSearchSocialLocaleNotFoundError)) throw error
    }
  }

  if (!initialLocale && initialOptions[0]) {
    initialLocale = await loadVideoSearchSocialLocale({
      user,
      videoLocaleId: initialOptions[0].id,
      client,
    })
  }

  if (
    initialLocale &&
    !initialOptions.some((option) => option.id === initialLocale?.videoLocaleId)
  ) {
    initialOptions = [
      {
        id: initialLocale.videoLocaleId,
        languageName: initialLocale.languageName,
        languageCode: initialLocale.languageCode,
        languageSlug: initialLocale.languageSlug,
        locale: initialLocale.locale,
        status: initialLocale.status,
        title: initialLocale.sourceTitle,
      },
      ...initialOptions,
    ]
  }

  return { initialOptions, initialLocale }
}
