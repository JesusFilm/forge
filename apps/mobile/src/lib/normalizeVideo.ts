import type { WatchVideoData, WatchDubData, SeriesVideoData } from "./queries"
import {
  ENGLISH_ADMIN_FORMS,
  type AdminLanguageForms,
} from "../i18n/adminLanguage"
import { bookByOsis, isUsfmBookId, type UsfmBookId } from "./bible/text/books"
import { compareIds } from "./collation"
import { isEpisodicSeriesLabel } from "./isSeriesRecord"
import { pickCardImage } from "./cardImage"
import { pickAdminName, pickLocalizedName } from "./pickLocalizedName"
import { cleanStreamUrl } from "./validateUrl"
import {
  ENGLISH_TEXT_LANG,
  ENGLISH_TEXT_SLUG,
  pickVideoText,
  readDescription,
  readSnippet,
  readTitle,
  textLangFor,
  type LocalizedText,
  type VideoTextSource,
  videoTextVariables,
} from "./videoText"
import { normalizeLanguageIso3 } from "./watchPreferences"

// ── Consumer types ─────────────────────────────────────────────────

export type WatchDownload = {
  documentId: string
  quality: string
  size: string
  url: string
}

// KTD10 and KTD13: each Admin text field carries the language it is in, beside
// the plain string its many readers use. `en` marks an English fallback (R10).
export type WatchSubtitle = {
  documentId: string
  languageSlug: string
  languageName: string
  /** The language of `languageName`; absent in older fixtures. */
  languageNameLang?: string | null
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
  /** The language of `languageName`. */
  languageNameLang?: string | null
  languageNameNative: string | null
  /** ISO 639-3 code as admin sends it; null when absent or blank. */
  languageIso3: string | null
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
  /** The language of `title`. */
  titleLang?: string | null
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
  /** The language of `name`. */
  nameLang?: string | null
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
  /** The language of `bookName`. */
  bookNameLang?: string | null
  /** The book's USFM code, such as `JHN`. Null for a book BSB does not have. */
  bookUsfm: UsfmBookId | null
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
  /** Null until the text companion lands (KTD10). */
  title: string | null
  titleLang?: string | null
  description: string | null
  descriptionLang?: string | null
  snippet: string | null
  snippetLang?: string | null
  posterUrl: string | null
  streamingUrl: string | null
  muxPlaybackId: string | null
  duration: number | null
  primaryLanguageBcp47: string | null
  /** The unique language identity. bcp47 tags collide across languages. */
  primaryLanguageCoreId: string | null
  /** The SERIES-labelled parent this video is an episode of; null for a standalone
   *  video, a COLLECTION member, or an orphan. */
  parentSeries: {
    documentId: string
    slug: string
    title: string
    titleLang?: string | null
  } | null
  siblings: WatchSibling[]
  variants: WatchVariant[]
  studyQuestions: WatchStudyQuestion[]
  /** The language of `studyQuestions`: the UI's, or `en` for the English list. */
  studyQuestionsLang?: string | null
  bibleCitations: WatchBibleCitation[]
  // Series-only: empty for a single video; populated by normalizeSeries.
  episodes: WatchEpisode[]
  languages: WatchChildLanguage[]
  /** The Admin language forms this record was read with (KTD16). A screen
   *  passes them on to every other reader of Admin content. */
  adminForms?: AdminLanguageForms
}

/** The text companion's shape (GET_VIDEO_TEXT or GET_SERIES_TEXT). */
type RelativeText = VideoTextSource & { documentId?: string | null }

