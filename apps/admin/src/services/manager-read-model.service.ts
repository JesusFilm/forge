import type { Prisma, PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"

type LocalizedName = Record<string, unknown>

export type ManagerLanguageGeo = {
  continents: Array<{ id: string; name: string }>
  countries: Array<{ id: string; name: string; continentId: string }>
  languages: Array<{
    id: string
    coreId: string | null
    bcp47: string | null
    iso3: string | null
    englishLabel: string
    nativeLabel: string
    countryIds: string[]
    continentIds: string[]
    countrySpeakers: Record<string, number>
  }>
}

export type ManagerVideoForEnrichment = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  primaryLanguage: {
    coreId: string | null
    bcp47: string | null
    iso3: string | null
  } | null
  variants: Array<{
    language: {
      coreId: string | null
      bcp47: string | null
      iso3: string | null
    } | null
    muxVideo: {
      assetId: string | null
      playbackId: string | null
    } | null
    downloads: Array<{ url: string | null }>
  }>
}

export type ManagerCoverageCounts = { human: number; ai: number }

export type ManagerVideoParentRelation = {
  parentDocumentId: string
  order: number | null
}

export type ManagerVideoCoverage = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  imageUrl: string | null
  parentDocumentIds: string[]
  parentRelations: ManagerVideoParentRelation[]
  coverage: {
    subtitles: ManagerCoverageCounts
    audio: ManagerCoverageCounts
  }
}

export type ManagerCoverageSnapshot = {
  documentId: string
  date: string
  computedAt: string
  totalVideos: number
  videosWithAiMetadata: number
  videosWithHumanMetadata: number
  subtitlesHumanTotal: number
  subtitlesAiTotal: number
  audioHumanTotal: number
  audioAiTotal: number
  languageCoverage: unknown
}

type CoverageAggregateRow = {
  videoId: string | null
  aiGenerated: boolean
  _count: { _all: number }
}

type VideoTitleLocale = {
  videoId?: string | null
  locale: string | null
  languageId: string | null
  title: string | null
}

const MANAGER_ENRICHMENT_VIDEO_MAX_IDS = 100
const CLOUDFLARE_IMAGE_DELIVERY_HOST = "imagedelivery.net"

function assertManagerReadAccess(user: Principal | null) {
  if (!hasPermission(user, "read:manager-read-models")) {
    throw new ForbiddenError()
  }
}

function nameFrom(
  value: unknown,
  locales?: Array<{ locale: string; value: string }>,
) {
  const fromEnglishLocale = locales?.find((locale) => locale.locale === "en")
  if (fromEnglishLocale) return fromEnglishLocale.value
  const fromFirstLocale = locales?.[0]
  if (fromFirstLocale) return fromFirstLocale.value
  const map = value as LocalizedName
  const english = map?.en
  if (typeof english === "string" && english.length > 0) return english
  const first = Object.values(map ?? {}).find(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  )
  return first ?? ""
}

function buildCoverageCountMap(
  rows: CoverageAggregateRow[],
): Map<string, ManagerCoverageCounts> {
  const countsByVideoId = new Map<string, ManagerCoverageCounts>()

  for (const row of rows) {
    if (row.videoId == null) continue

    const counts = countsByVideoId.get(row.videoId) ?? { human: 0, ai: 0 }
    if (row.aiGenerated) {
      counts.ai += row._count._all
    } else {
      counts.human += row._count._all
    }
    countsByVideoId.set(row.videoId, counts)
  }

  return countsByVideoId
}

function countsForVideo(
  countsByVideoId: Map<string, ManagerCoverageCounts>,
  videoId: string,
): ManagerCoverageCounts {
  return countsByVideoId.get(videoId) ?? { human: 0, ai: 0 }
}

