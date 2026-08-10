import type { WatchVideoData, WatchDubData, SeriesVideoData } from "./queries"
import { resolveVideoDisplayTitle } from "@forge/content-display"
import { isEpisodicSeriesLabel } from "./isSeriesRecord"
import { pickCardImage } from "./cardImage"
import { pickLocalizedName } from "./pickLocalizedName"
import { cleanStreamUrl } from "./validateUrl"

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

// A child video of a series, rendered as a card in the episode grid. Same shape
// as a sibling plus the series-only ordering/duration a download record needs
// (kept off WatchSibling — a plain sibling isn't part of a downloadable series).
export type WatchEpisode = WatchSibling & {
  /** Episode order within the series (admin's `order` relation field). */
  seriesEpisodeIndex?: number
  /** Video runtime in seconds. */
  durationSeconds?: number
}

// One language the series' episodes are available in (server-aggregated union),
// the feed for the series language sheet. Identity is the unique `slug`, never
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
  /** The SERIES-labelled parent this video is an episode of; null for a standalone
   *  video, a COLLECTION member, or an orphan. */
  parentSeries: { documentId: string; slug: string; title: string } | null
  siblings: WatchSibling[]
  variants: WatchVariant[]
  studyQuestions: WatchStudyQuestion[]
  bibleCitations: WatchBibleCitation[]
  // Series-only: empty for a single video; populated by normalizeSeries.
  episodes: WatchEpisode[]
  languages: WatchChildLanguage[]
}

// ── Helpers ────────────────────────────────────────────────────────

type RawVideo = NonNullable<WatchVideoData["videoBySlug"]>

// Every watch surface (player poster, Up Next card, episode card) is 16:9, so a
// videoStill is a valid fallback — hence the "card" intent, not "poster".
function pickPosterUrl(
  images: RawVideo["images"] | undefined | null,
): string | null {
  return pickCardImage(images, "card")
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

function videoDisplayTitleCandidates(video: {
  locales?:
    | readonly {
        documentId?: string | null
        languageSlug?: string | null
        title?: string | null
      }[]
    | null
  englishTitleLocales?: readonly { title?: string | null }[] | null
  englishLanguageTitleLocales?: readonly { title?: string | null }[] | null
}) {
  return {
    requestedTitles: [...(video.locales ?? [])]
      .sort((left, right) => {
        const bySlug = compareLanguageSlug(
          left.languageSlug,
          right.languageSlug,
        )
        return (
          bySlug ||
          (left.documentId ?? "").localeCompare(right.documentId ?? "")
        )
      })
      .map((row) => row.title),
    englishTitles: [
      ...(video.englishTitleLocales?.map((row) => row.title) ?? []),
      ...(video.englishLanguageTitleLocales?.map((row) => row.title) ?? []),
    ],
  }
}

type RawVariant = NonNullable<RawVideo["variants"]>[number]

// Permissive aliases let the shared builder accept BOTH the full watch fragment
// and the lean series shape (no `parents` chain; dubs omit `duration`/`muxVideo`)
// without loosening either operation's own generated type.
type NormalizableVariant = Omit<RawVariant, "duration" | "muxVideo"> &
  Partial<Pick<RawVariant, "duration" | "muxVideo">>

type NormalizableVideo = Omit<RawVideo, "parents" | "variants"> & {
  parents?: RawVideo["parents"]
  variants?: readonly NormalizableVariant[] | null
}

// Prod data can carry stray whitespace on hls (a dub shipped "…m3u8\n"); the
// native player requests the string raw → Mux 400. Ingest cleaned, never raw.
function pickFirstPlayableVariant(
  variants: readonly NormalizableVariant[] | undefined | null,
): NormalizableVariant | null {
  if (!variants) return null
  return (
    variants.find(
      (v) => v.published === true && cleanStreamUrl(v.hls) != null,
    ) ?? null
  )
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
// query inlined, now per active language). Missing dub/media → empty arrays =
// "loaded, nothing". Returns a fresh object so callers can't mutate a shared empty.
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
        languageBcp47: s.language?.bcp47 ?? "",
        vttSrc: s.vttSrc ?? "",
        primary: s.primary ?? false,
        aiGenerated: s.aiGenerated ?? false,
      })),
  }
}

// ── Normalizer ─────────────────────────────────────────────────────

// Memoize by raw object reference: Apollo's stable cache reads let re-entry reuse
// the prior record vs re-walking every dub (birth-of-jesus = 2,259 dubs =
// multi-second freeze). WeakMap can't serve stale: new data is a new reference.
const normalizeCache = new WeakMap<object, WatchVideoRecord | null>()