export type VideoTextInput = RelativeText & {
  parents?:
    | readonly {
        parent?:
          | (RelativeText & {
              children?: readonly { child?: RelativeText | null }[] | null
            })
          | null
      }[]
    | null
  children?: readonly { child?: RelativeText | null }[] | null
  /** GET_VIDEO_TEXT only: the UI slug's list and the English list (U7). */
  studyQuestions?: readonly RawStudyQuestion[] | null
  englishStudyQuestions?: readonly RawStudyQuestion[] | null
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

// Slugs and ids are identities, so they sort by code unit (KTD15), never in
// the device's collation.
function compareLanguageSlug(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const byPresence = left == null ? (right == null ? 0 : 1) : -1
  if (byPresence !== 0) return byPresence
  return compareIds(left ?? "", right ?? "")
}

function formsKey(forms: AdminLanguageForms): string {
  return `${forms.catalogTag}\u0000${forms.rawTag}`
}

/** An Admin name map in the UI language, else English (R9, R10). */
const localizedName = pickAdminName

type RawVariant = NonNullable<RawVideo["variants"]>[number]
type RawVariantLanguage = NonNullable<RawVariant["language"]>

// Permissive aliases let the shared builder accept BOTH the full watch fragment
// and the lean series shape (no `parents` chain; dubs omit `duration`/`muxVideo`
// and the language's `iso3`) without loosening either operation's own type.
type NormalizableVariant = Omit<
  RawVariant,
  "duration" | "muxVideo" | "language"
> &
  Partial<Pick<RawVariant, "duration" | "muxVideo">> & {
    language:
      | (Omit<RawVariantLanguage, "iso3"> &
          Partial<Pick<RawVariantLanguage, "iso3">>)
      | null
  }

type RawCitation = NonNullable<RawVideo["bibleCitations"]>[number]
type RawCitationBook = NonNullable<RawCitation["bibleBook"]>
type BookCodeField = "osisId" | "paratextAbbreviation"

// The lean series fragment selects no book codes.
type NormalizableCitation = Omit<RawCitation, "bibleBook"> & {
  bibleBook:
    | (Omit<RawCitationBook, BookCodeField> &
        Partial<Pick<RawCitationBook, BookCodeField>>)
    | null
}

type NormalizableVideo = Omit<
  RawVideo,
  "parents" | "variants" | "bibleCitations"
> & {
  parents?: RawVideo["parents"]
  variants?: readonly NormalizableVariant[] | null
  bibleCitations?: readonly NormalizableCitation[] | null
}

// Admin's OSIS id first (`John`, `1Cor`, `Ps`), then its Paratext code, which
// is the USFM code (`JHN`). A book outside BSB's 66 gives null, and the quote
// card then shows no reader button.
function citationBookUsfm(
  book: NormalizableCitation["bibleBook"],
): UsfmBookId | null {
  const osis = book?.osisId?.trim()
  const byOsis = osis ? bookByOsis(osis) : undefined
  if (byOsis) return byOsis.usfm
  const paratext = book?.paratextAbbreviation?.trim()
  return paratext && isUsfmBookId(paratext) ? paratext : null
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
// `forms` names the subtitle languages; English for a caller that has none.
export function normalizeDubMedia(
  raw: RawDub | null | undefined,
  forms: AdminLanguageForms = ENGLISH_ADMIN_FORMS,
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
      // Admin's Language.slug is nullable. A slug-less track can't be keyed —
      // it collapses to "", which is falsy, so a genuine pick reads downstream
      // as "nothing selected" and shows no captions under its own name.
      .filter((s) => s.vttSrc != null && !!s.language?.slug)
      .map((s) => {
        const name = localizedName(s.language?.name, forms)
        return {
          documentId: s.documentId ?? "",
          languageSlug: s.language?.slug ?? "",
          languageName: name?.text ?? "",
          languageNameLang: name?.lang ?? null,
          languageBcp47: s.language?.bcp47 ?? "",
          vttSrc: s.vttSrc ?? "",
          primary: s.primary ?? false,
          aiGenerated: s.aiGenerated ?? false,
        }
      }),
  }
}

// ── Normalizer ─────────────────────────────────────────────────────

// Memo by raw object and forms, so re-entry skips re-walking 2,259 dubs (a
// multi-second freeze). The forms key is load-bearing: Apollo returns the SAME
// `name` objects after a language change (KTD2, KTD16).
const normalizeCache = new WeakMap<object, Map<string, WatchVideoRecord>>()

function memoized(
  cache: WeakMap<object, Map<string, WatchVideoRecord>>,
  raw: object,
  forms: AdminLanguageForms,
  build: () => WatchVideoRecord,
): WatchVideoRecord {
  const key = formsKey(forms)
  let byForms = cache.get(raw)
  if (!byForms) {
    byForms = new Map()
    cache.set(raw, byForms)
  }
  const cached = byForms.get(key)
  if (cached) return cached
  const record = build()
  byForms.set(key, record)
  return record
}

/** The watch record from the language-free document plus the text companion
 *  (KTD10), read with the forms the screen captured (KTD16). It never reads
 *  the locale store. */
export function normalizeVideo(
  raw: RawVideo | null | undefined,
  forms: AdminLanguageForms,
  text?: VideoTextInput | null,
): WatchVideoRecord | null {
  if (raw == null) return null
  // returnPartialData can surface a Video before the network fills it in. The
  // session keys on documentId, so treat identity-less partials as "not ready"
  // and let the seed/skeleton carry the screen.
  if (!raw.documentId) return null

  const base = memoized(normalizeCache, raw, forms, () =>
    buildWatchVideoRecord(raw, forms),
  )
  return withVideoText(base, text, forms)
}

function buildWatchVideoRecord(
  raw: NormalizableVideo,
  forms: AdminLanguageForms,
): WatchVideoRecord {
  const firstPlayable = pickFirstPlayableVariant(raw.variants)

  const variants: WatchVariant[] = (raw.variants ?? [])
    .filter((v) => v.published === true)
    .map((v) => {
      const name = localizedName(v.language?.name, forms)
      return {
        documentId: v.documentId ?? "",
        slug: v.slug ?? "",
        published: v.published ?? false,
        hls: cleanStreamUrl(v.hls),
        duration: v.duration ?? null,
        languageCoreId: v.language?.coreId ?? null,
        languageBcp47: v.language?.bcp47 ?? null,
        languageSlug: v.language?.slug ?? null,
        languageName: name?.text ?? null,
        languageNameLang: name?.lang ?? null,
        languageNameNative: (() => {
          if (!v.language?.name || !v.language?.bcp47) return null
          const bcp47 = v.language.bcp47.split("-")[0]
          if (bcp47 === "en") return null
          const native = pickLocalizedName(v.language.name, bcp47)
          const english = pickLocalizedName(v.language.name, "en")
          return native && native !== english ? native : null
        })(),
        languageIso3: normalizeLanguageIso3(v.language?.iso3),
        muxPlaybackId: v.muxVideo?.playbackId ?? null,
      }
    })

  // Parent SERIES only (U1): a COLLECTION (or other) parent groups standalone
  // films — those must NOT fold into a Library series folder. null when absent,
  // not a series, or the lean series fragment omits the parents chain. The
  // title comes from the text companion (withVideoText).
  const parent = raw.parents?.[0]?.parent
  const parentSeries =
    parent && isEpisodicSeriesLabel(parent.label)
      ? {
          documentId: parent.documentId ?? "",
          slug: parent.slug ?? "",
          title: "",
          titleLang: null,
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
        title: null,
        titleLang: null,
        posterUrl: pickPosterUrl(child.images),
      })) ?? []
  const siblings = dedupeByDocumentId(rawSiblings)

  // Copy before sort: Apollo freezes cached results, and Array.sort mutates in
  // place — sorting the raw frozen array throws "Cannot assign to read-only
  // property". (studyQuestions/episodes are safe: .filter() returns a copy.)
  const bibleCitations: WatchBibleCitation[] = [...(raw.bibleCitations ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => {
      const book = localizedName(c.bibleBook?.name, forms)
      return {
        documentId: c.documentId ?? "",
        osisId: c.osisId ?? null,
        bookName: book?.text ?? null,
        bookNameLang: book?.lang ?? null,
        bookUsfm: citationBookUsfm(c.bibleBook),
        chapterStart: c.chapterStart ?? null,
        chapterEnd: c.chapterEnd ?? null,
        verseStart: c.verseStart ?? null,
        verseEnd: c.verseEnd ?? null,
        order: c.order ?? null,
      }
    })

  return {
    documentId: raw.documentId ?? "",
    slug: raw.slug ?? "",
    label: raw.label ?? null,
    title: null,
    titleLang: null,
    description: null,
    descriptionLang: null,
    snippet: null,
    snippetLang: null,
    posterUrl: pickPosterUrl(raw.images),
    streamingUrl: cleanStreamUrl(firstPlayable?.hls),
    muxPlaybackId: firstPlayable?.muxVideo?.playbackId ?? null,
    duration: firstPlayable?.duration ?? null,
    primaryLanguageBcp47: raw.primaryLanguage?.bcp47 ?? null,
    primaryLanguageCoreId: raw.primaryLanguage?.coreId ?? null,
    parentSeries,
    siblings,
    variants,
    // The text companion carries them (U7), so none show before it lands.
    studyQuestions: [],
    studyQuestionsLang: null,
    bibleCitations,
    episodes: [],
    languages: [],
    adminForms: forms,
  }
}

