// SYNC: ported from apps/mobile/src/lib/normalizeVideo.ts
//
// Normalizes the raw videoBySlug payload into a TV consumer record. Memoized on
// the raw object reference (WeakMap) so re-entering a video (cache-first) reuses
// the prior record instead of re-walking thousands of dubs. Siblings are derived
// defensively (self-filter + dedupe) so the Up Next rail is correct the moment
// the inverted admin Video.parents/children relation is fixed — see KTD5.

import type { WatchVideoData, WatchDubData } from "./videoQueries"
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
      }[]
    | null
    | undefined,
): {
  title: string | null
  description: string | null
  snippet: string | null
} {
  if (!locales || locales.length === 0)
    return { title: null, description: null, snippet: null }
  const loc = [...locales].sort((a, b) => {
    const bySlug = compareLanguageSlug(a.languageSlug, b.languageSlug)
    if (bySlug !== 0) return bySlug
    return (a.documentId ?? "").localeCompare(b.documentId ?? "")
  })[0]
  return {
    title: loc.title ?? null,
    description: loc.description ?? null,
    snippet: loc.snippet ?? null,
  }
}

type RawVariant = NonNullable<RawVideo["variants"]>[number]

function pickFirstPlayableVariant(
  variants: RawVideo["variants"] | undefined | null,
): RawVariant | null {
  if (!variants) return null
  return (
    variants.find(
      (v) => v.published === true && v.hls != null && v.hls !== "",
    ) ?? null
  )
}

// Native-language display name for a language, or null when it would just echo
// the English name (no distinct native form) or the language IS English. `name`
// is admin's jsonb locale map; `bcp47` selects the locale. Shared by audio
// variants and subtitle tracks so both render the same "English · Native" pair.
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

// Map one lazily-fetched dub's downloads + subtitles. Same projection the bulk
// query used to inline per dub, now run once for the active language only. A
// missing dub (or one with no media) yields empty arrays = "loaded, nothing".
// Returns a fresh object each call so callers can never mutate a shared empty.
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

// Memoize by the raw object reference. Apollo returns a referentially-stable
// result for an unchanged cache read, so re-entering a video (cache-first) maps
// to the same `raw` and reuses the prior record instead of re-walking every dub
// — a video like birth-of-jesus has 2,259 dubs, so re-normalizing on each mount
// is a multi-second JS-thread freeze. A WeakMap can't leak: entries die with the
// cached object. New/changed data is a new reference, so this never serves stale.
const normalizeCache = new WeakMap<object, WatchVideoRecord | null>()

export function normalizeVideo(
  raw: RawVideo | null | undefined,
): WatchVideoRecord | null {
  if (raw == null) return null
  // With returnPartialData, the cache can surface a partial Video object before
  // the network fills it in. Without an identity there's nothing usable to
  // publish (the session keys on documentId), so treat identity-less partials
  // as "not ready" and let the seed/skeleton carry the screen.
  if (!raw.documentId) return null

  const cached = normalizeCache.get(raw)
  if (cached !== undefined) return cached
  const result = buildWatchVideoRecord(raw)
  normalizeCache.set(raw, result)
  return result
}

function buildWatchVideoRecord(raw: RawVideo): WatchVideoRecord {
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

  // Siblings: parents[0].parent.children, minus self (KTD5 — the inverted
  // admin relation returns only self-references today, so this yields an EMPTY
  // list on current main; the self-filter + dedupe make the rail correct the
  // moment the relation is fixed, with no further change here).
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
