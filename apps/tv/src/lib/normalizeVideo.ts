// SYNC: ported from apps/mobile/src/lib/normalizeVideo.ts. Normalizes videoBySlug into a
// TV consumer record, WeakMap-memoized on the raw ref so cache-first re-entry skips re-walking
// thousands of dubs. Siblings self-filtered + deduped, correct once KTD5's inverted admin relation is fixed.

import type {
  WatchVideoData,
  WatchDubData,
  SeriesVideoData,
} from "./videoQueries"
import { pickLocalizedName } from "./pickLocalizedName"

// ── Consumer types ─────────────────────────────────────────────────

export type WatchDownload = {
  documentId: string
  quality: string
  size: string
  url: string
}

export type WatchSubtitle = {
  documentId: string
  languageSlug: string
  languageName: string
  languageNameNative: string | null
  languageBcp47: string
  vttSrc: string
  primary: boolean
  aiGenerated: boolean
}

export type WatchVariant = {
  documentId: string
  slug: string
  published: boolean
  hls: string | null
  duration: number | null
  languageCoreId: string | null
  languageBcp47: string | null
  languageSlug: string | null
  languageName: string | null
  languageNameNative: string | null
  muxPlaybackId: string | null
}

// A single dub's downloads + subtitles, fetched lazily (GET_VIDEO_DUB) for the
// active language only. Kept off WatchVariant because the bulk query no longer
// projects it — see normalizeDubMedia + WatchSessionProvider.activeVariantMedia.
export type VariantMedia = {
  downloads: WatchDownload[]
  subtitles: WatchSubtitle[]
}

export type WatchSibling = {
  documentId: string
  slug: string
  label: string | null
  title: string | null
  posterUrl: string | null
}

// A child video of a series, rendered as a card in the episode rail — a
// sibling-shaped card plus the locale text the 10-foot UI can surface on focus.
export type WatchEpisode = WatchSibling & {
  description: string | null
  imageAlt: string | null
}

// One language the series' episodes are available in (server-aggregated union),
// the feed for the series language panel. Identity is the unique `slug`, never
// bcp47 — `ko` collides with `ko-kmr`.
export type WatchChildLanguage = {
  slug: string
  name: string | null
  bcp47: string | null
}

export type WatchStudyQuestion = {
  documentId: string
  value: string
  order: number
}

export type WatchBibleCitation = {
  documentId: string
  osisId: string | null
  bookName: string | null
  chapterStart: number | null
  chapterEnd: number | null
  verseStart: number | null
  verseEnd: number | null
  order: number | null
}

export type WatchVideoRecord = {
  documentId: string
  slug: string
  label: string | null
  title: string | null
  description: string | null
  snippet: string | null
  posterUrl: string | null
  streamingUrl: string | null
  muxPlaybackId: string | null
  duration: number | null
  primaryLanguageBcp47: string | null
  siblings: WatchSibling[]
  variants: WatchVariant[]
  studyQuestions: WatchStudyQuestion[]
  bibleCitations: WatchBibleCitation[]
}

// Series screen's record: shared video record (trailer = series' own playable dub
// as streamingUrl/variants) plus episode rail and language union. Produced only by
// normalizeSeries so the base record stays untouched for WatchSessionProvider/watch screen.
export type WatchSeriesRecord = WatchVideoRecord & {
  episodes: WatchEpisode[]
  languages: WatchChildLanguage[]
}

// ── Helpers ────────────────────────────────────────────────────────

type RawVideo = NonNullable<WatchVideoData["videoBySlug"]>

type RawImage = {
  url?: string | null
  thumbnail?: string | null
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
}

function pickPosterUrl(
  images: readonly RawImage[] | undefined | null,
): string | null {
  if (!images || images.length === 0) return null
  const img = images[0]
  return img.mobileCinematicHigh ?? img.url ?? img.thumbnail ?? null
}