// ── Text merge (KTD10) ─────────────────────────────────────────────

type RawStudyQuestion = {
  documentId?: string | null
  languageSlug?: string | null
  value?: string | null
  order?: number | null
}

// A row with no slug is the older fixture shape; Admin's filter sends the slug.
function studyQuestionsIn(
  rows: readonly RawStudyQuestion[] | null | undefined,
  slug: string,
): WatchStudyQuestion[] {
  return (rows ?? [])
    .filter((q) => q.languageSlug == null || q.languageSlug === slug)
    .filter((q) => q.value != null && q.value !== "")
    .sort((a, b) => {
      const byOrder = (a.order ?? 0) - (b.order ?? 0)
      if (byOrder !== 0) return byOrder
      const bySlug = compareLanguageSlug(a.languageSlug, b.languageSlug)
      if (bySlug !== 0) return bySlug
      return compareIds(a.documentId ?? "", b.documentId ?? "")
    })
    .map((q) => ({
      documentId: q.documentId ?? "",
      value: q.value ?? "",
      order: q.order ?? 0,
    }))
}

/** R9, R10: the UI language's list, else the English list, never a mix. */
function pickStudyQuestions(
  text: VideoTextInput,
  forms: AdminLanguageForms,
): { questions: WatchStudyQuestion[]; lang: string | null } {
  const ui = studyQuestionsIn(
    text.studyQuestions,
    videoTextVariables(forms).textSlug,
  )
  if (ui.length > 0) return { questions: ui, lang: textLangFor(forms) }
  const english = studyQuestionsIn(
    text.englishStudyQuestions,
    ENGLISH_TEXT_SLUG,
  )
  return english.length > 0
    ? { questions: english, lang: ENGLISH_TEXT_LANG }
    : { questions: [], lang: null }
}

