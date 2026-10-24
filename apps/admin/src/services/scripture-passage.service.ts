import type { PrismaClient } from "@prisma/client"
import { z } from "zod"

import { env, youVersionPassageCacheTtlSecondsEnvSchema } from "@/config/env"
import { toYouVersionReference } from "@/services/youversion-reference"

const YOUVERSION_API_BASE_URL = "https://api.youversion.com/v1"
const YOUVERSION_PROVIDER = "youversion"
const PASSAGE_CONTENT_FORMAT = "text"
const YOUVERSION_LAUNCH_FALLBACK_VERSION_ID = 3034
// Generated from production Admin languages + YouVersion /bibles on 2026-07-02.
// Only full-Bible candidates are included; partial/NT-only candidates stay out
// of runtime defaults until explicitly approved.
const YOUVERSION_LANGUAGE_VERSIONS = [
  { languageId: "7839", languageSlug: "arabic-hassaniya", versionId: 195 },
  {
    languageId: "22658",
    languageSlug: "arabic-modern-standard",
    versionId: 195,
  },
  { languageId: "1171", languageSlug: "assamese", versionId: 1979 },
  { languageId: "185219", languageSlug: "assamese-muslim", versionId: 1979 },
  { languageId: "176243", languageSlug: "bangla-2", versionId: 1883 },
  { languageId: "23514", languageSlug: "basque", versionId: 25 },
  { languageId: "21577", languageSlug: "bedamuni", versionId: 2441 },
  { languageId: "1259", languageSlug: "belorussian", versionId: 1573 },
  { languageId: "139081", languageSlug: "bengali-indian", versionId: 1883 },
  { languageId: "5671", languageSlug: "bhadrawahi", versionId: 2767 },
  { languageId: "24096", languageSlug: "chinese-qinghai", versionId: 43 },
  {
    languageId: "21754",
    languageSlug: "chinese-simplified",
    versionId: 43,
  },
  {
    languageId: "21753",
    languageSlug: "chinese-traditional",
    versionId: 312,
  },
  { languageId: "4432", languageSlug: "czech", versionId: 44 },
  { languageId: "4454", languageSlug: "danish", versionId: 49 },
  { languageId: "4633", languageSlug: "dawro", versionId: 1672 },
  {
    languageId: "529",
    languageSlug: "english",
    versionId: YOUVERSION_LAUNCH_FALLBACK_VERSION_ID,
  },
  { languageId: "185221", languageSlug: "english-african", versionId: 12 },
  { languageId: "185021", languageSlug: "english-british", versionId: 12 },
  {
    languageId: "23156",
    languageSlug: "english-north-american-indigenous",
    versionId: 12,
  },
  { languageId: "4820", languageSlug: "finnish", versionId: 60 },
  { languageId: "496", languageSlug: "french", versionId: 62 },
  { languageId: "53424", languageSlug: "french-african", versionId: 62 },
  { languageId: "4635", languageSlug: "gamo", versionId: 434 },
  { languageId: "1106", languageSlug: "german-standard", versionId: 51 },
  { languageId: "4634", languageSlug: "gofa", versionId: 2344 },
  { languageId: "6600", languageSlug: "gujarati", versionId: 1911 },
  { languageId: "4699", languageSlug: "guji", versionId: 4125 },
  { languageId: "5709", languageSlug: "haryanvi", versionId: 2766 },
  { languageId: "6464", languageSlug: "hindi", versionId: 819 },
  { languageId: "147285", languageSlug: "konta", versionId: 1672 },
  { languageId: "184487", languageSlug: "mahasu-pahari", versionId: 2957 },
  { languageId: "20615", languageSlug: "mandarin-china", versionId: 43 },
  { languageId: "23221", languageSlug: "mandarin-taiwan", versionId: 312 },
  {
    languageId: "4700",
    languageSlug: "oromo-borana-arsi-guji",
    versionId: 4125,
  },
  {
    languageId: "21028",
    languageSlug: "spanish-latin-american",
    versionId: 147,
  },
  { languageId: "12551", languageSlug: "tagalog", versionId: 177 },
] as const satisfies readonly YouVersionLanguageVersion[]

type YouVersionLanguageVersion = {
  languageId: string
  languageSlug: string
  versionId: number
}

