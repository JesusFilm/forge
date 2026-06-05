import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"

type LocalizedName = Record<string, unknown>

export type ManagerLanguageGeo = {
  continents: Array<{ id: string; name: string }>
  countries: Array<{ id: string; name: string; continentId: string }>
  languages: Array<{
    id: string
    englishLabel: string
    nativeLabel: string
    countryIds: string[]
    continentIds: string[]
    countrySpeakers: Record<string, number>
  }>
}

export type ManagerCoverageCounts = { human: number; ai: number }

export type ManagerVideoCoverage = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  imageUrl: string | null
  parentDocumentIds: string[]
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
          englishLabel,
          nativeLabel: englishLabel,
          countryIds: Array.from(facts?.countryIds ?? []),
          continentIds: Array.from(facts?.continentIds ?? []),
          countrySpeakers: facts?.countrySpeakers ?? {},
        }
      }),
    }
  }

  async getVideoCoverage({
    user,
    languageIds = [],
  }: {
    user: Principal | null
    languageIds?: string[]
  }): Promise<ManagerVideoCoverage[]> {
    assertManagerReadAccess(user)

    const videos = await this.prisma.video.findMany({
      where: { deletedAt: null },
      include: {
        locales: { orderBy: { updatedAt: "desc" }, take: 1 },
        images: {
          where: { deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        parents: true,
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
      title: video.locales[0]?.title ?? null,
      label: video.label ?? null,
      slug: video.slug ?? null,
      aiMetadata: video.aiMetadata ?? null,
      imageUrl: video.images[0]?.url ?? null,
      parentDocumentIds: video.parents.map((parent) => parent.parentId),
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