function compareLanguageSlug(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const byPresence = left == null ? (right == null ? 0 : 1) : -1
  if (byPresence !== 0) return byPresence
  return (left ?? "").localeCompare(right ?? "")
}

function pickFirstLocale(
  locales:
    | readonly {
        documentId?: string | null
        languageSlug?: string | null
        title?: string | null
        description?: string | null
        snippet?: string | null
        imageAlt?: string | null
      }[]
    | null
    | undefined,
): {
  title: string | null
  description: string | null
  snippet: string | null
  imageAlt: string | null
} {
  if (!locales || locales.length === 0)
    return { title: null, description: null, snippet: null, imageAlt: null }
  const loc = [...locales].sort((a, b) => {
    const bySlug = compareLanguageSlug(a.languageSlug, b.languageSlug)
    if (bySlug !== 0) return bySlug
    return (a.documentId ?? "").localeCompare(b.documentId ?? "")
  })[0]
  return {
    title: loc.title ?? null,
    description: loc.description ?? null,
    snippet: loc.snippet ?? null,
    imageAlt: loc.imageAlt ?? null,
  }
}

type RawVariant = NonNullable<RawVideo["variants"]>[number]

// The series query (SeriesWatchVideo) is leaner than the watch query: no `parents`
// chain, dubs omit player-only `duration`/`muxVideo`. These permissive aliases let the
// shared builder accept both shapes without loosening either operation's generated type.
type NormalizableVariant = Omit<RawVariant, "duration" | "muxVideo"> &
  Partial<Pick<RawVariant, "duration" | "muxVideo">>

type NormalizableVideo = Omit<RawVideo, "parents" | "variants"> & {
  parents?: RawVideo["parents"]
  variants?: readonly NormalizableVariant[] | null
}

function pickFirstPlayableVariant(
  variants: readonly NormalizableVariant[] | undefined | null,
): NormalizableVariant | null {
  if (!variants) return null
  return (
    variants.find(
      (v) => v.published === true && v.hls != null && v.hls !== "",
    ) ?? null
  )
}

// Native display name, or null when it echoes English or the language IS English.
// `name` is admin's jsonb locale map, `bcp47` selects the locale. Shared by audio
// variants and subtitles so both render the same "English · Native" pair.
function pickNativeName(
  name: unknown,
  bcp47: string | null | undefined,
): string | null {
  if (name == null || !bcp47) return null
  const locale = bcp47.split("-")[0]
  if (locale === "en") return null
  const native = pickLocalizedName(name, locale)
  const english = pickLocalizedName(name, "en")
  return native && native !== english ? native : null
}

function dedupeByDocumentId<T extends { documentId: string | null }>(
  items: T[],
): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (item.documentId == null) return false
    if (seen.has(item.documentId)) return false
    seen.add(item.documentId)
    return true
  })
}

// ── Per-dub media (lazy path) ──────────────────────────────────────

type RawDub = NonNullable<WatchDubData["videoDub"]>

// Map one lazily-fetched dub's downloads + subtitles (same projection the bulk
// query inlined, now run once for the active language). Missing/empty dub yields
// empty arrays = "loaded, nothing"; fresh object each call so callers can't mutate a shared empty.
export function normalizeDubMedia(
  raw: RawDub | null | undefined,
): VariantMedia {
  if (raw == null) return { downloads: [], subtitles: [] }
  return {
    downloads: (raw.downloads ?? [])
      .filter(
        (d): d is typeof d & { quality: string; url: string } =>
          d.quality != null && d.url != null,
      )
      .map((d) => ({
        documentId: d.documentId ?? "",
        quality: d.quality,
        size: d.size ?? "0",
        url: d.url,
      })),
    subtitles: (raw.videoEdition?.subtitles ?? [])
      .filter((s) => s.vttSrc != null && s.language != null)
      .map((s) => ({
        documentId: s.documentId ?? "",
        languageSlug: s.language?.slug ?? "",
        languageName: s.language?.name
          ? (pickLocalizedName(s.language.name) ?? "")
          : "",
        languageNameNative: pickNativeName(s.language?.name, s.language?.bcp47),
        languageBcp47: s.language?.bcp47 ?? "",
        vttSrc: s.vttSrc ?? "",
        primary: s.primary ?? false,
        aiGenerated: s.aiGenerated ?? false,
      })),
  }
}