// Keyed by the base record (which already encodes the forms) and the text
// object, so a republish with the same inputs keeps its identity.
const textCache = new WeakMap<object, WeakMap<object, WatchVideoRecord>>()

/** Every relative's rows in the companion, by Video id. */
function relativeRows(text: VideoTextInput): Map<string, VideoTextSource> {
  const rows = new Map<string, VideoTextSource>()
  const add = (video: RelativeText | null | undefined) => {
    if (video?.documentId) rows.set(video.documentId, video)
  }
  const parent = text.parents?.[0]?.parent
  add(parent)
  for (const rel of parent?.children ?? []) add(rel.child)
  for (const rel of text.children ?? []) add(rel.child)
  return rows
}

function titleFor(
  rows: Map<string, VideoTextSource>,
  documentId: string,
  forms: AdminLanguageForms,
): LocalizedText | null {
  return pickVideoText(rows.get(documentId), forms, readTitle)
}

/** Adds the companion's text to a record: each field in the UI language, else
 *  in English (R10). A companion for another video is ignored. */
export function withVideoText(
  base: WatchVideoRecord,
  text: VideoTextInput | null | undefined,
  forms: AdminLanguageForms,
): WatchVideoRecord {
  if (text == null || text.documentId !== base.documentId) return base
  let byText = textCache.get(base)
  if (!byText) {
    byText = new WeakMap()
    textCache.set(base, byText)
  }
  const cached = byText.get(text)
  if (cached) return cached

  const title = pickVideoText(text, forms, readTitle)
  const description = pickVideoText(text, forms, readDescription)
  const snippet = pickVideoText(text, forms, readSnippet)
  const rows = relativeRows(text)
  const titled = <T extends WatchSibling>(item: T): T => {
    const itemTitle = titleFor(rows, item.documentId, forms)
    return itemTitle
      ? { ...item, title: itemTitle.text, titleLang: itemTitle.lang }
      : item
  }
  const parentTitle = base.parentSeries
    ? titleFor(rows, base.parentSeries.documentId, forms)
    : null

  const study = pickStudyQuestions(text, forms)

  const merged: WatchVideoRecord = {
    ...base,
    title: title?.text ?? null,
    titleLang: title?.lang ?? null,
    description: description?.text ?? null,
    descriptionLang: description?.lang ?? null,
    snippet: snippet?.text ?? null,
    snippetLang: snippet?.lang ?? null,
    studyQuestions: study.questions,
    studyQuestionsLang: study.lang,
    parentSeries:
      base.parentSeries && parentTitle
        ? {
            ...base.parentSeries,
            title: parentTitle.text,
            titleLang: parentTitle.lang,
          }
        : base.parentSeries,
    siblings: base.siblings.map(titled),
    episodes: base.episodes.map(titled),
  }
  byText.set(text, merged)
  return merged
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
      title: null,
      titleLang: null,
      posterUrl: pickPosterUrl(rel.child.images),
      // ?? undefined (not ?? 0): a real index/duration of 0 must round-trip as
      // 0, not be conflated with "not carried" (mirrors offlineManifest's trap).
      seriesEpisodeIndex: rel.order ?? undefined,
      durationSeconds: rel.child.durationSeconds ?? undefined,
    }))
  return dedupeByDocumentId(episodes)
}

