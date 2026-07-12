import type { AdminVideoLabel, SearchResult } from "./search"
import {
  findSearchLanguageOptionByEnglishName,
  type SearchLanguageOption,
} from "./search-language"

export type AlgoliaVideoTitle = {
  languageId?: unknown
  value?: unknown
}

export type AlgoliaVideoHit = {
  objectID?: unknown
  videoId?: unknown
  titles?: unknown
  titlesWithLanguages?: unknown
  description?: unknown
  duration?: unknown
  languageId?: unknown
  languageEnglishName?: unknown
  slug?: unknown
  label?: unknown
  image?: unknown
  imageAlt?: unknown
  childrenCount?: unknown
}

type TransformAlgoliaVideoHitsInput = {
  hits: readonly AlgoliaVideoHit[]
  preferredLanguage?: SearchLanguageOption | null
  languageOptions?: readonly SearchLanguageOption[]
}

const ADMIN_VIDEO_LABELS = new Set<string>([
  "BEHIND_THE_SCENES",
  "COLLECTION",
  "EPISODE",
  "FEATURE_FILM",
  "SEGMENT",
  "SERIES",
  "SHORT_FILM",
  "TRAILER",
])

export function transformAlgoliaVideoHits({
  hits,
  preferredLanguage,
  languageOptions = [],
}: TransformAlgoliaVideoHitsInput): SearchResult[] {
  return hits.flatMap((hit) => {
    const id = pickString(hit.videoId) ?? pickString(hit.objectID)
    const slug = pickString(hit.slug) ?? pickString(hit.videoId)
    if (!id || !slug) return []

    const languageEnglishName = pickString(hit.languageEnglishName)
    const hitLanguage = languageOptionForHit({
      hit,
      languageEnglishName,
      languageOptions,
    })
    const title = pickTitle(hit, preferredLanguage?.coreId) ?? slug
    const description = pickFirstString(hit.description) ?? ""
    const label = normalizeVideoLabel(pickString(hit.label))

    return [
      {
        type: "video",
        id,
        slug,
        title,
        snippet: description,
        imageUrl: pickString(hit.image),
        imageBlurDataUrl: null,
        muxThumbnailBlurDataUrl: null,
        startSeconds: null,
        playbackId: null,
        score: 0,
        label,
        durationSeconds: pickPositiveInt(hit.duration),
        childCount: pickNonNegativeInt(hit.childrenCount),
        source: "algolia",
        languageSlug:
          hitLanguage?.publicSlug ?? preferredLanguage?.publicSlug ?? null,
        languageEnglishName,
      },
    ]
  })
}

function languageOptionForHit({
  hit,
  languageEnglishName,
  languageOptions,
}: {
  hit: AlgoliaVideoHit
  languageEnglishName: string | null
  languageOptions: readonly SearchLanguageOption[]
}): SearchLanguageOption | null {
  const languageId = pickString(hit.languageId)
  if (languageId) {
    const byCoreId = languageOptions.find(
      (option) => option.coreId === languageId,
    )
    if (byCoreId) return byCoreId
  }
  return languageEnglishName
    ? findSearchLanguageOptionByEnglishName(
        languageEnglishName,
        languageOptions,
      )
    : null
}

function pickTitle(
  hit: AlgoliaVideoHit,
  preferredLanguageCoreId: string | null | undefined,
): string | null {
  const localizedTitles = Array.isArray(hit.titlesWithLanguages)
    ? (hit.titlesWithLanguages as AlgoliaVideoTitle[])
    : []

  if (preferredLanguageCoreId) {
    const match = localizedTitles.find(
      (title) =>
        pickString(title.languageId) === preferredLanguageCoreId &&
        pickString(title.value),
    )
    const value = match ? pickString(match.value) : null
    if (value) return value
  }

  for (const title of localizedTitles) {
    const value = pickString(title.value)
    if (value) return value
  }

  return pickFirstString(hit.titles)
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function pickFirstString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (!Array.isArray(value)) return null
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) return item
  }
  return null
}

function pickPositiveInt(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : null
}

function pickNonNegativeInt(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.floor(numberValue)
    : null
}

function normalizeVideoLabel(value: string | null): AdminVideoLabel | null {
  if (!value) return null
  const normalized = value
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toUpperCase()
  return ADMIN_VIDEO_LABELS.has(normalized)
    ? (normalized as AdminVideoLabel)
    : null
}