export function normalizeVideo(
  raw: RawVideo | null | undefined,
): WatchVideoRecord | null {
  if (raw == null) return null
  // returnPartialData can surface a Video before the network fills it in. The
  // session keys on documentId, so treat identity-less partials as "not ready"
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
      hls: cleanStreamUrl(v.hls),
      duration: v.duration ?? null,
      languageCoreId: v.language?.coreId ?? null,
      languageBcp47: v.language?.bcp47 ?? null,
      languageSlug: v.language?.slug ?? null,
      languageName: v.language?.name
        ? (pickLocalizedName(v.language.name) ?? null)
        : null,
      languageNameNative: (() => {
        if (!v.language?.name || !v.language?.bcp47) return null
        const bcp47 = v.language.bcp47.split("-")[0]
        if (bcp47 === "en") return null
        const native = pickLocalizedName(v.language.name, bcp47)
        const english = pickLocalizedName(v.language.name, "en")
        return native && native !== english ? native : null
      })(),
      muxPlaybackId: v.muxVideo?.playbackId ?? null,
    }))

  // Parent SERIES only (U1): a COLLECTION (or other) parent groups standalone
  // films — those must NOT fold into a Library series folder. null when absent,
  // not a series, or the lean series fragment omits the parents chain.
  const parent = raw.parents?.[0]?.parent
  const parentSeries =
    parent && isEpisodicSeriesLabel(parent.label)
      ? {
          documentId: parent.documentId ?? "",
          slug: parent.slug ?? "",
          title:
            resolveVideoDisplayTitle({
              ...videoDisplayTitleCandidates(parent),
              slug: parent.slug,
            }) ?? "Video",
        }
      : null

  // Siblings: parents[0].parent.children, minus self, deduped
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
        title:
          resolveVideoDisplayTitle({
            ...videoDisplayTitleCandidates(child),
            slug: child.slug,
          }) ?? null,
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

  // Copy before sort: Apollo freezes cached results, and Array.sort mutates in
  // place — sorting the raw frozen array throws "Cannot assign to read-only
  // property". (studyQuestions/episodes are safe: .filter() returns a copy.)
  const bibleCitations: WatchBibleCitation[] = [...(raw.bibleCitations ?? [])]
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
    title:
      resolveVideoDisplayTitle({
        ...videoDisplayTitleCandidates(raw),
        slug: raw.slug,
      }) ?? null,
    description: locale.description,
    snippet: locale.snippet,
    posterUrl: pickPosterUrl(raw.images),
    streamingUrl: cleanStreamUrl(firstPlayable?.hls),
    muxPlaybackId: firstPlayable?.muxVideo?.playbackId ?? null,
    duration: firstPlayable?.duration ?? null,
    primaryLanguageBcp47: raw.primaryLanguage?.bcp47 ?? null,
    parentSeries,
    siblings,
    variants,
    studyQuestions,
    bibleCitations,
    episodes: [],
    languages: [],
  }
}

// ── Series normalizer ──────────────────────────────────────────────

type RawSeriesVideo = NonNullable<SeriesVideoData["videoBySlug"]>

function buildEpisodes(raw: RawSeriesVideo): WatchEpisode[] {
  const episodes = (raw.children ?? [])
    .filter(
      (rel): rel is typeof rel & { child: NonNullable<typeof rel.child> } =>
        rel.child != null,
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((rel) => ({
      documentId: rel.child.documentId ?? "",
      slug: rel.child.slug ?? "",
      label: rel.child.label ?? null,
      title:
        resolveVideoDisplayTitle({
          ...videoDisplayTitleCandidates(rel.child),
          slug: rel.child.slug,
        }) ?? null,
      posterUrl: pickPosterUrl(rel.child.images),
      // ?? undefined (not ?? 0): a real index/duration of 0 must round-trip as
      // 0, not be conflated with "not carried" (mirrors offlineManifest's trap).
      seriesEpisodeIndex: rel.order ?? undefined,
      durationSeconds: rel.child.durationSeconds ?? undefined,
    }))
  return dedupeByDocumentId(episodes)
}

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
const normalizeSeriesCache = new WeakMap<object, WatchVideoRecord | null>()

// Normalize a series Video: the shared video record (trailer = the series' own
// playable dub, exposed as streamingUrl/variants) plus the series-only episode
// grid and the language union that feeds the language sheet.
export function normalizeSeries(
  raw: RawSeriesVideo | null | undefined,
): WatchVideoRecord | null {
  if (raw == null || !raw.documentId) return null
  const cached = normalizeSeriesCache.get(raw)
  if (cached !== undefined) return cached
  // RawSeriesVideo is the lean SeriesWatchVideo subset of WatchVideo (no parents
  // chain; per-dub duration/muxVideo dropped). Shared builder maps common fields;
  // dropped fields resolve to siblings=[]/duration=null/muxPlaybackId=null.
  const result: WatchVideoRecord = {
    ...buildWatchVideoRecord(raw),
    episodes: buildEpisodes(raw),
    languages: buildLanguages(raw),
  }
  normalizeSeriesCache.set(raw, result)
  return result
}
