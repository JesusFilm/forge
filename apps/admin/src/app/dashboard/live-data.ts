import type { LocaleStatus, VideoDub } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import {
  BlocksSchema,
  type Block,
  type ContainerContentBlock,
  type SectionContentBlock,
} from "@/domain/blocks"
import { getAdminLocale } from "@/i18n/server"
import { createServices } from "@/services"
import { env } from "@/config/env"
import { WatchRouteManifestStore } from "@/services/watch-route-manifest-store"
import {
  createVideoLibraryPagination,
  formatVideoUpdatedRelative,
  normalizeVideoThumbnailUrl,
  resolveVideoVisitorUrl,
  videoLibraryHref,
  type VideoLibraryCategory,
  type VideoLibrarySort,
  VIDEO_LIBRARY_PAGE_SIZE,
} from "./video-library-utils"

function isMissingTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  )
}

type ExperienceLocaleRow = {
  experienceId: string
  locale: string
  slug: string
  pathSegment: string | null
  title: string | null
  ogImageUrl: string | null
  blocks: unknown
  status: LocaleStatus
  updatedAt: Date
}

type VideoLocaleRow = {
  videoId: string
  locale: string | null
  title: string | null
  description: string | null
  updatedAt: Date
}

type VideoLanguageCountryRow = {
  order: number | null
  primary: boolean | null
  speakers: number | null
  suggested: boolean | null
  country: {
    flagPngSrc: string | null
    flagWebpSrc: string | null
  } | null
}

type VideoDubRow = VideoDub & {
  language: {
    bcp47: string | null
    countryLanguages: VideoLanguageCountryRow[]
    id: string
    iso3: string | null
    name: unknown
    slug: string | null
  } | null
}

type VideoLanguageChip = {
  code: string
  flagUrl: string | null
}

type VideoImageRow = {
  videoId: string
  url: string | null
  kind: string | null
  createdAt: Date
}

type LoadVideoRowSliceOptions = {
  category?: VideoLibraryCategory
  collection?: string
  language?: string
  preferredLocale?: string
  principal: Principal
  limit: number
  offset: number
  search?: string
  sort?: VideoLibrarySort
  includeVisitorUrls?: boolean
  /** Fetch exactly these video ids instead of a catalog page (additive). */
  videoIds?: readonly string[]
}

export type VideoLibraryLanguageOption = {
  label: string
  value: string
}

export type VideoLibraryDetailField = {
  label: string
  value: string
}

export type VideoLibraryDetailItem = {
  key: string
  title: string
  meta: string
  detail?: string | null
  detailHref?: string | null
  flagUrl?: string | null
  href?: string | null
  imageUrl?: string | null
  titleHref?: string | null
}

export type VideoLibraryDetailSection = {
  title: string
  count?: number
  items: VideoLibraryDetailItem[]
  empty: string
}

export type VideoLibraryDetail = {
  key: string
  title: string
  description: string | null
  previewImageUrl: string | null
  label: string
  source: string
  duration: string
  muxPlayerUrl: string | null
  visitorUrl: string | null
  identity: VideoLibraryDetailField[]
  status: VideoLibraryDetailField[]
  timestamps: VideoLibraryDetailField[]
  localizedContent: VideoLibraryDetailSection
  dubs: VideoLibraryDetailSection
  images: VideoLibraryDetailSection
  subtitles: VideoLibraryDetailSection
  studyQuestions: VideoLibraryDetailSection
  bibleCitations: VideoLibraryDetailSection
  keywords: VideoLibraryDetailSection
  parents: VideoLibraryDetailSection
  children: VideoLibraryDetailSection
  technical: VideoLibraryDetailSection
}

export type VideoLibraryCollectionSummary = {
  key: string
  title: string
  slug: string
  childCount: number
}

const VIDEO_LIBRARY_LANGUAGE_TARGET = 2300
const VIDEO_LIBRARY_LANGUAGE_CHIP_LIMIT = 5
const VIDEO_LIBRARY_LANGUAGE_OPTION_LIMIT = 200
const VIDEO_LIBRARY_DETAIL_RELATION_LIMIT = 80

function durationSecondsForDub(
  dub: Pick<VideoDubRow, "lengthInMilliseconds" | "duration">,
) {
  if (dub.lengthInMilliseconds != null) {
    return Number(dub.lengthInMilliseconds / BigInt(1000))
  }
  return dub.duration ?? null
}

function preferredPlaybackDub(dubs: VideoDubRow[]) {
  return (
    dubs.find((dub) => dub.hls) ??
    dubs.find((dub) => dub.dash || dub.share) ??
    null
  )
}

function streamUrlForDub(dub: Pick<VideoDubRow, "dash" | "hls" | "share">) {
  return compactText(dub.hls) ?? compactText(dub.dash) ?? compactText(dub.share)
}

function localeMatchesDubLanguage(locale: string, dub: VideoDubRow) {
  const language = dub.language
  if (!language) return false

  const normalizedLocale = compactText(locale)?.toLowerCase()
  if (!normalizedLocale) return false

  const baseLocale = normalizedLocale.split("-")[0] ?? normalizedLocale
  const languageCodes = [
    language.bcp47?.toLowerCase() ?? "",
    language.slug?.toLowerCase() ?? "",
    language.iso3?.toLowerCase() ?? "",
  ].filter(Boolean)

  return (
    languageCodes.includes(normalizedLocale) ||
    languageCodes.includes(baseLocale) ||
    languageCodes.some((code) => code.startsWith(`${baseLocale}-`))
  )
}

function playableDubsForPicker(dubs: VideoDubRow[], locale: string) {
  const seenByLanguage = new Set<string>()
  return dubs.flatMap((dub) => {
    const streamUrl = streamUrlForDub(dub)
    if (!streamUrl) return []

    const languageKey =
      dub.language?.slug ??
      dub.language?.bcp47 ??
      dub.language?.iso3 ??
      dub.language?.id ??
      dub.id
    if (seenByLanguage.has(languageKey)) return []
    seenByLanguage.add(languageKey)

    return [
      {
        key: dub.id,
        label: dub.language
          ? languageOptionLabel(dub.language, locale)
          : `Dub ${seenByLanguage.size}`,
        languageId: dub.language?.id ?? null,
        languageSlug: dub.language?.slug ?? null,
        bcp47: dub.language?.bcp47 ?? null,
        streamUrl,
        duration: formatDuration([dub]),
        durationSeconds: durationSecondsForDub(dub),
      },
    ]
  })
}

function preferredPickerDub(dubs: VideoDubRow[], locale: string) {
  const playableDubs = dubs.filter((dub) => streamUrlForDub(dub))
  return (
    playableDubs.find((dub) => localeMatchesDubLanguage(locale, dub)) ??
    preferredPlaybackDub(playableDubs)
  )
}

function muxPlayerUrl(playbackId: string | null | undefined) {
  const value = compactText(playbackId)
  return value ? `https://player.mux.com/${encodeURIComponent(value)}` : null
}

function preferredMuxPlayerUrl<
  T extends Pick<VideoDubRow, "dash" | "hls" | "share"> & {
    muxVideo?: { playbackId: string | null } | null
  },