// ── Normalizer ─────────────────────────────────────────────────────

// Memoize by raw object reference: Apollo returns a stable ref for unchanged cache
// reads, so re-entry reuses the prior record instead of re-walking every dub (birth-of-jesus
// has 2,259 — a multi-second freeze). WeakMap can't leak; new data is a new ref, never stale.
const normalizeCache = new WeakMap<object, WatchVideoRecord | null>()

export function normalizeVideo(
  raw: RawVideo | null | undefined,
): WatchVideoRecord | null {
  if (raw == null) return null
  // returnPartialData can surface a partial Video before the network fills it in.
  // The session keys on documentId, so treat identity-less partials as "not ready"
  // and let the seed/skeleton carry the screen.
  if (!raw.documentId) return null

  const cached = normalizeCache.get(raw)
  if (cached !== undefined) return cached
  const result = buildWatchVideoRecord(raw)
  normalizeCache.set(raw, result)
  return result
}

function buildWatchVideoRecord(raw: NormalizableVideo): WatchVideoRecord {
  const locale = pickFirstLocale(raw.locales)
  const firstPlayable = pickFirstPlayableVariant(raw.variants)

  const variants: WatchVariant[] = (raw.variants ?? [])
    .filter((v) => v.published === true)
    .map((v) => ({
      documentId: v.documentId ?? "",
      slug: v.slug ?? "",
      published: v.published ?? false,
      hls: v.hls ?? null,
      duration: v.duration ?? null,
      languageCoreId: v.language?.coreId ?? null,
      languageBcp47: v.language?.bcp47 ?? null,
      languageSlug: v.language?.slug ?? null,
      languageName: v.language?.name
        ? (pickLocalizedName(v.language.name) ?? null)
        : null,
      languageNameNative: pickNativeName(v.language?.name, v.language?.bcp47),
      muxPlaybackId: v.muxVideo?.playbackId ?? null,
    }))

  // Siblings: parents[0].parent.children minus self. KTD5: the inverted admin
  // relation returns only self-references today (EMPTY list on main); self-filter
  // + dedupe make the rail correct the moment it's fixed, no further change here.
  const selfId = raw.documentId
  const rawSiblings =
    raw.parents?.[0]?.parent?.children
      ?.map((rel) => rel.child)
      .filter(
        (child): child is NonNullable<typeof child> =>
          child != null && child.documentId !== selfId,
      )
      .map((child) => ({
        documentId: child.documentId ?? "",
        slug: child.slug ?? "",
        label: child.label ?? null,
        title: pickFirstLocale(child.locales).title,
        posterUrl: pickPosterUrl(child.images),
      })) ?? []
  const siblings = dedupeByDocumentId(rawSiblings)

  const studyQuestions: WatchStudyQuestion[] = (raw.studyQuestions ?? [])
    .filter((q) => q.value != null && q.value !== "")
    .sort((a, b) => {
      const byOrder = (a.order ?? 0) - (b.order ?? 0)
      if (byOrder !== 0) return byOrder
      const bySlug = compareLanguageSlug(a.languageSlug, b.languageSlug)
      if (bySlug !== 0) return bySlug
      return (a.documentId ?? "").localeCompare(b.documentId ?? "")
    })
    .map((q) => ({
      documentId: q.documentId ?? "",
      value: q.value ?? "",
      order: q.order ?? 0,
    }))

  const bibleCitations: WatchBibleCitation[] = (raw.bibleCitations ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => ({
      documentId: c.documentId ?? "",
      osisId: c.osisId ?? null,
      bookName: c.bibleBook?.name
        ? (pickLocalizedName(c.bibleBook.name) ?? null)
        : null,
      chapterStart: c.chapterStart ?? null,
      chapterEnd: c.chapterEnd ?? null,
      verseStart: c.verseStart ?? null,
      verseEnd: c.verseEnd ?? null,
      order: c.order ?? null,
    }))

  return {
    documentId: raw.documentId ?? "",
    slug: raw.slug ?? "",
    label: raw.label ?? null,
    title: locale.title,
    description: locale.description,
    snippet: locale.snippet,
    posterUrl: pickPosterUrl(raw.images),
    streamingUrl: firstPlayable?.hls ?? null,
    muxPlaybackId: firstPlayable?.muxVideo?.playbackId ?? null,
    duration: firstPlayable?.duration ?? null,
    primaryLanguageBcp47: raw.primaryLanguage?.bcp47 ?? null,
    siblings,
    variants,
    studyQuestions,
    bibleCitations,
  }
}

