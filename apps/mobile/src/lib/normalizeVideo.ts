import type { WatchVideoData } from "./queries"
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
  downloads: WatchDownload[]
  muxPlaybackId: string | null
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

function pickPosterUrl(
  images: RawVideo["images"] | undefined | null,
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

// ── Normalizer ─────────────────────────────────────────────────────

export function normalizeVideo(
  raw: RawVideo | null | undefined,
): WatchVideoRecord | null {
  if (raw == null) return null

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
      languageNameNative: (() => {
        if (!v.language?.name || !v.language?.bcp47) return null
        const bcp47 = v.language.bcp47.split("-")[0]
        if (bcp47 === "en") return null
        const native = pickLocalizedName(v.language.name, bcp47)
        const english = pickLocalizedName(v.language.name, "en")
        return native && native !== english ? native : null
      })(),
      downloads: (v.downloads ?? [])
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
      muxPlaybackId: v.muxVideo?.playbackId ?? null,
      subtitles: (v.videoEdition?.subtitles ?? [])
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
    }))

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