>(dubs: readonly T[]) {
  const preferredDub =
    dubs.find((dub) => dub.hls && compactText(dub.muxVideo?.playbackId)) ??
    dubs.find(
      (dub) => (dub.dash || dub.share) && compactText(dub.muxVideo?.playbackId),
    ) ??
    dubs.find((dub) => compactText(dub.muxVideo?.playbackId))

  return muxPlayerUrl(preferredDub?.muxVideo?.playbackId)
}

function preferredLocaleCodes(locale: string) {
  const base = locale.split("-")[0]
  return base && base !== locale ? [locale, base] : [locale]
}

function choosePreferredLocale<T extends { locale: string }>(
  locales: readonly T[],
  preferred: string,
) {
  const priority = preferredLocaleCodes(preferred)
  for (const code of priority) {
    const exact = locales.find((item) => item.locale === code)
    if (exact) return exact
  }

  for (const code of priority) {
    const partial = locales.find((item) => item.locale.startsWith(code))
    if (partial) return partial
  }

  return locales[0]
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)
}

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(value)
}

function statusTone(status: LocaleStatus): "success" | "warning" | "danger" {
  if (status === "PUBLISHED") return "success"
  if (status === "ARCHIVED") return "danger"
  return "warning"
}

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null
}

function externalHttpUrl(value: string | null | undefined) {
  const url = compactText(value)
  if (!url) return null

  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

const BIBLE_DOT_COM_BOOK_CODES: Record<string, string> = {
  Gen: "GEN",
  Exod: "EXO",
  Lev: "LEV",
  Num: "NUM",
  Deut: "DEU",
  Josh: "JOS",
  Judg: "JDG",
  Ruth: "RUT",
  "1Sam": "1SA",
  "2Sam": "2SA",
  "1Kgs": "1KI",
  "2Kgs": "2KI",
  "1Chr": "1CH",
  "2Chr": "2CH",
  Ezra: "EZR",
  Neh: "NEH",
  Esth: "EST",
  Job: "JOB",
  Ps: "PSA",
  Prov: "PRO",
  Eccl: "ECC",
  Song: "SNG",
  Isa: "ISA",
  Jer: "JER",
  Lam: "LAM",
  Ezek: "EZK",
  Dan: "DAN",
  Hos: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obad: "OBA",
  Jonah: "JON",
  Mic: "MIC",
  Nah: "NAM",
  Hab: "HAB",
  Zeph: "ZEP",
  Hag: "HAG",
  Zech: "ZEC",
  Mal: "MAL",
  Matt: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Rom: "ROM",
  "1Cor": "1CO",
  "2Cor": "2CO",
  Gal: "GAL",
  Eph: "EPH",
  Phil: "PHP",
  Col: "COL",
  "1Thess": "1TH",
  "2Thess": "2TH",
  "1Tim": "1TI",
  "2Tim": "2TI",
  Titus: "TIT",
  Phlm: "PHM",
  Heb: "HEB",
  Jas: "JAS",
  "1Pet": "1PE",
  "2Pet": "2PE",
  "1John": "1JN",
  "2John": "2JN",
  "3John": "3JN",
  Jude: "JUD",
  Rev: "REV",
}

function bibleDotComBookCode(osisId: string | null | undefined) {
  const value = compactText(osisId)
  if (!value) return null
  const code = BIBLE_DOT_COM_BOOK_CODES[value] ?? value.toUpperCase()
  return /^[1-3]?[A-Z]{2,3}$/.test(code) ? code : null
}

function bibleDotComHref({
  bookOsisId,
  chapter,
  verse,
}: {
  bookOsisId: string | null | undefined
  chapter: number | null
  verse: number | null
}) {
  const bookCode = bibleDotComBookCode(bookOsisId)
  if (!bookCode || chapter == null) return null

  const reference =
    verse == null ? `${bookCode}.${chapter}` : `${bookCode}.${chapter}.${verse}`
  return `https://www.bible.com/bible/1/${reference}.KJV`
}

function videoIdentifierWhere(identifier: string) {
  return {
    OR: [{ id: identifier }, { coreId: identifier }, { slug: identifier }],
  }
}

function displayValue(value: string | number | boolean | null | undefined) {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return value.toLocaleString("en")
  return compactText(value?.toString())
}

function displayDateTime(value: Date | null | undefined) {
  return value ? formatDateTime(value) : null
}

function displayLanguage(
  language:
    | {
        bcp47: string | null
        id: string
        iso3: string | null
        name?: unknown
        slug: string | null
      }
    | null
    | undefined,
  locale: string,
) {
  if (!language) return null
  return languageOptionLabel(
    {
      bcp47: language.bcp47,
      id: language.id,
      iso3: language.iso3,
      name: "name" in language ? language.name : null,
      slug: language.slug,
    },
    locale,
  )
}

function detailField(
  label: string,
  value: string | number | boolean | null | undefined,
): VideoLibraryDetailField | null {
  const displayed = displayValue(value)
  return displayed ? { label, value: displayed } : null
}

function compactFields(
  fields: Array<VideoLibraryDetailField | null>,
): VideoLibraryDetailField[] {
  return fields.filter((field): field is VideoLibraryDetailField => !!field)
}

function directUrl(value: object, fields: readonly string[]): string | null {
  for (const field of fields) {
    if (field in value) {
      const fieldValue = (value as Record<string, unknown>)[field]
      if (typeof fieldValue === "string" && fieldValue.trim()) {
        return fieldValue.trim()
      }
    }
  }
  return null
}

type PreviewBlock = Block | SectionContentBlock | ContainerContentBlock

function addVideoId(ids: Set<string>, value: string | null | undefined) {
  const id = compactText(value)
  if (id) ids.add(id)
}

function collectVideoIdsFromBlock(block: PreviewBlock, ids: Set<string>) {
  if (block.t === "video" || block.t === "videoHero") {
    addVideoId(ids, block.videoId)
  }

  if (block.t === "mediaCollection" || block.t === "videoCarousel") {
    for (const item of block.items) {
      addVideoId(ids, item.videoId)
    }
  }

  if (block.t === "mediaCollection") {
    for (const videoId of block.excludedVideoIds) {
      addVideoId(ids, videoId)
    }
  }

  if (block.t === "section") {
    for (const item of block.content) {
      collectVideoIdsFromBlock(item, ids)
    }
  }

  if (block.t === "container") {
    for (const item of block.content) {
      collectVideoIdsFromBlock(item, ids)
    }
  }
}

function videoIdsFromBlocks(blocks: readonly Block[]) {
  const ids = new Set<string>()
  for (const block of blocks) {
    collectVideoIdsFromBlock(block, ids)
  }
  return Array.from(ids)
}

/**
 * Video ids referenced by an experience locale's raw `blocks` JSON.
 * Used by the experience editor to top-up the video library with
 * AI-referenced videos that fall outside the first library page
 * (experience-AI chat; additive).
 */
export function videoIdsFromExperienceBlocks(blocks: unknown) {
  const parsed = BlocksSchema.safeParse(blocks)
  return parsed.success ? videoIdsFromBlocks(parsed.data) : []
}

function parsedExperienceBlocks(locale: Pick<ExperienceLocaleRow, "blocks">) {
  const parsed = BlocksSchema.safeParse(locale.blocks)
  return parsed.success ? parsed.data : []
}

function previewImageForVideo(
  videoId: string | null | undefined,
  videoImagesByVideoId: Map<string, VideoImageRow[]>,
) {
  const id = compactText(videoId)
  return id ? preferredVideoImage(videoImagesByVideoId.get(id) ?? []) : null
}

function previewImageFromBlock(
  block: PreviewBlock,
  videoImagesByVideoId: Map<string, VideoImageRow[]>,
): string | null {
  const direct = directUrl(block, ["mediaUrl"])
  if (direct) return direct

  if (block.t === "video" || block.t === "videoHero") {
    return previewImageForVideo(block.videoId, videoImagesByVideoId)
  }

  if (block.t === "mediaCollection") {
    for (const item of block.items) {
      const itemImage = previewImageForVideo(item.videoId, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  if (block.t === "videoCarousel") {
    for (const item of block.items) {
      const itemImage = previewImageForVideo(item.videoId, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  if (block.t === "section") {
    for (const item of block.content) {
      const itemImage = previewImageFromBlock(item, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  if (block.t === "container") {
    for (const item of block.content) {
      const itemImage = previewImageFromBlock(item, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  return null
}

function previewForExperienceLocale(
  locale: ExperienceLocaleRow,
  videoImagesByVideoId: Map<string, VideoImageRow[]>,
) {
  const blocks = parsedExperienceBlocks(locale)
  const imageUrl =
    compactText(locale.ogImageUrl) ??
    blocks
      .map((block) => previewImageFromBlock(block, videoImagesByVideoId))
      .find((url): url is string => !!url) ??
    null

  return {
    imageUrl,
  }
}

function normalizePathPart(value: string | null | undefined) {
  return value?.trim().replace(/^\/+|\/+$/g, "") ?? ""
}

function experiencePath(
  locale: Pick<ExperienceLocaleRow, "pathSegment" | "slug">,
) {
  const parts = [
    normalizePathPart(locale.pathSegment),
    normalizePathPart(locale.slug),
  ].filter(Boolean)

  return `/${parts.join("/")}`
}

function sourceLabel(
  videoSource: "INTERNAL" | "YOUTUBE" | "CLOUDFLARE" | "MUX" | null,
) {
  if (videoSource === "MUX") return { label: "Mux", tone: "info" as const }
  if (videoSource === "CLOUDFLARE") {
    return { label: "Cloudflare", tone: "success" as const }
  }
  if (videoSource === "YOUTUBE") {
    return { label: "YouTube", tone: "warning" as const }
  }
  return { label: "Internal", tone: "muted" as const }
}

function localizedVideoLabel(
  label:
    | "COLLECTION"
    | "EPISODE"
    | "FEATURE_FILM"
    | "SEGMENT"
    | "SERIES"
    | "SHORT_FILM"
    | "TRAILER"
    | "BEHIND_THE_SCENES"
    | null,
  locale: string,
) {
  if (!label) return null
  const isSpanish = locale.startsWith("es")
  const labels = isSpanish
    ? {
        COLLECTION: "Coleccion",
        EPISODE: "Episodio",
        FEATURE_FILM: "Largometraje",
        SEGMENT: "Segmento",
        SERIES: "Serie",
        SHORT_FILM: "Cortometraje",
        TRAILER: "Tráiler",
        BEHIND_THE_SCENES: "Detrás de cámaras",
      }
    : {
        COLLECTION: "Collection",
        EPISODE: "Episode",
        FEATURE_FILM: "Feature Film",
        SEGMENT: "Segment",
        SERIES: "Series",
        SHORT_FILM: "Short Film",
        TRAILER: "Trailer",
        BEHIND_THE_SCENES: "Behind the Scenes",
      }

  return labels[label]
}

function localizedJsonName(value: unknown, locale: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  for (const code of [...preferredLocaleCodes(locale), "en"]) {
    const match = record[code]
    if (typeof match === "string" && match.trim()) {
      return match.trim()
    }
  }

  const fallback = Object.values(record).find(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  )
  return fallback?.trim() ?? null
}

function languageOptionLabel(
  language: {
    bcp47: string | null
    id: string
    iso3: string | null
    name: unknown
    slug: string | null
  },
  locale: string,
) {
  return (
    localizedJsonName(language.name, locale) ??
    language.slug ??
    language.bcp47 ??
    language.iso3 ??
    language.id
  )
}

function languageOptionValue(language: {
  bcp47: string | null
  id: string
  iso3: string | null
  slug: string | null
}) {
  return language.slug ?? language.bcp47 ?? language.iso3 ?? language.id
}

function formatDuration(
  dubs: Array<Pick<VideoDubRow, "duration" | "lengthInMilliseconds">>,
): string {
  const dub =
    dubs.find((item) => item.lengthInMilliseconds || item.duration) ?? null
  if (!dub) return "--:--"

  const seconds = durationSecondsForDub(dub) ?? 0

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function dubCoverage(dubs: VideoDubRow[]): string {
  if (dubs.length === 0) return "No dubs"

  const allTags = Array.from(
    new Set(
      dubs.map(
        (dub) =>
          dub.language?.bcp47 ?? dub.language?.iso3 ?? dub.language?.slug,
      ),
    ),
  )
    .filter((tag): tag is string => !!tag)
    .map((tag) => tag.toUpperCase())
  const tags = allTags.slice(0, 4)

  const count = dubs.length
  const label = count === 1 ? "1 dub" : `${count} dubs`
  if (tags.length === 0) return label

  const suffix = allTags.length > tags.length ? ", ..." : ""
  return `${label} · ${tags.join(", ")}${suffix}`
}

function countryFlagUrl(
  country: VideoLanguageCountryRow["country"],
): string | null {
  return (
    compactText(country?.flagWebpSrc) ??
    compactText(country?.flagPngSrc) ??
    null
  )
}

function preferredCountryLanguage(countryLanguages: VideoLanguageCountryRow[]) {
  return countryLanguages
    .filter((countryLanguage) => countryFlagUrl(countryLanguage.country))
    .sort((left, right) => {
      const primary =
        Number(Boolean(right.primary)) - Number(Boolean(left.primary))
      if (primary !== 0) return primary

      const suggested =
        Number(Boolean(right.suggested)) - Number(Boolean(left.suggested))
      if (suggested !== 0) return suggested

      const order =
        (left.order ?? Number.MAX_SAFE_INTEGER) -
        (right.order ?? Number.MAX_SAFE_INTEGER)
      if (order !== 0) return order

      return (right.speakers ?? -1) - (left.speakers ?? -1)
    })[0]
}

function dubLanguageChip(dub: VideoDubRow): VideoLanguageChip | null {
  const code = compactText(
    dub.language?.iso3 ?? dub.language?.bcp47 ?? dub.language?.slug,
  )?.toUpperCase()
  if (!code) return null

  const countryLanguage = dub.language
    ? preferredCountryLanguage(dub.language.countryLanguages)
    : undefined

  return {
    code,
    flagUrl: countryFlagUrl(countryLanguage?.country ?? null),
  }
}

function dubLanguageChips(dubs: VideoDubRow[]) {
  const chips = new Map<string, VideoLanguageChip>()
  for (const dub of dubs) {
    const chip = dubLanguageChip(dub)
    if (!chip || chips.has(chip.code)) continue
    chips.set(chip.code, chip)
  }

  return Array.from(chips.values())
}

function dubCoverageMetric(dubs: VideoDubRow[]) {
  const allLanguages = dubLanguageChips(dubs)
  const count = allLanguages.length || dubs.length
  const percent =
    count === 0
      ? 0
      : Math.min(
          100,
          Math.max(
            1,
            Math.round((count / VIDEO_LIBRARY_LANGUAGE_TARGET) * 100),
          ),
        )
  const languages = allLanguages.slice(0, VIDEO_LIBRARY_LANGUAGE_CHIP_LIMIT)

  return {
    dubCount: count,
    dubLanguages: languages,
    dubOverflowCount: Math.max(0, count - languages.length),
    dubCoveragePercent: percent,
  }
}

function preferredVideoImage(images: VideoImageRow[]) {
  if (images.length === 0) return null

  const priority = ["videoStill", "mobileCinematicHigh", "poster", "still"]
  for (const kind of priority) {
    const match = images.find((image) => image.kind === kind && image.url)
    if (match?.url) return normalizeVideoThumbnailUrl(match.url)
  }

  return normalizeVideoThumbnailUrl(images.find((image) => image.url)?.url)
}

async function countActiveVideos({
  category,
  collection,
  language,
  query,
}: {
  category?: VideoLibraryCategory
  collection?: string
  language?: string
  query?: string
}) {
  const services = createServices(prisma)
  try {
    return await services.video.countActive({
      category,
      collection,
      language,
      search: query,
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return 0
    }
    throw error
  }
}

async function loadVideoCollectionSummary(
  collection: string | null | undefined,
): Promise<VideoLibraryCollectionSummary | null> {
  const identifier = compactText(collection)
  if (!identifier) return null

  const locale = await getAdminLocale()

  try {
    const video = await prisma.video.findFirst({
      where: {
        deletedAt: null,
        ...videoIdentifierWhere(identifier),
      },
      select: {
        id: true,
        slug: true,
        locales: {
          where: { deletedAt: null },
          select: {
            locale: true,
            title: true,
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    })

    if (!video) return null

    const childCount = await prisma.videoRelation.count({
      where: {
        parentId: video.id,
        child: { deletedAt: null },
      },
    })
    const localeRows = video.locales.filter(
      (item): item is { locale: string; title: string | null } =>
        item.locale != null,
    )
    const localeRow = choosePreferredLocale(localeRows, locale)

    return {
      key: video.id,
      title: compactText(localeRow?.title) ?? video.slug,
      slug: video.slug,
      childCount,
    }
  } catch (error) {
    if (isMissingTableError(error)) {
      return null
    }
    throw error
  }
}

function shortDetail(value: string | null | undefined, limit = 220) {
  const text = compactText(value)
  if (!text) return null
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text
}

function detailSection({
  count,
  empty,
  items,
  title,
}: VideoLibraryDetailSection): VideoLibraryDetailSection {
  return { title, count, items, empty }
}

function relationVideoTitle(
  video: {
    slug: string
    locales: Array<{ locale: string | null; title: string | null }>
  },
  locale: string,
) {
  const localeRows = video.locales.filter(
    (item): item is { locale: string; title: string | null } =>
      item.locale != null,
  )
  const localeRow = choosePreferredLocale(localeRows, locale)
  return compactText(localeRow?.title) ?? video.slug
}

export async function loadVideoLibraryDetail(
  videoIdentifier: string | null | undefined,
): Promise<VideoLibraryDetail | null> {
  const identifier = compactText(videoIdentifier)
  if (!identifier) return null

  const locale = await getAdminLocale()

  try {
    const video = await prisma.video.findFirst({
      where: {
        deletedAt: null,
        ...videoIdentifierWhere(identifier),
      },
      include: {
        primaryLanguage: {
          select: {
            bcp47: true,
            id: true,
            iso3: true,
            name: true,
            slug: true,
          },
        },
        origin: {
          select: {
            coreId: true,
            description: true,
            id: true,
            name: true,
            source: true,
          },
        },
        locales: {
          where: { deletedAt: null },
          include: {
            language: {
              select: {
                bcp47: true,
                id: true,
                iso3: true,
                name: true,
                slug: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        dubs: {
          where: { deletedAt: null },
          include: {
            language: {
              select: {
                bcp47: true,
                countryLanguages: {
                  where: { deletedAt: null },
                  select: {
                    order: true,
                    primary: true,
                    speakers: true,
                    suggested: true,
                    country: {
                      select: {
                        flagPngSrc: true,
                        flagWebpSrc: true,
                      },
                    },
                  },
                },
                id: true,
                iso3: true,
                name: true,
                slug: true,
              },
            },
            videoEdition: {
              select: {
                coreId: true,
                id: true,
                name: true,
              },
            },
            muxVideo: {
              select: {
                assetId: true,
                playbackId: true,
                uploadId: true,
              },
            },
            downloads: {
              where: { deletedAt: null },
              select: {
                quality: true,
              },
              take: 6,
            },
          },
          orderBy: { updatedAt: "desc" },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        images: {
          where: { deletedAt: null },
          select: {
            aspectRatio: true,
            height: true,
            id: true,
            kind: true,
            url: true,
            width: true,
          },
          orderBy: { createdAt: "asc" },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        subtitles: {
          where: { deletedAt: null },
          include: {
            language: {
              select: {
                bcp47: true,
                id: true,
                iso3: true,
                name: true,
                slug: true,
              },
            },
            videoEdition: {
              select: {
                name: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        studyQuestions: {
          where: { deletedAt: null },
          include: {
            language: {
              select: {
                bcp47: true,
                id: true,
                iso3: true,
                name: true,
                slug: true,
              },
            },
          },
          orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        bibleCitations: {
          where: { deletedAt: null },
          include: {
            bibleBook: {
              select: {
                name: true,
                osisId: true,
              },
            },
          },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        keywords: {
          where: {
            keyword: { deletedAt: null },
          },
          include: {
            keyword: {
              include: {
                language: {
                  select: {
                    bcp47: true,
                    id: true,
                    iso3: true,
                    name: true,
                    slug: true,
                  },
                },
              },
            },
          },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        parents: {
          where: {
            parent: { deletedAt: null },
          },
          include: {
            parent: {
              select: {
                coreId: true,
                id: true,
                label: true,
                locales: {
                  where: { deletedAt: null },
                  select: {
                    locale: true,
                    title: true,
                  },
                  take: 12,
                },
                slug: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        children: {
          where: {
            child: { deletedAt: null },
          },
          include: {
            child: {
              select: {
                coreId: true,
                id: true,
                label: true,
                locales: {
                  where: { deletedAt: null },
                  select: {
                    locale: true,
                    title: true,
                  },
                  take: 12,
                },
                slug: true,
              },
            },
          },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        scenes: {
          select: {
            chapterTitle: true,
            endSeconds: true,
            id: true,
            sceneIndex: true,
            startSeconds: true,
          },
          orderBy: { sceneIndex: "asc" },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
        transcripts: {
          select: {
            dimensions: true,
            generatedAt: true,
            id: true,
            language: true,
            model: true,
            totalChunks: true,
            totalTokens: true,
          },
          orderBy: { updatedAt: "desc" },
          take: VIDEO_LIBRARY_DETAIL_RELATION_LIMIT,
        },
      },
    })

    if (!video) return null

    const [
      dubCount,
      imageCount,
      localeCount,
      subtitleCount,
      studyQuestionCount,
      bibleCitationCount,
      keywordCount,
      parentCount,
      childCount,
      sceneCount,
      transcriptCount,
    ] = await Promise.all([
      prisma.videoDub.count({ where: { videoId: video.id, deletedAt: null } }),
      prisma.videoImage.count({
        where: { videoId: video.id, deletedAt: null },
      }),
      prisma.videoLocale.count({
        where: { videoId: video.id, deletedAt: null },
      }),
      prisma.videoSubtitle.count({
        where: { videoId: video.id, deletedAt: null },
      }),
      prisma.videoStudyQuestion.count({
        where: { videoId: video.id, deletedAt: null },
      }),
      prisma.bibleCitation.count({
        where: { videoId: video.id, deletedAt: null },
      }),
      prisma.videoKeyword.count({
        where: { videoId: video.id, keyword: { deletedAt: null } },
      }),
      prisma.videoRelation.count({
        where: { childId: video.id, parent: { deletedAt: null } },
      }),
      prisma.videoRelation.count({
        where: { parentId: video.id, child: { deletedAt: null } },
      }),
      prisma.videoScene.count({ where: { videoId: video.id } }),
      prisma.videoTranscript.count({ where: { videoId: video.id } }),
    ])

    const localeRows = video.locales.filter(
      (item): item is (typeof video.locales)[number] & { locale: string } =>
        item.locale != null,
    )
    const preferredLocale = choosePreferredLocale(localeRows, locale)
    const title = compactText(preferredLocale?.title) ?? video.slug
    const source = sourceLabel(video.videoSource)
    const imageRows = video.images.map((image) => ({
      videoId: video.id,
      url: image.url,
      kind: image.kind,
      createdAt: new Date(0),
    }))
    const routeManifest = await loadLatestWatchRouteManifest()
    const visitorUrl = resolveVideoVisitorUrl({
      contentSlug: video.slug,
      languageSlugs: video.dubs.map((dub) => dub.language?.slug),
      manifest: routeManifest,
      webOrigin: env.WEB_CANONICAL_ORIGIN,
    })

    return {
      key: video.id,
      title,
      description: shortDetail(preferredLocale?.description, 320),
      previewImageUrl: preferredVideoImage(imageRows),
      label: localizedVideoLabel(video.label ?? null, locale) ?? "Video",
      source: source.label,
      duration: formatDuration(video.dubs),
      muxPlayerUrl: preferredMuxPlayerUrl(video.dubs),
      visitorUrl,
      identity: compactFields([
        detailField("Database ID", video.id),
        detailField("Core ID", video.coreId),
        detailField("Slug", video.slug),
        detailField("Label", localizedVideoLabel(video.label ?? null, locale)),
        detailField("Video source", source.label),
        detailField("Origin", video.origin?.name),
        detailField("Origin Core ID", video.origin?.coreId),
        detailField(
          "Primary language",
          displayLanguage(video.primaryLanguage, locale),
        ),
      ]),
      status: compactFields([
        detailField("Published at", displayDateTime(video.publishedAt)),
        detailField("Locked", video.locked),
        detailField("No index", video.noIndex),
        detailField("AI metadata", video.aiMetadata),
      ]),
      timestamps: compactFields([
        detailField("Synced at", displayDateTime(video.syncedAt)),
        detailField("Created at", displayDateTime(video.createdAt)),
        detailField("Updated at", displayDateTime(video.updatedAt)),
      ]),
      localizedContent: detailSection({
        title: "Localized Content",
        count: localeCount,
        empty: "No localized metadata",
        items: video.locales.map((item) => ({
          key: item.id,
          title: compactText(item.title) ?? item.locale ?? item.id,
          meta: [
            item.locale,
            item.status,
            displayLanguage(item.language, locale),
            displayDateTime(item.publishedAt),
          ]
            .map((value) => compactText(value))
            .filter(Boolean)
            .join(" / "),
          detail: shortDetail(
            item.description ?? item.snippet ?? item.imageAlt,
          ),
        })),
      }),
      dubs: detailSection({
        title: "Dubs",
        count: dubCount,
        empty: "No dubs",
        items: video.dubs.map((dub) => {
          const languageChip = dubLanguageChip(dub)
          const streamUrl = externalHttpUrl(dub.hls ?? dub.dash ?? dub.share)

          return {
            key: dub.id,
            title: displayLanguage(dub.language, locale) ?? dub.slug ?? dub.id,
            meta: [
              dub.published ? "Published" : "Unpublished",
              dub.videoEdition?.name,
              formatDuration([dub]),
              dub.muxVideo?.playbackId ? "Mux playback" : null,
              dub.downloads.length > 0
                ? `${dub.downloads.length} downloads sampled`
                : null,
            ]
              .map((value) => compactText(value))
              .filter(Boolean)
              .join(" / "),
            detail: [dub.coreId, dub.slug, streamUrl]
              .map((value) => compactText(value))
              .filter(Boolean)
              .join(" / "),
            detailHref: streamUrl,
            flagUrl: languageChip?.flagUrl ?? null,
          }
        }),
      }),
      images: detailSection({
        title: "Images",
        count: imageCount,
        empty: "No images",
        items: video.images.map((image) => {
          const imageUrl = normalizeVideoThumbnailUrl(image.url)

          return {
            key: image.id,
            title: compactText(image.kind) ?? "Image",
            meta: [
              image.aspectRatio,
              image.width && image.height
                ? `${image.width}x${image.height}`
                : null,
            ]
              .map((value) => compactText(value))
              .filter(Boolean)
              .join(" / "),
            detail: imageUrl,
            imageUrl,
          }
        }),
      }),
      subtitles: detailSection({
        title: "Subtitles",
        count: subtitleCount,
        empty: "No subtitles",
        items: video.subtitles.map((subtitle) => ({
          key: subtitle.id,
          title:
            displayLanguage(subtitle.language, locale) ??
            subtitle.value ??
            subtitle.id,
          meta: [
            subtitle.videoEdition?.name,
            subtitle.primary ? "Primary" : null,
            subtitle.aiGenerated ? "AI generated" : null,
          ]
            .map((value) => compactText(value))
            .filter(Boolean)
            .join(" / "),
          detail: shortDetail(
            subtitle.vttSrc ?? subtitle.srtSrc ?? subtitle.value,
          ),
        })),
      }),
      studyQuestions: detailSection({
        title: "Study Questions",
        count: studyQuestionCount,
        empty: "No study questions",
        items: video.studyQuestions.map((question) => ({
          key: question.id,
          title: shortDetail(question.text, 96) ?? question.id,
          meta: [
            question.locale,
            displayLanguage(question.language, locale),
            question.primary ? "Primary" : null,
            question.order ? `Order ${question.order}` : null,
          ]
            .map((value) => compactText(value))
            .filter(Boolean)
            .join(" / "),
          detail: shortDetail(question.text),
        })),
      }),
      bibleCitations: detailSection({
        title: "Bible Citations",
        count: bibleCitationCount,
        empty: "No Bible citations",
        items: video.bibleCitations.map((citation) => {
          const book =
            localizedJsonName(citation.bibleBook.name, locale) ??
            citation.bibleBook.osisId ??
            "Bible"
          const range = [
            citation.chapterStart,
            citation.verseStart ? `:${citation.verseStart}` : null,
            citation.chapterEnd && citation.chapterEnd !== citation.chapterStart
              ? `-${citation.chapterEnd}`
              : null,
            citation.verseEnd ? `:${citation.verseEnd}` : null,
          ]
            .filter(Boolean)
            .join("")

          return {
            key: citation.id,
            title: `${book}${range ? ` ${range}` : ""}`,
            titleHref: bibleDotComHref({
              bookOsisId: citation.bibleBook.osisId,
              chapter: citation.chapterStart,
              verse: citation.verseStart,
            }),
            meta: [
              citation.osisId,
              citation.order ? `Order ${citation.order}` : null,
            ]
              .map((value) => compactText(value))
              .filter(Boolean)
              .join(" / "),
            detail: null,
          }
        }),
      }),
      keywords: detailSection({
        title: "Keywords",
        count: keywordCount,
        empty: "No keywords",
        items: video.keywords.map((item) => ({
          key: `${item.videoId}-${item.keywordId}`,
          title: item.keyword.value,
          meta:
            displayLanguage(item.keyword.language, locale) ??
            item.keyword.coreId,
          detail: null,
        })),
      }),
      parents: detailSection({
        title: "Parent Collections",
        count: parentCount,
        empty: "No parent collections",
        items: video.parents.map((relation) => ({
          key: relation.id,
          title: relationVideoTitle(relation.parent, locale),
          meta: [
            relation.parent.slug,
            localizedVideoLabel(relation.parent.label ?? null, locale),
          ]
            .map((value) => compactText(value))
            .filter(Boolean)
            .join(" / "),
          detail: relation.parent.coreId,
          href: videoLibraryHref({
            page: 1,
            collection:
              relation.parent.slug ??
              relation.parent.coreId ??
              relation.parent.id,
          }),
        })),
      }),
      children: detailSection({
        title: "Child Videos",
        count: childCount,
        empty: "No child videos",
        items: video.children.map((relation) => ({
          key: relation.id,
          title: relationVideoTitle(relation.child, locale),
          meta: [
            relation.child.slug,
            localizedVideoLabel(relation.child.label ?? null, locale),
            relation.order != null ? `Order ${relation.order}` : null,
          ]
            .map((value) => compactText(value))
            .filter(Boolean)
            .join(" / "),
          detail: relation.child.coreId,
        })),
      }),
      technical: detailSection({
        title: "Technical Summaries",
        count: sceneCount + transcriptCount,
        empty: "No scene or transcript summaries",
        items: [
          ...video.scenes.map((scene) => ({
            key: scene.id,
            title:
              compactText(scene.chapterTitle) ?? `Scene ${scene.sceneIndex}`,
            meta: [
              `${scene.startSeconds}s`,
              scene.endSeconds != null ? `${scene.endSeconds}s` : null,
            ]
              .map((value) => compactText(value))
              .filter(Boolean)
              .join(" / "),
            detail: null,
          })),
          ...video.transcripts.map((transcript) => ({
            key: transcript.id,
            title: `Transcript ${transcript.language}`,
            meta: [
              transcript.model,
              `${transcript.totalChunks.toLocaleString("en")} chunks`,
              `${transcript.totalTokens.toLocaleString("en")} tokens`,
              displayDateTime(transcript.generatedAt),
            ]
              .map((value) => compactText(value))
              .filter(Boolean)
              .join(" / "),
            detail: `${transcript.dimensions.toLocaleString("en")} dimensions`,
          })),
        ],
      }),
    }
  } catch (error) {
    if (isMissingTableError(error)) {
      return null
    }
    throw error
  }
}

async function loadVideoLibraryLanguageOptions(
  activeLanguage?: string,
): Promise<VideoLibraryLanguageOption[]> {
  const locale = await getAdminLocale()

  try {
    const dubs = await prisma.videoDub.findMany({
      where: {
        deletedAt: null,
        languageId: { not: null },
        language: { deletedAt: null },
        video: { deletedAt: null },
      },
      distinct: ["languageId"],
      orderBy: [{ languageId: "asc" }],
      take: VIDEO_LIBRARY_LANGUAGE_OPTION_LIMIT,
      select: {
        language: {
          select: {
            bcp47: true,
            id: true,
            iso3: true,
            name: true,
            slug: true,
          },
        },
      },
    })

    const optionsByValue = new Map<string, VideoLibraryLanguageOption>()
    for (const dub of dubs) {
      if (!dub.language) continue
      const value = languageOptionValue(dub.language)
      if (!value || optionsByValue.has(value)) continue
      optionsByValue.set(value, {
        label: languageOptionLabel(dub.language, locale),
        value,
      })
    }

    const normalizedActiveLanguage = compactText(activeLanguage)
    if (
      normalizedActiveLanguage &&
      !optionsByValue.has(normalizedActiveLanguage)
    ) {
      optionsByValue.set(normalizedActiveLanguage, {
        label: normalizedActiveLanguage,
        value: normalizedActiveLanguage,
      })
    }

    return Array.from(optionsByValue.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "en", { sensitivity: "base" }),
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }
}

async function loadLatestWatchRouteManifest() {
  try {
    return (
      (await new WatchRouteManifestStore(prisma).getLatest())?.payload ?? null
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      return null
    }
    throw error
  }
}

export async function loadExperienceRows(principal: Principal) {
  const services = createServices(prisma)
  const locale = await getAdminLocale()
  let experiences: Awaited<ReturnType<typeof services.experience.list>>
  try {
    experiences = await services.experience.list({
      input: { limit: 50, offset: 0, includeArchived: false },
      user: principal,
      query: {},
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const ids = experiences.map((item) => item.id)
  let locales: ExperienceLocaleRow[] = []
  try {
    locales = await prisma.experienceLocale.findMany({
      where: { experienceId: { in: ids } },
      select: {
        experienceId: true,
        locale: true,
        slug: true,
        pathSegment: true,
        title: true,
        ogImageUrl: true,
        blocks: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const localesByExperience = new Map<string, typeof locales>()
  for (const item of locales) {
    const current = localesByExperience.get(item.experienceId) ?? []
    current.push(item)
    localesByExperience.set(item.experienceId, current)
  }

  const videoIds = Array.from(
    new Set(
      locales.flatMap((item) =>
        videoIdsFromBlocks(parsedExperienceBlocks(item)),
      ),
    ),
  )
  let videoImages: VideoImageRow[] = []
  if (videoIds.length > 0) {
    try {
      videoImages = await prisma.videoImage.findMany({
        where: { videoId: { in: videoIds } },
        select: {
          videoId: true,
          url: true,
          kind: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    } catch (error) {
      if (isMissingTableError(error)) {
        videoImages = []
      } else {
        throw error
      }
    }
  }

  const videoImagesByVideoId = new Map<string, VideoImageRow[]>()
  for (const item of videoImages) {
    const current = videoImagesByVideoId.get(item.videoId) ?? []
    current.push(item)
    videoImagesByVideoId.set(item.videoId, current)
  }

  return experiences.map((experience) => {
    const experienceLocales = localesByExperience.get(experience.id) ?? []
    const localeRow = choosePreferredLocale(experienceLocales, locale)
    const title = localeRow?.title?.trim() || "Untitled Experience"
    const path = localeRow
      ? experiencePath(localeRow)
      : `/${normalizePathPart(experience.id)}`
    const status = localeRow?.status ?? "DRAFT"
    const preview = localeRow
      ? previewForExperienceLocale(localeRow, videoImagesByVideoId)
      : {
          imageUrl: null,
        }

    return {
      key: experience.id,
      locale: localeRow?.locale ?? locale,
      title,
      slug: path,
      statusLabel: status,
      statusTone: statusTone(status),
      preview,
    }
  })
}

async function loadVideoRowSlice({
  category,
  collection,
  language,
  preferredLocale,
  principal,
  limit,
  offset,
  search,
  sort,
  includeVisitorUrls = false,
  videoIds,
}: LoadVideoRowSliceOptions) {
  const services = createServices(prisma)
  const locale = compactText(preferredLocale) ?? (await getAdminLocale())
  // The downstream locale/dub/image mapping reads only these scalar
  // fields off each video row. Typing `videos` to exactly that subset
  // (Pick'd off the service-list row) lets the `videoIds` top-up branch
  // use an honest `select` of the same fields — no `as typeof videos`
  // cast — while the full-row `services.video.list()` result stays
  // structurally assignable.
  type VideoRowForSlice = Pick<
    Awaited<ReturnType<typeof services.video.list>>[number],
    "id" | "coreId" | "slug" | "label" | "videoSource" | "updatedAt"
  >
  let videos: VideoRowForSlice[]
  try {
    // U2: VideoService.list dropped its `user` param. Route is gated by requireSession().
    void principal
    if (videoIds && videoIds.length > 0) {
      // Targeted fetch for the experience editor's AI-referenced videos.
      // Raw rows feed the same locale/dub/image mapping below, which reads
      // only these scalar fields — so select exactly them rather than
      // casting a default-shape findMany onto the service-list row type.
      // Intentional visibility bypass: this top-up path returns
      // AI-referenced videos regardless of the list-visibility gating
      // VideoService.list applies, so an AI-referenced id outside the
      // first library page still resolves.
      videos = await prisma.video.findMany({
        where: { id: { in: [...videoIds] }, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          coreId: true,
          slug: true,
          label: true,
          videoSource: true,
          updatedAt: true,
        },
      })
    } else {
      videos = await services.video.list({
        input: { category, collection, language, limit, offset, search, sort },
        query: {},
      })
    }
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  if (videos.length === 0) {
    return []
  }

  const ids = videos.map((item) => item.id)
  const routeManifestPromise = includeVisitorUrls
    ? loadLatestWatchRouteManifest()
    : Promise.resolve(null)
  let videoLocales: VideoLocaleRow[] = []
  let videoDubs: VideoDubRow[] = []
  let videoImages: VideoImageRow[] = []
  let videoChildRelations: Array<{
    parentId: string
    childId: string
    order: number | null
    createdAt: Date
  }> = []
  let groundingStudyQuestions: Array<{ videoId: string }> = []
  let groundingBibleCitations: Array<{ videoId: string }> = []
  let routeManifest: Awaited<ReturnType<typeof loadLatestWatchRouteManifest>> =
    null
  try {
    ;[
      videoLocales,
      videoDubs,
      videoImages,
      videoChildRelations,
      groundingStudyQuestions,
      groundingBibleCitations,
      routeManifest,
    ] = await Promise.all([
      prisma.videoLocale.findMany({
        where: { videoId: { in: ids }, deletedAt: null },
        select: {
          videoId: true,
          locale: true,
          title: true,
          description: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.videoDub.findMany({
        where: { videoId: { in: ids }, deletedAt: null },
        include: {
          language: {
            select: {
              bcp47: true,
              countryLanguages: {
                where: { deletedAt: null },
                select: {
                  order: true,
                  primary: true,
                  speakers: true,
                  suggested: true,
                  country: {
                    select: {
                      flagPngSrc: true,
                      flagWebpSrc: true,
                    },
                  },
                },
              },
              id: true,
              iso3: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.videoImage.findMany({
        where: { videoId: { in: ids } },
        select: {
          videoId: true,
          url: true,
          kind: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.videoRelation.findMany({
        where: {
          parentId: { in: ids },
          child: { deletedAt: null },
        },
        select: {
          parentId: true,
          childId: true,
          order: true,
          createdAt: true,
        },
        orderBy: [{ parentId: "asc" }, { order: "asc" }, { createdAt: "asc" }],
      }),
      // Grounding signal: videos with ≥1 non-empty study question. Batched +
      // distinct so the library list stays one query per relation regardless
      // of catalogue size — no per-video content load.
      prisma.videoStudyQuestion.findMany({
        where: { videoId: { in: ids }, deletedAt: null, text: { not: "" } },
        select: { videoId: true },
        distinct: ["videoId"],
      }),
      // Grounding signal: videos with ≥1 non-deleted Bible citation.
      prisma.bibleCitation.findMany({
        where: { videoId: { in: ids }, deletedAt: null },
        select: { videoId: true },
        distinct: ["videoId"],
      }),
      routeManifestPromise,
    ])
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const publicVideoLocales = videoLocales.filter(
    (item): item is VideoLocaleRow & { locale: string } => item.locale != null,
  )
  const localesByVideo = new Map<string, typeof publicVideoLocales>()
  for (const item of publicVideoLocales) {
    const current = localesByVideo.get(item.videoId) ?? []
    current.push(item)
    localesByVideo.set(item.videoId, current)
  }

  const dubsByVideo = new Map<string, VideoDubRow[]>()
  for (const item of videoDubs) {
    const current = dubsByVideo.get(item.videoId) ?? []
    current.push(item)
    dubsByVideo.set(item.videoId, current)
  }

  const imagesByVideo = new Map<string, VideoImageRow[]>()
  for (const item of videoImages) {
    const current = imagesByVideo.get(item.videoId) ?? []
    current.push(item)
    imagesByVideo.set(item.videoId, current)
  }

  const childCountByVideo = new Map<string, number>()
  for (const item of videoChildRelations) {
    childCountByVideo.set(
      item.parentId,
      (childCountByVideo.get(item.parentId) ?? 0) + 1,
    )
  }

  const childPreviewIdsByVideo = new Map<string, string[]>()
  for (const item of [...videoChildRelations].sort((left, right) => {
    if (left.parentId !== right.parentId) {
      return left.parentId.localeCompare(right.parentId)
    }
    return compareCollectionChildRelations(left, right)
  })) {
    const current = childPreviewIdsByVideo.get(item.parentId) ?? []
    if (current.length >= 3) continue
    current.push(item.childId)
    childPreviewIdsByVideo.set(item.parentId, current)
  }

  const childPreviewVideoIds = Array.from(
    new Set(Array.from(childPreviewIdsByVideo.values()).flat()),
  )
  const [childPreviewLocales, childPreviewImages] =
    childPreviewVideoIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.videoLocale.findMany({
            where: {
              videoId: { in: childPreviewVideoIds },
              deletedAt: null,
            },
            select: {
              videoId: true,
              locale: true,
              title: true,
              description: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
          }),
          prisma.videoImage.findMany({
            where: { videoId: { in: childPreviewVideoIds } },
            select: {
              videoId: true,
              url: true,
              kind: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          }),
        ])

  const publicChildPreviewLocales = childPreviewLocales.filter(
    (item): item is VideoLocaleRow & { locale: string } => item.locale != null,
  )
  const childPreviewLocalesByVideo = new Map<
    string,
    typeof publicChildPreviewLocales
  >()
  for (const item of publicChildPreviewLocales) {
    const current = childPreviewLocalesByVideo.get(item.videoId) ?? []
    current.push(item)
    childPreviewLocalesByVideo.set(item.videoId, current)
  }

  const childPreviewImagesByVideo = new Map<string, VideoImageRow[]>()
  for (const item of childPreviewImages) {
    const current = childPreviewImagesByVideo.get(item.videoId) ?? []
    current.push(item)
    childPreviewImagesByVideo.set(item.videoId, current)
  }

  const groundedIds = new Set<string>()
  for (const item of groundingStudyQuestions) groundedIds.add(item.videoId)
  for (const item of groundingBibleCitations) groundedIds.add(item.videoId)

  return videos.map((video) => {
    const localeRows = localesByVideo.get(video.id) ?? []
    const dubRows = dubsByVideo.get(video.id) ?? []
    const imageRows = imagesByVideo.get(video.id) ?? []
    const localeRow = choosePreferredLocale(localeRows, locale)
    const title = localeRow?.title?.trim() || video.slug
    const source = sourceLabel(video.videoSource)
    const playbackDub = preferredPickerDub(dubRows, locale)
    const playableDubs = playableDubsForPicker(dubRows, locale)
    const coverage = dubCoverageMetric(dubRows)
    const childCount = childCountByVideo.get(video.id) ?? 0
    const collectionPreviewItems = (
      childPreviewIdsByVideo.get(video.id) ?? []
    ).map((childId) => {
      const childLocaleRows = childPreviewLocalesByVideo.get(childId) ?? []
      const childLocaleRow = choosePreferredLocale(childLocaleRows, locale)
      return {
        key: childId,
        title: childLocaleRow?.title?.trim() || "Untitled video",
        previewImageUrl: preferredVideoImage(
          childPreviewImagesByVideo.get(childId) ?? [],
        ),
      }
    })

    return {
      key: video.id,
      title,
      description: localeRow?.description?.trim() || null,
      id: video.coreId,
      slug: video.slug,
      label: video.label ?? null,
      labelLabel: localizedVideoLabel(video.label ?? null, locale),
      childCount,
      isCollectionTarget:
        video.label === "COLLECTION" ||
        (video.label === "SERIES" && childCount > 0),
      sourceLabel: source.label,
      sourceTone: source.tone,
      dubs: dubCoverage(dubRows),
      ...coverage,
      updated: formatDateTime(video.updatedAt),
      updatedAtIso: video.updatedAt.toISOString(),
      updatedRelative: formatVideoUpdatedRelative(video.updatedAt),
      updatedDateShort: formatShortDate(video.updatedAt),
      duration: formatDuration(dubRows),
      durationSeconds: playbackDub ? durationSecondsForDub(playbackDub) : null,
      previewImageUrl: preferredVideoImage(imageRows),
      previewStreamUrl:
        playbackDub?.hls ?? playbackDub?.dash ?? playbackDub?.share ?? null,
      playableDubs,
      hasGrounding: groundedIds.has(video.id),
      collectionPreviewItems,
      visitorUrl: includeVisitorUrls
        ? resolveVideoVisitorUrl({
            contentSlug: video.slug,
            languageSlugs: dubRows.map((dub) => dub.language?.slug),
            manifest: routeManifest,
            webOrigin: env.WEB_CANONICAL_ORIGIN,
          })
        : null,
    }
  })
}

export async function loadVideoRows(
  principal: Principal,
  options: {
    category?: VideoLibraryCategory
    includeVideoIds?: readonly string[]
    preferredLocale?: string
  } = {},
) {
  const rows = await loadVideoRowSlice({
    category: options.category,
    principal,
    limit: VIDEO_LIBRARY_PAGE_SIZE,
    offset: 0,
    preferredLocale: options.preferredLocale,
  })
  const have = new Set(rows.map((row) => row.key))
  const missing = Array.from(new Set(options.includeVideoIds ?? [])).filter(
    (id) => id && !have.has(id),
  )
  if (missing.length === 0) return rows
  // Top-up with AI-referenced videos outside the first library page
  // (experience-AI chat; additive).
  const extras = await loadVideoRowSlice({
    category: options.category,
    principal,
    limit: missing.length,
    offset: 0,
    preferredLocale: options.preferredLocale,
    videoIds: missing,
  })
  return [...rows, ...extras]
}

type CollectionChildRelation = {
  childId: string
  order: number | null
  createdAt: Date
}

function compareCollectionChildRelations(
  left: CollectionChildRelation,
  right: CollectionChildRelation,
) {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER
  if (leftOrder !== rightOrder) return leftOrder - rightOrder
  return left.createdAt.getTime() - right.createdAt.getTime()
}

export async function loadVideoCollectionChildren(
  principal: Principal,
  parentVideoId: string,
  options: { preferredLocale?: string } = {},
) {
  const relations = await prisma.videoRelation.findMany({
    where: { parentId: parentVideoId, child: { deletedAt: null } },
    select: { childId: true, order: true, createdAt: true },
  })
  const childIds = relations
    .sort(compareCollectionChildRelations)
    .map((relation) => relation.childId)
  if (childIds.length === 0) return []

  const rows = await loadVideoRowSlice({
    principal,
    limit: childIds.length,
    offset: 0,
    preferredLocale: options.preferredLocale,
    videoIds: childIds,
  })
  const rowsById = new Map(rows.map((row) => [row.key, row]))
  return childIds.flatMap((childId) => {
    const row = rowsById.get(childId)
    return row ? [row] : []
  })
}

export async function loadVideoLibraryPage(
  principal: Principal,
  {
    category,
    collection,
    language,
    page,
    pageSize = VIDEO_LIBRARY_PAGE_SIZE,
    query,
    sort,
  }: {
    category?: VideoLibraryCategory
    collection?: string
    language?: string
    page: number
    pageSize?: number
    query?: string
    sort?: VideoLibrarySort
  },
) {
  const totalPromise = countActiveVideos({
    category,
    collection,
    language,
    query,
  })
  const languageOptionsPromise = loadVideoLibraryLanguageOptions(language)
  const collectionSummaryPromise = loadVideoCollectionSummary(collection)
  const total = await totalPromise
  const pagination = createVideoLibraryPagination({
    total,
    requestedPage: page,
    pageSize,
  })

  const rowsPromise =
    total === 0
      ? Promise.resolve([])
      : loadVideoRowSlice({
          category,
          collection,
          language,
          principal,
          limit: pagination.pageSize,
          offset: pagination.offset,
          search: query,
          sort,
          includeVisitorUrls: true,
        })
  const [rows, languageOptions, collectionSummary] = await Promise.all([
    rowsPromise,
    languageOptionsPromise,
    collectionSummaryPromise,
  ])

  return { rows, pagination, languageOptions, collectionSummary }
}