function buildLanguages(
  raw: RawSeriesVideo,
  forms: AdminLanguageForms,
): WatchChildLanguage[] {
  const seen = new Set<string>()
  const languages: WatchChildLanguage[] = []
  for (const lang of raw.childDubLanguages ?? []) {
    const slug = lang.slug
    if (slug == null || slug === "" || seen.has(slug)) continue
    seen.add(slug)
    const name = localizedName(lang.name, forms)
    languages.push({
      slug,
      name: name?.text ?? null,
      nameLang: name?.lang ?? null,
      bcp47: lang.bcp47 ?? null,
    })
  }
  return languages
}

// Memoize on the raw reference and the forms like normalizeVideo, so a
// cache-first re-entry doesn't re-walk children/languages.
const normalizeSeriesCache = new WeakMap<
  object,
  Map<string, WatchVideoRecord>
>()

// Normalize a series Video: the shared video record (trailer = the series' own
// playable dub, exposed as streamingUrl/variants) plus the series-only episode
// grid and the language union that feeds the language sheet. `text` is the
// GET_SERIES_TEXT companion.
export function normalizeSeries(
  raw: RawSeriesVideo | null | undefined,
  forms: AdminLanguageForms,
  text?: VideoTextInput | null,
): WatchVideoRecord | null {
  if (raw == null || !raw.documentId) return null
  // RawSeriesVideo is the lean SeriesWatchVideo subset of WatchVideo (no parents
  // chain; per-dub duration/muxVideo dropped). Shared builder maps common fields;
  // dropped fields resolve to siblings=[]/duration=null/muxPlaybackId=null.
  const base = memoized(normalizeSeriesCache, raw, forms, () => ({
    ...buildWatchVideoRecord(raw, forms),
    episodes: buildEpisodes(raw),
    languages: buildLanguages(raw, forms),
  }))
  return withVideoText(base, text, forms)
}