// ── Series normalizer ──────────────────────────────────────────────

type RawSeriesVideo = NonNullable<SeriesVideoData["videoBySlug"]>

// Own-children → episode cards. KTD5-tolerant: the inverted admin relation can
// surface self-references and duplicates today, so this self-filters, dedupes,
// and yields [] rather than a broken rail — correct the moment it's fixed.
function buildEpisodes(raw: RawSeriesVideo): WatchEpisode[] {
  const selfId = raw.documentId
  const episodes = (raw.children ?? [])
    .filter(
      (rel): rel is typeof rel & { child: NonNullable<typeof rel.child> } =>
        rel.child != null && rel.child.documentId !== selfId,
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((rel) => {
      const locale = pickFirstLocale(rel.child.locales)
      return {
        documentId: rel.child.documentId ?? "",
        slug: rel.child.slug ?? "",
        label: rel.child.label ?? null,
        title: locale.title,
        description: locale.description,
        imageAlt: locale.imageAlt,
        posterUrl: pickPosterUrl(rel.child.images),
      }
    })
  return dedupeByDocumentId(episodes)
}

// Language union, keyed on the unique slug (never bcp47 — ko/ko-kmr collide).
function buildLanguages(raw: RawSeriesVideo): WatchChildLanguage[] {
  const seen = new Set<string>()
  const languages: WatchChildLanguage[] = []
  for (const lang of raw.childDubLanguages ?? []) {
    const slug = lang.slug
    if (slug == null || slug === "" || seen.has(slug)) continue
    seen.add(slug)
    languages.push({
      slug,
      name: lang.name ? (pickLocalizedName(lang.name) ?? null) : null,
      bcp47: lang.bcp47 ?? null,
    })
  }
  return languages
}

// Memoize on the raw reference like normalizeVideo, so a cache-first re-entry
// doesn't re-walk children/languages.
const normalizeSeriesCache = new WeakMap<object, WatchSeriesRecord | null>()

// Normalize a series Video: the shared video record (trailer = the series' own
// playable dub, exposed as streamingUrl/variants) plus the series-only episode
// rail and the language union that feeds the language panel.
export function normalizeSeries(
  raw: RawSeriesVideo | null | undefined,
): WatchSeriesRecord | null {
  if (raw == null || !raw.documentId) return null
  const cached = normalizeSeriesCache.get(raw)
  if (cached !== undefined) return cached
  // RawSeriesVideo is the lean SeriesWatchVideo subset of WatchVideo (no parents
  // chain; per-dub duration/muxVideo dropped). The builder accepts it via
  // NormalizableVideo; dropped fields resolve to siblings=[]/duration=null/muxPlaybackId=null (unused here).
  const result: WatchSeriesRecord = {
    ...buildWatchVideoRecord(raw),
    episodes: buildEpisodes(raw),
    languages: buildLanguages(raw),
  }
  normalizeSeriesCache.set(raw, result)
  return result
}
