import type { Prisma, PrismaClient } from "@prisma/client"
import { canEditVideo } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import {
  buildMediaLibraryBrowserData,
  type MediaLibraryBrowserData,
} from "@/app/dashboard/media/media-library-browser-data"
import { ForbiddenError } from "@/services/errors"
import { createServices } from "@/services"
import { VideoSearchSocialLocaleNotFoundError } from "@/services/video-search-social.service"

const LOCALE_SEARCH_LIMIT = 40

export type VideoSearchSocialLocaleOption = {
  id: string
  languageName: string
  languageCode: string | null
  languageSlug: string | null
  locale: string | null
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
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
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
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
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
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
  const normalizedQuery = query.replace(/\s+/g, " ").trim().slice(0, 120)
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
      where: {
        kind: "IMAGE",
        status: "READY",
        visibility: "PUBLIC",
        OR: [{ objectKey: { not: null } }, { previewObjectKey: { not: null } }],
      },
      select: {
        id: true,
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
      },
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
  const metadata = await createServices(
    client as PrismaClient,
  ).videoSearchSocial.get({
    user,
    input: { videoLocaleId },
  })
  const row = await client.videoLocale.findFirst({
    where: { id: metadata.videoLocaleId, deletedAt: null },
    select: localeSelect,
  })
  if (!row) {
    throw new VideoSearchSocialLocaleNotFoundError()
  }

  const option = localeOption(row)
  const selectedAsset =
    !mediaLibrary && metadata.socialImageAssetId
      ? await client.mediaAsset.findMany({
          where: {
            id: metadata.socialImageAssetId,
            kind: "IMAGE",
            status: "READY",
            visibility: "PUBLIC",
            OR: [
              { objectKey: { not: null } },
              { previewObjectKey: { not: null } },
            ],
          },
          select: {
            id: true,
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
          },
          take: 1,
        })
      : []
  const selectedImage =
    mediaLibrary?.images.find(
      (asset) => asset.id === metadata.socialImageAssetId,
    ) ??
    buildMediaLibraryBrowserData({ folders: [], images: selectedAsset })
      .images[0] ??
    null

  return {
    ...metadata,
    sourceDescription: metadata.sourceDescription ?? row.snippet,
    languageName: option.languageName,
    languageCode: option.languageCode,
    socialImage: selectedImage,
  }
}
