import type { PrismaClient } from "@prisma/client"

import { HARNESS_LOCALES, LOCALE_TIER, type HarnessLocale } from "./locales"

const DEFAULT_CONTEXT_LIMIT = 30
const MAX_CONTEXT_LIMIT = 100
const MAX_KEYWORDS = 5
const BCP47_REGEX = /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export type SearchEvalCatalogContextFilters = {
  locales?: string[]
  limit?: number
}

export type SearchEvalLocaleProfile = {
  locale: HarnessLocale
  tier: 1 | 2 | 3
  source: "harness"
}

export type SearchEvalCatalogAnchor =
  | {
      source: "video"
      id: string
      locale: string
      title: string
      slug: string
      label: string | null
      snippet: string | null
      description: string | null
      keywords: string[]
      expectedResultHints: Array<{
        type: "video"
        id: string
        slug: string
        title: string
      }>
    }
  | {
      source: "experience"
      id: string
      locale: string
      title: string
      slug: string
      snippet: string | null
      description: string | null
      expectedResultHints: Array<{
        type: "experience"
        id: string
        slug: string
        title: string
      }>
    }

export type SearchEvalCatalogContext = {
  localeProfiles: SearchEvalLocaleProfile[]
  anchors: SearchEvalCatalogAnchor[]
}

export class SearchEvalCatalogContextError extends Error {
  constructor(
    readonly code: "validation",
    message: string,
  ) {
    super(message)
    this.name = "SearchEvalCatalogContextError"
  }
}

function validation(message: string): never {
  throw new SearchEvalCatalogContextError("validation", message)
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_CONTEXT_LIMIT
  return Math.min(MAX_CONTEXT_LIMIT, Math.max(1, Math.floor(limit)))
}

function sanitizeLocale(locale: string): string {
  const normalized = locale.trim()
  if (!BCP47_REGEX.test(normalized)) {
    validation("locale must be a safe BCP-47 tag")
  }
  return normalized
}

function normalizeLocales(locales: string[] | undefined): string[] | undefined {
  if (locales == null) return undefined
  if (locales.length === 0) validation("locales must not be empty")
  if (locales.length > HARNESS_LOCALES.length) {
    validation(`locales must contain at most ${HARNESS_LOCALES.length} items`)
  }
  return Array.from(new Set(locales.map(sanitizeLocale)))
}

function clampText(value: string | null | undefined, max = 240): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim()
  return normalized.length === 0 ? null : normalized.slice(0, max)
}

function titleOrNull(value: string | null | undefined): string | null {
  const title = clampText(value, 180)
  return title && title.length > 0 ? title : null
}

function isHarness(value: string): value is HarnessLocale {
  return (HARNESS_LOCALES as readonly string[]).includes(value)
}

function localeProfilesFor(
  locales: string[] | undefined,
): SearchEvalLocaleProfile[] {
  const selected = locales
    ? HARNESS_LOCALES.filter((locale) => locales.includes(locale))
    : HARNESS_LOCALES
  return selected.map((locale) => ({
    locale,
    tier: LOCALE_TIER[locale],
    source: "harness",
  }))
}

export async function readSearchEvalCatalogContext(
  prisma: PrismaClient,
  filters: SearchEvalCatalogContextFilters = {},
): Promise<SearchEvalCatalogContext> {
  const locales = normalizeLocales(filters.locales)
  const limit = clampLimit(filters.limit)

  const [videoLocales, experienceLocales] = await Promise.all([
    prisma.videoLocale.findMany({
      where: {
        status: "PUBLISHED",
        title: { not: null },
        ...(locales ? { locale: { in: locales } } : {}),
        video: {
          deletedAt: null,
          noIndex: false,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        locale: true,
        title: true,
        description: true,
        snippet: true,
        video: {
          select: {
            id: true,
            slug: true,
            label: true,
            keywords: {
              take: MAX_KEYWORDS,
              select: {
                keyword: {
                  select: {
                    value: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.experienceLocale.findMany({
      where: {
        status: "PUBLISHED",
        title: { not: null },
        ...(locales ? { locale: { in: locales } } : {}),
        experience: {
          archivedAt: null,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        locale: true,
        slug: true,
        title: true,
        metaDescription: true,
        ogDescription: true,
        experience: {
          select: {
            id: true,
          },
        },
      },
    }),
  ])

  const videoAnchors: SearchEvalCatalogAnchor[] = videoLocales.flatMap(
    (row) => {
      const title = titleOrNull(row.title)
      if (!title) return []
      return [
        {
          source: "video" as const,
          id: row.id,
          locale: row.locale,
          title,
          slug: row.video.slug,
          label: row.video.label,
          snippet: clampText(row.snippet),
          description: clampText(row.description),
          keywords: row.video.keywords
            .map((entry) => clampText(entry.keyword.value, 80))
            .filter((value): value is string => value != null),
          expectedResultHints: [
            {
              type: "video" as const,
              id: row.video.id,
              slug: row.video.slug,
              title,
            },
          ],
        },
      ]
    },
  )

  const experienceAnchors: SearchEvalCatalogAnchor[] =
    experienceLocales.flatMap((row) => {
      const title = titleOrNull(row.title)
      if (!title) return []
      return [
        {
          source: "experience" as const,
          id: row.id,
          locale: row.locale,
          title,
          slug: row.slug,
          snippet: clampText(row.metaDescription),
          description: clampText(row.ogDescription),
          expectedResultHints: [
            {
              type: "experience" as const,
              id: row.experience.id,
              slug: row.slug,
              title,
            },
          ],
        },
      ]
    })

  return {
    localeProfiles: localeProfilesFor(locales?.filter(isHarness)),
    anchors: [...videoAnchors, ...experienceAnchors].slice(0, limit),
  }
}

export const _internal = {
  clampLimit,
  normalizeLocales,
  sanitizeLocale,
}