const YOUVERSION_VERSION_ID_BY_LANGUAGE_SLUG = buildLanguageVersionMap(
  YOUVERSION_LANGUAGE_VERSIONS,
  (entry) => entry.languageSlug.trim().toLowerCase(),
)
const YOUVERSION_VERSION_ID_BY_LANGUAGE_ID = buildLanguageVersionMap(
  YOUVERSION_LANGUAGE_VERSIONS,
  (entry) => entry.languageId.trim(),
)

const YouVersionVersionSchema = z
  .object({
    copyright: z.string().optional().nullable(),
    copyright_long: z.string().optional().nullable(),
    copyright_short: z.string().optional().nullable(),
    id: z.number().int().positive(),
    localized_abbreviation: z.string().optional().nullable(),
    localized_title: z.string().optional().nullable(),
    publisher_url: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
  })
  .passthrough()

const YouVersionPassageSchema = z
  .object({
    content: z.string().trim().min(1),
    id: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
  })
  .passthrough()

type YouVersionVersion = z.infer<typeof YouVersionVersionSchema>

export type Passage = {
  content: string
  copyright: string
  humanReference: string
  provider: string
  publisherUrl: string | null
  reference: string
  versionAbbreviation: string | null
  versionId: number
  versionTitle: string | null
}

type CitationForPassage = {
  id: string
  osisId: string | null
  chapterStart: number | null
  chapterEnd: number | null
  verseStart: number | null
  verseEnd: number | null
  bibleBook: { name: unknown } | null
}

type FetchLike = typeof fetch

export class ScripturePassageService {
  private readonly versionById = new Map<
    number,
    Promise<YouVersionVersion | null>
  >()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async getPassageForCitation({
    citationId,
    languageId,
    languageSlug,
  }: {
    citationId: string
    languageId?: string | null
    languageSlug?: string | null
  }): Promise<Passage | null> {
    const appKey = env.YOUVERSION_APP_KEY?.trim()
    if (!appKey) return null

    const citation = await this.prisma.bibleCitation.findFirst({
      where: { id: citationId, deletedAt: null },
      select: {
        id: true,
        osisId: true,
        chapterStart: true,
        chapterEnd: true,
        verseStart: true,
        verseEnd: true,
        bibleBook: { select: { name: true } },
      },
    })
    if (citation == null) return null

    const reference = toYouVersionReference(toCitationLike(citation))
    if (reference == null) return null

    const versionId = getVersionIdForLanguage({ languageId, languageSlug })
    const versionIdString = versionId.toString()
    const now = new Date()
    const cacheKey = {
      provider_versionId_reference_contentFormat: {
        provider: YOUVERSION_PROVIDER,
        versionId: versionIdString,
        reference,
        contentFormat: PASSAGE_CONTENT_FORMAT,
      },
    }

    const cached = await this.prisma.biblePassageCache.findUnique({
      where: cacheKey,
    })
    if (cached != null && cached.expiresAt > now) {
      return {
        content: cached.content,
        copyright: cached.copyright,
        humanReference: cached.humanReference ?? reference,
        provider: cached.provider,
        publisherUrl: cached.publisherUrl,
        reference: cached.reference,
        versionAbbreviation: cached.versionAbbreviation,
        versionId,
        versionTitle: cached.versionTitle,
      }
    }

    const version = await this.getYouVersionVersion(appKey, versionId)
    if (version == null) return null

    const copyright = getVersionCopyright(version)
    if (copyright == null) return null

    const passage = await this.fetchYouVersionPassage(
      appKey,
      versionId,
      reference,
    )
    if (passage == null) return null

    const expiresAt = new Date(
      now.getTime() +
        youVersionPassageCacheTtlSecondsEnvSchema.parse(
          env.YOUVERSION_PASSAGE_CACHE_TTL_SECONDS,
        ) *
          1000,
    )
    const data = {
      provider: YOUVERSION_PROVIDER,
      versionId: versionIdString,
      reference,
      contentFormat: PASSAGE_CONTENT_FORMAT,
      content: passage.content.trim(),
      humanReference: normalizeOptionalString(passage.reference) ?? reference,
      versionAbbreviation: normalizeOptionalString(
        version.localized_abbreviation,
      ),
      versionTitle:
        normalizeOptionalString(version.localized_title) ??
        normalizeOptionalString(version.title),
      copyright,
      publisherUrl: normalizeHttpUrl(version.publisher_url),
      fetchedAt: now,
      expiresAt,
    }

    const saved = await this.prisma.biblePassageCache.upsert({
      where: cacheKey,
      create: data,
      update: data,
    })

    return {
      content: saved.content,
      copyright: saved.copyright,
      humanReference: saved.humanReference ?? reference,
      provider: saved.provider,
      publisherUrl: saved.publisherUrl,
      reference: saved.reference,
      versionAbbreviation: saved.versionAbbreviation,
      versionId,
      versionTitle: saved.versionTitle,
    }
  }