function normalizeManagerVideoImageUrl(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.hostname !== CLOUDFLARE_IMAGE_DELIVERY_HOST) return trimmed

    const pathParts = url.pathname.split("/").filter(Boolean)
    if (pathParts.length === 2) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/public`
    }
    return url.toString()
  } catch {
    return trimmed
  }
}

function titleFrom(
  locales: VideoTitleLocale[],
  selectedLanguageIds: string[],
): string | null {
  const titledLocales = locales.filter(
    (
      locale,
    ): locale is VideoTitleLocale & {
      title: string
    } => typeof locale.title === "string" && locale.title.trim().length > 0,
  )

  const englishLocale = titledLocales.find((locale) => locale.locale === "en")
  if (englishLocale) return englishLocale.title

  for (const selectedLanguageId of selectedLanguageIds) {
    const selectedLocale = titledLocales.find(
      (locale) => locale.languageId === selectedLanguageId,
    )
    if (selectedLocale) return selectedLocale.title
  }

  return null
}

export class ManagerReadModelService {
  constructor(private prisma: PrismaClient) {}

  async getLanguageGeo({
    user,
  }: {
    user: Principal | null
  }): Promise<ManagerLanguageGeo> {
    assertManagerReadAccess(user)

    const [continents, countries, languages] = await Promise.all([
      this.prisma.continent.findMany({
        where: { deletedAt: null },
        include: { locales: { where: { deletedAt: null } } },
        orderBy: { slug: "asc" },
      }),
      this.prisma.country.findMany({
        where: { deletedAt: null },
        include: {
          locales: { where: { deletedAt: null } },
          countryLanguages: {
            where: { deletedAt: null },
            include: {
              language: {
                include: { locales: { where: { deletedAt: null } } },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.language.findMany({
        where: { deletedAt: null },
        include: { locales: { where: { deletedAt: null } } },
      }),
    ])

    const languageFacts = new Map<
      string,
      {
        countryIds: Set<string>
        continentIds: Set<string>
        countrySpeakers: Record<string, number>
      }
    >()

    for (const country of countries) {
      for (const countryLanguage of country.countryLanguages) {
        const facts = languageFacts.get(countryLanguage.languageId) ?? {
          countryIds: new Set<string>(),
          continentIds: new Set<string>(),
          countrySpeakers: {},
        }
        facts.countryIds.add(country.id)
        if (country.continentId) facts.continentIds.add(country.continentId)
        facts.countrySpeakers[country.id] = countryLanguage.speakers ?? 0
        languageFacts.set(countryLanguage.languageId, facts)
      }
    }

    return {
      continents: continents.map((continent) => ({
        id: continent.id,
        name: nameFrom(continent.name, continent.locales),
      })),
      countries: countries.map((country) => ({
        id: country.id,
        name: nameFrom(country.name, country.locales),
        continentId: country.continentId ?? "",
      })),
      languages: languages.map((language) => {
        const facts = languageFacts.get(language.id)
        const englishLabel = nameFrom(language.name, language.locales)
        return {
          id: language.id,
          coreId: language.coreId ?? null,
          bcp47: language.bcp47 ?? null,
          iso3: language.iso3 ?? null,
          englishLabel,
          nativeLabel: englishLabel,
          countryIds: Array.from(facts?.countryIds ?? []),
          continentIds: Array.from(facts?.continentIds ?? []),
          countrySpeakers: facts?.countrySpeakers ?? {},
        }
      }),
    }
  }

  async getVideosForEnrichment({
    user,
    ids = [],
  }: {
    user: Principal | null
    ids?: string[]
  }): Promise<ManagerVideoForEnrichment[]> {
    assertManagerReadAccess(user)

    const selectedIds = Array.from(
      new Set(ids.map((id) => id.trim()).filter(Boolean)),
    )

    if (selectedIds.length > MANAGER_ENRICHMENT_VIDEO_MAX_IDS) {
      throw new Error(
        `ids.length=${selectedIds.length} exceeds max ${MANAGER_ENRICHMENT_VIDEO_MAX_IDS}`,
      )
    }

    if (selectedIds.length === 0) {
      return []
    }

    const videos = await this.prisma.video.findMany({
      where: {
        deletedAt: null,
        OR: [{ id: { in: selectedIds } }, { coreId: { in: selectedIds } }],
      },
      include: {
        primaryLanguage: {
          select: {
            coreId: true,
            bcp47: true,
            iso3: true,
          },
        },
        dubs: {
          where: { deletedAt: null },
          include: {
            language: {
              select: {
                coreId: true,
                bcp47: true,
                iso3: true,
              },
            },
            muxVideo: {
              select: {
                assetId: true,
                playbackId: true,
              },
            },
            downloads: {
              where: { deletedAt: null },
              select: { url: true },
              orderBy: { updatedAt: "desc" },
            },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    })

    const videoIds = videos.map((video) => video.id)
    const primaryLanguageIds = Array.from(
      new Set(
        videos
          .map((video) => video.primaryLanguageId)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    )
    const titleLocaleFilters: Prisma.VideoLocaleWhereInput[] = [
      { locale: "en" },
    ]
    if (primaryLanguageIds.length > 0) {
      titleLocaleFilters.push({ languageId: { in: primaryLanguageIds } })
    }
    const titleLocales =
      videoIds.length === 0
        ? []
        : await this.prisma.videoLocale.findMany({
            where: {
              deletedAt: null,
              title: { not: null },
              videoId: { in: videoIds },
              OR: titleLocaleFilters,
            },
            select: {
              videoId: true,
              locale: true,
              languageId: true,
              title: true,
            },
            orderBy: [{ locale: "asc" }, { updatedAt: "desc" }],
          })
    const titleLocalesByVideoId = new Map<string, VideoTitleLocale[]>()
    for (const locale of titleLocales) {
      const locales = titleLocalesByVideoId.get(locale.videoId) ?? []
      locales.push(locale)
      titleLocalesByVideoId.set(locale.videoId, locales)
    }

    return videos.map((video) => ({
      documentId: video.id,
      coreId: video.coreId ?? null,
      title: titleFrom(
        titleLocalesByVideoId.get(video.id) ?? [],
        video.primaryLanguageId ? [video.primaryLanguageId] : [],
      ),
      label: video.label ?? null,
      primaryLanguage: video.primaryLanguage
        ? {
            coreId: video.primaryLanguage.coreId ?? null,
            bcp47: video.primaryLanguage.bcp47 ?? null,
            iso3: video.primaryLanguage.iso3 ?? null,
          }
        : null,
      variants: video.dubs.map((dub) => ({
        language: dub.language
          ? {
              coreId: dub.language.coreId ?? null,
              bcp47: dub.language.bcp47 ?? null,
              iso3: dub.language.iso3 ?? null,
            }
          : null,
        muxVideo: dub.muxVideo
          ? {
              assetId: dub.muxVideo.assetId ?? null,
              playbackId: dub.muxVideo.playbackId ?? null,
            }
          : null,
        downloads: dub.downloads.map((download) => ({
          url: download.url ?? null,
        })),
      })),
    }))
  }

  async getVideoCoverage({
    user,
    languageIds = [],
  }: {
    user: Principal | null
    languageIds?: string[]
  }): Promise<ManagerVideoCoverage[]> {
    assertManagerReadAccess(user)

    const titleLocaleFilters: Prisma.VideoLocaleWhereInput[] = [
      { locale: "en" },
    ]
    if (languageIds.length > 0) {
      titleLocaleFilters.push({ languageId: { in: languageIds } })
    }

    const videos = await this.prisma.video.findMany({
      where: { deletedAt: null },
      include: {
        locales: {
          where: {
            deletedAt: null,
            title: { not: null },
            OR: titleLocaleFilters,
          },
          select: {
            locale: true,
            languageId: true,
            title: true,
          },
          orderBy: [{ locale: "asc" }, { updatedAt: "desc" }],
        },
        images: {
          where: { deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        parents: {
          select: {
            parentId: true,
            order: true,
          },
          orderBy: [
            { order: { sort: "asc", nulls: "last" } },
            { createdAt: "asc" },
            { id: "asc" },
          ],
        },
      },
      orderBy: { updatedAt: "desc" },
    })

    const videoIds = videos.map((video) => video.id)
    const languageFilter =
      languageIds.length > 0 ? { languageId: { in: languageIds } } : {}

    const [subtitleCounts, dubCounts] =
      videoIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.videoSubtitle.groupBy({
              by: ["videoId", "aiGenerated"],
              where: {
                deletedAt: null,
                videoId: { in: videoIds },
                ...languageFilter,
              },
              _count: { _all: true },
            }),
            this.prisma.videoDub.groupBy({
              by: ["videoId", "aiGenerated"],
              where: {
                deletedAt: null,
                videoId: { in: videoIds },
                ...languageFilter,
              },
              _count: { _all: true },
            }),
          ])

    const subtitleCountsByVideoId = buildCoverageCountMap(subtitleCounts)
    const dubCountsByVideoId = buildCoverageCountMap(dubCounts)

    return videos.map((video) => ({
      documentId: video.id,
      coreId: video.coreId ?? null,
      title: titleFrom(video.locales, languageIds),
      label: video.label ?? null,
      slug: video.slug ?? null,
      aiMetadata: video.aiMetadata ?? null,
      imageUrl: normalizeManagerVideoImageUrl(video.images[0]?.url),
      parentDocumentIds: video.parents.map((parent) => parent.parentId),
      parentRelations: video.parents.map((parent) => ({
        parentDocumentId: parent.parentId,
        order: parent.order ?? null,
      })),
      coverage: {
        subtitles: countsForVideo(subtitleCountsByVideoId, video.id),
        audio: countsForVideo(dubCountsByVideoId, video.id),
      },
    }))
  }

  async getCoverageSnapshots({
    user,
    latest,
    startDate,
    endDate,
  }: {
    user: Principal | null
    latest?: boolean
    startDate?: string | null
    endDate?: string | null
  }): Promise<ManagerCoverageSnapshot[]> {
    assertManagerReadAccess(user)

    const rows = await this.prisma.managerCoverageSnapshot.findMany({
      where: {
        ...(startDate || endDate
          ? {
              date: {
                ...(startDate
                  ? { gte: new Date(`${startDate}T00:00:00.000Z`) }
                  : {}),
                ...(endDate
                  ? { lte: new Date(`${endDate}T23:59:59.999Z`) }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: { date: "desc" },
      take: latest ? 1 : 100,
    })

    return rows.map((row) => ({
      documentId: row.id,
      date: row.date.toISOString().slice(0, 10),
      computedAt: row.computedAt.toISOString(),
      totalVideos: row.totalVideos,
      videosWithAiMetadata: row.videosWithAiMetadata,
      videosWithHumanMetadata: row.videosWithHumanMetadata,
      subtitlesHumanTotal: row.subtitlesHumanTotal,
      subtitlesAiTotal: row.subtitlesAiTotal,
      audioHumanTotal: row.audioHumanTotal,
      audioAiTotal: row.audioAiTotal,
      languageCoverage: row.languageCoverage,
    }))
  }
}