  private getYouVersionVersion(appKey: string, versionId: number) {
    const existing = this.versionById.get(versionId)
    if (existing != null) return existing

    const version = this.fetchYouVersionJson(
      `${YOUVERSION_API_BASE_URL}/bibles/${versionId}`,
      appKey,
      YouVersionVersionSchema,
    )
    this.versionById.set(versionId, version)
    return version
  }

  private fetchYouVersionPassage(
    appKey: string,
    versionId: number,
    reference: string,
  ) {
    const url = new URL(
      `${YOUVERSION_API_BASE_URL}/bibles/${versionId}/passages/${encodeURIComponent(reference)}`,
    )
    url.searchParams.set("format", PASSAGE_CONTENT_FORMAT)
    url.searchParams.set("include_headings", "false")
    url.searchParams.set("include_notes", "false")

    return this.fetchYouVersionJson(
      url.toString(),
      appKey,
      YouVersionPassageSchema,
    )
  }

  private async fetchYouVersionJson<T>(
    url: string,
    appKey: string,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    let response: Response
    try {
      response = await this.fetchFn(url, {
        headers: {
          Accept: "application/json",
          "X-YVP-App-Key": appKey,
        },
      })
    } catch {
      return null
    }

    if (!response.ok) return null

    let json: unknown
    try {
      json = await response.json()
    } catch {
      return null
    }

    const parsed = schema.safeParse(json)
    return parsed.success ? parsed.data : null
  }
}

function toCitationLike(citation: CitationForPassage) {
  return {
    osisId: citation.osisId,
    chapterStart: citation.chapterStart,
    chapterEnd: citation.chapterEnd,
    verseStart: citation.verseStart,
    verseEnd: citation.verseEnd,
    bibleBook: {
      name: pickEnglishName(citation.bibleBook?.name),
    },
  }
}

function getVersionIdForLanguage({
  languageId,
  languageSlug,
}: {
  languageId: string | null | undefined
  languageSlug: string | null | undefined
}) {
  const normalizedLanguageSlug =
    typeof languageSlug === "string" && languageSlug.trim().length > 0
      ? languageSlug.trim().toLowerCase()
      : null
  if (normalizedLanguageSlug != null) {
    const versionId = YOUVERSION_VERSION_ID_BY_LANGUAGE_SLUG.get(
      normalizedLanguageSlug,
    )
    if (versionId != null) return versionId
  }

  const normalizedLanguageId =
    typeof languageId === "string" && languageId.trim().length > 0
      ? languageId.trim()
      : null
  if (normalizedLanguageId == null) return YOUVERSION_LAUNCH_FALLBACK_VERSION_ID

  return (
    YOUVERSION_VERSION_ID_BY_LANGUAGE_ID.get(normalizedLanguageId) ??
    YOUVERSION_LAUNCH_FALLBACK_VERSION_ID
  )
}

function buildLanguageVersionMap(
  entries: readonly YouVersionLanguageVersion[],
  getKey: (entry: YouVersionLanguageVersion) => string,
) {
  const map = new Map<string, number>()
  for (const entry of entries) {
    const key = getKey(entry)
    if (key.length === 0) {
      throw new Error("Empty YouVersion language mapping key")
    }
    if (map.has(key)) {
      throw new Error(`Duplicate YouVersion language mapping for ${key}`)
    }
    map.set(key, entry.versionId)
  }
  return map
}

function pickEnglishName(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null
  if (typeof value !== "object" || value == null) return null
  const map = value as Record<string, unknown>
  return typeof map.en === "string" && map.en.length > 0 ? map.en : null
}

function getVersionCopyright(version: YouVersionVersion) {
  return (
    normalizeOptionalString(version.copyright) ??
    normalizeOptionalString(version.copyright_short) ??
    normalizeOptionalString(version.copyright_long)
  )
}

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeHttpUrl(value: string | null | undefined) {
  const trimmed = normalizeOptionalString(value)
  if (trimmed == null) return null

  try {
    const url = new URL(trimmed)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}
