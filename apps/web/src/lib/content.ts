import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import {
  adminGraphql,
  type AdminFragmentOf,
  type AdminResultOf,
} from "@forge/admin-graphql"
import client from "@/lib/admin-client"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichRouteRelatedVideo } from "@/lib/enrichment"
import {
  getVideoChildDubLanguagesBySlugOperation,
  getWatchLanguagePickerVariantsBySlugOperation,
  getWatchVideoDubDetailOperation,
  getWatchVideoLocalizedCopyBySlugOperation,
  getWatchVideoRouteSnapshotBySlugOperation,
  watchExperienceFragment,
  watchVideoDubDetailFragment,
  watchVideoLocalizedCopyFragment,
  watchVideoShellFragment,
} from "@/lib/fragments"
import { slugToBcp47Tag } from "@/lib/locale"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"
import { isWatchBlock } from "@/lib/watch-blocks"
import { isSeriesRecord } from "@/lib/watch-content-kind"
import { logWatchServerEvent } from "@/lib/watch-observability"
import { resolvePosterUrl } from "@/lib/url"

export { isSeriesRecord } from "@/lib/watch-content-kind"

// Keep gql.tada introspection types live for the watch-page fragments.
void watchVideoShellFragment
void watchVideoLocalizedCopyFragment
void watchVideoDubDetailFragment

const GET_EXPERIENCE = adminGraphql(`
  query GetExperience($slug: String!, $locale: String!) {
    experienceBySlug(locale: $locale, slug: $slug) {
      id
    }
  }
`)

const GET_WATCH_EXPERIENCE = adminGraphql(
  `
    query GetWatchExperience($locale: String!, $slug: String!) {
      experienceBySlug(locale: $locale, slug: $slug) {
        ...WatchExperience
      }
    }
  `,
  [watchExperienceFragment],
)

const GET_WATCH_SETTINGS = adminGraphql(
  `
    query GetWatchSettings($locale: String!) {
      watchSetting(locale: $locale) {
        documentId
        homepageExperience {
          ...WatchExperience
        }
        defaultTemplateExperience {
          ...WatchExperience
        }
      }
    }
  `,
  [watchExperienceFragment],
)

type WatchSettingsData = AdminResultOf<typeof GET_WATCH_SETTINGS>
type GetWatchLanguagePickerVariantsData = AdminResultOf<
  typeof getWatchLanguagePickerVariantsBySlugOperation
>
type GetWatchVideoLocalizedCopyData = AdminResultOf<
  typeof getWatchVideoLocalizedCopyBySlugOperation
>
type GetWatchVideoDubDetailData = AdminResultOf<
  typeof getWatchVideoDubDetailOperation
>
type AdminLanguagePickerVideoRaw = NonNullable<
  GetWatchLanguagePickerVariantsData["videoBySlug"]
>
type AdminVideoLocalizedCopyRaw = NonNullable<
  GetWatchVideoLocalizedCopyData["videoBySlug"]
>
type AdminVideoDubDetailRaw = NonNullable<
  GetWatchVideoDubDetailData["videoDub"]
>

type GetChildDubLanguagesData = AdminResultOf<
  typeof getVideoChildDubLanguagesBySlugOperation
>
type AdminChildDubLanguageRaw = NonNullable<
  NonNullable<GetChildDubLanguagesData["videoBySlug"]>["childDubLanguages"]
>[number]

// Anchor WatchExperience to the fragment itself so all three queries
// (GET_WATCH_EXPERIENCE.experienceBySlug, GET_WATCH_SETTINGS.homepageExperience,
// GET_WATCH_SETTINGS.defaultTemplateExperience) project through one type.
// See docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md
export type WatchExperience = AdminFragmentOf<typeof watchExperienceFragment>

type WatchSetting = WatchSettingsData["watchSetting"]

export type ExperienceMetadata = {
  title: string
  description: string
  ogTitle: string
  ogDescription: string
  pathSegment: string | null
  ogImage: {
    url: string
    width: number | null
    height: number | null
    alt: string
  } | null
}

// Flat WatchVideo record consumed by the watch page, series page, merge
// layer, and metadata helpers. Admin's `Video` keeps locale-varying fields
// on `VideoLocale` and parent/child relations on `VideoRelation`; this
// record is the post-resolver-transform shape with the active locale's
// fields hoisted onto the top level and `VideoRelation` flattened so
// `parents[i]` is a Video directly. Same shape both query paths produce —
// the transform is the single normalisation surface.
export type WatchImage = {
  documentId: string
  url: string | null
  thumbnail: string | null
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  blurDataUrl?: string | null
  dominantColor?: string | null
}

// One distinct playable dub language available across a series' children,
// projected for the /series-page language picker. Server-guaranteed playable
// and deduped by language, so it carries only the display fields the picker
// needs — it navigates by slug and never touches a dub's id/hls/duration.
// See getVideoChildDubLanguagesBySlugOperation.
export type WatchChildLanguage = {
  slug: string | null
  name: string | null
  bcp47: string | null
}

export type WatchChild = {
  documentId: string
  /** One-based canonical position from VideoRelation.order; null is unsequenced. */
  order?: number | null
  slug: string | null
  title: string | null
  label: string | null
  images: WatchImage[]
  // Primary playable dub runtime in seconds (admin's Video.durationSeconds),
  // or null when the chapter has no playable dub. Replaces the former
  // per-child `variants` list — the carousel/grid only ever read a single
  // runtime off each child, and the full dub list was the ~45 MB payload
  // that broke unstable_cache. Cross-episode language data now lives on the
  // parent's `childDubLanguages` (see WatchVideoRecord).
  durationSeconds: number | null
  // Best playable Mux playback id for the current watch language, falling
  // back server-side to a primary/longest playable Mux dub. Lets the carousel
  // render frame thumbnails without projecting every child's dubs.
  muxPlaybackId: string | null
  // Base64 blur data URL for the exact Watch carousel Mux thumbnail recipe,
  // generated and stored admin-side. Only applies when muxPlaybackId is present.
  muxThumbnailBlurDataUrl: string | null
  // Base64 blur data URL for the exact Watch hero poster Mux thumbnail recipe.
  muxHeroPosterBlurDataUrl?: string | null
}

export type WatchParent = {
  documentId: string
  slug: string | null
  title: string | null
  noIndex: boolean | null
  label: string | null
  images: WatchImage[]
  children: WatchChild[]
}

export type WatchVariantLanguage = {
  coreId: string | null
  bcp47: string | null
  iso3?: string | null
  slug: string | null
  name: string | null
  nativeName: string | null
}

export type WatchVariantDownload = {
  documentId: string
  height?: number | null
  quality: string | null
  size: string | null
}

export type WatchVariant = {
  documentId: string
  slug: string | null
  published: boolean | null
  hls: string | null
  duration: number | null
  language: WatchVariantLanguage | null
  downloads: WatchVariantDownload[]
  muxVideo: { playbackId: string | null } | null
  muxHeroPosterBlurDataUrl?: string | null
  videoEdition?: {
    subtitles: {
      documentId: string | null
      vttSrc: string | null
      srtSrc: string | null
      primary: boolean | null
      aiGenerated: boolean | null
      video: { documentId: string } | null
      language: WatchVariantLanguage | null
    }[]
  } | null
}

export type WatchLanguagePickerVariant = {
  documentId: string
  hls: string | null
  published: boolean | null
  language: {
    coreId?: string | null
    bcp47?: string | null
    slug: string | null
    name: string | null
    nativeName?: string | null
  } | null
  videoEdition?: null
}

export type WatchStudyQuestion = {
  documentId: string
  value: string | null
  order: number | null
}

export type WatchBibleCitationPassage = {
  citationDocumentId: string
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

export type WatchBibleCitation = {
  documentId: string
  chapterStart: number | null
  chapterEnd: number | null
  verseStart: number | null
  verseEnd: number | null
  order: number | null
  osisId: string | null
  bibleBook: { documentId: string; name: string | null } | null
  passage: WatchBibleCitationPassage | null
}

export type WatchSubtitle = {
  documentId: string
  language: {
    slug: string
    name: string
    nativeName: string | null
    bcp47: string
  }
  vttSrc: string
  primary: boolean
  aiGenerated: boolean
}

export type WatchVideoRecord = {
  documentId: string
  slug: string | null
  publishedAt: string | null
  localePublishedAt: string | null
  title: string | null
  snippet: string | null
  description: string | null
  noIndex: boolean | null
  label: string | null
  imageAlt: string | null
  searchTitle?: string | null
  searchDescription?: string | null
  socialImage?: WatchSocialImage | null
  images: WatchImage[]
  primaryLanguage: { coreId: string | null; bcp47: string | null } | null
  parents: WatchParent[]
  children: WatchChild[]
  // Distinct playable dub languages across this record's children,
  // aggregated server-side. Populated for series/collection records (via
  // resolveSeriesBySlug's dedicated fetch); empty for leaf videos and on the
  // watch path. The /series-page language picker reads this instead of
  // walking `children[].variants`.
  childDubLanguages: WatchChildLanguage[]
  variants: WatchVariant[]
  playableLanguageCount?: number
  subtitles: WatchSubtitle[]
  studyQuestions: WatchStudyQuestion[]
  bibleCitations: WatchBibleCitation[]
}

export type WatchSocialImage = {
  url: string
  width: number | null
  height: number | null
  mimeType?: string | null
}

export type RouteVideo = {
  documentId: string
  slug: string
  title: string
  snippet: string | null
  description: string | null
  searchTitle?: string | null
  searchDescription?: string | null
  socialImage?: WatchSocialImage | null
  noIndex: boolean
  imageUrl: string | null
  imageAlt: string | null
  streamingUrl: string | null
  relatedItems: EnrichedMediaItem[]
}

export type ResolvedWatchPage =
  | { kind: "experience"; experience: NonNullable<WatchExperience> }
  | {
      kind: "video-template"
      template: NonNullable<WatchExperience>
      routeVideo: RouteVideo
    }

export type WatchPageResult =
  | { data: ResolvedWatchPage; error: null }
  | { data: null; error: ErrorLike | Error }

const NO_EXPERIENCE_FOUND_MESSAGE = "No experience found"

function missingExperienceError(): ErrorLike {
  return {
    name: "Error",
    message: NO_EXPERIENCE_FOUND_MESSAGE,
  }
}

/** Maps a WatchExperience to metadata shape. Returns null if no usable title/description. */
export function experienceToMetadata(
  exp: WatchExperience | null,
): ExperienceMetadata | null {
  if (!exp) return null
  const title = exp.title ?? ""
  const description = exp.metaDescription ?? ""
  const ogTitle = exp.ogTitle ?? title
  const ogDescription = exp.ogDescription ?? description
  if (!title && !description) return null
  return {
    title,
    description,
    ogTitle,
    ogDescription,
    pathSegment: exp.pathSegment ?? null,
    ogImage: exp.ogImageUrl
      ? {
          url: exp.ogImageUrl,
          width: null,
          height: null,
          alt: "",
        }
      : null,
  }
}

export async function readPublishedContent(slug: string, locale: string) {
  const result = await client.query({
    query: GET_EXPERIENCE,
    variables: { slug, locale },
  })
  if (result.error) return null
  return result.data?.experienceBySlug ?? null
}

export type Section = NonNullable<
  NonNullable<NonNullable<WatchExperience>["blocks"]>[number]
>

/**
 * Normalize gql.tada's intersection of the canonical and Web-extension block
 * arrays into the element-wise Section union consumed by renderers. Both
 * fragments are unmasked in every WatchExperience operation, so this adapts
 * only TypeScript's array-method surface; it does not invent runtime fields.
 */
export function watchExperienceBlocks(
  experience: WatchExperience | null | undefined,
): readonly Section[] {
  return (experience?.blocks ?? []) as unknown as readonly Section[]
}

export function isWatchPageMissingError(
  error: ErrorLike | Error | null | undefined,
): boolean {
  return error?.message?.trim() === NO_EXPERIENCE_FOUND_MESSAGE
}

function graphqlError(result: {
  error?: ErrorLike | null
  errors?: unknown[] | undefined
}): ErrorLike | Error | null {
  const graphqlErrors = result.errors?.filter(
    (entry): entry is { message?: string } =>
      typeof entry === "object" && entry !== null,
  )
  if (graphqlErrors?.length) {
    const message = graphqlErrors
      .map((entry) => entry.message ?? "Unknown")
      .join("; ")
    return new Error(message)
  }

  if (!result.error) return null

  const message =
    "message" in result.error && typeof result.error.message === "string"
      ? result.error.message
      : ""

  return message ? result.error : new Error("An unexpected error occurred.")
}

async function getExperienceBySlug(
  locale: string,
  slug: string,
): Promise<NonNullable<WatchExperience> | null> {
  const result = await client.query({
    query: GET_WATCH_EXPERIENCE,
    variables: { locale, slug },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return (result.data?.experienceBySlug ??
    null) as NonNullable<WatchExperience> | null
}

async function getWatchSettings(locale: string): Promise<WatchSetting | null> {
  const result = await client.query({
    query: GET_WATCH_SETTINGS,
    variables: { locale },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return result.data?.watchSetting ?? null
}

// Admin-shape → flat-shape transform. Single normalisation surface
// consumed by both watch routes (3-segment and 2-segment) since they
// share the shell/copy/Dub-detail fetch path; keeps the resolver-visible
// `WatchVideoRecord` shape stable across both call sites.
//
// Admin's `id: ID` is nominally `string | null` at the SDL layer but is
// always non-null in practice (every Prisma row has a generated id). The
// normalisers reject nodes whose `documentId` projects to null so the
// consumer-facing types can stay `string` instead of `string | null` —
// a null id from admin would surface as a dropped row, not a runtime
// crash deep inside the renderer.

type AdminLocaleRaw = {
  documentId: string | null
  languageSlug?: string | null
  publishedAt?: string | null
  title?: string | null
  description?: string | null
  snippet?: string | null
  imageAlt?: string | null
  searchTitle?: string | null
  searchDescription?: string | null
  socialImage?: {
    url?: string | null
    width?: number | null
    height?: number | null
    mimeType?: string | null
  } | null
}

type AdminImageRaw = {
  documentId: string | null
  url?: string | null
  thumbnail?: string | null
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
  blurDataUrl?: string | null
  dominantColor?: string | null
}

type AdminLanguageRaw = {
  coreId?: string | null
  bcp47?: string | null
  iso3?: string | null
  slug?: string | null
  name?: unknown
}

type AdminSubtitleRaw = {
  documentId?: string | null
  vttSrc?: string | null
  srtSrc?: string | null
  primary?: boolean | null
  aiGenerated?: boolean | null
  video?: { documentId?: string | null } | null
  language?: AdminLanguageRaw | null
}

type AdminVideoVariantRaw = {
  documentId: string | null
  slug?: string | null
  published?: boolean | null
  hls?: string | null
  duration?: number | null
  language?: AdminLanguageRaw | null
  downloads?:
    | {
        documentId: string | null
        height?: number | null
        quality?: string | null
        size?: string | null
      }[]
    | null
  muxVideo?: { playbackId?: string | null } | null
  muxHeroPosterBlurDataUrl?: string | null
  videoEdition?: { subtitles?: AdminSubtitleRaw[] | null } | null
}

type AdminChildRelationRaw = {
  order?: number | null
  child: {
    documentId: string | null
    slug?: string | null
    label?: string | null
    muxPlaybackId?: string | null
    muxThumbnailBlurDataUrl?: string | null
    muxHeroPosterBlurDataUrl?: string | null
    locales?: AdminLocaleRaw[] | null
    images?: AdminImageRaw[] | null
    durationSeconds?: number | null
  } | null
}

type AdminParentRelationRaw = {
  parent: {
    documentId: string | null
    slug?: string | null
    noIndex?: boolean | null
    label?: string | null
    locales?: AdminLocaleRaw[] | null
    images?: AdminImageRaw[] | null
    children?: AdminChildRelationRaw[] | null
  } | null
}

type AdminBibleCitationRaw = {
  documentId: string | null
  chapterStart?: number | null
  chapterEnd?: number | null
  verseStart?: number | null
  verseEnd?: number | null
  order?: number | null
  osisId?: string | null
  bibleBook?: { documentId: string | null; name?: unknown } | null
  passage?: {
    content?: string | null
    copyright?: string | null
    humanReference?: string | null
    provider?: string | null
    publisherUrl?: string | null
    reference?: string | null
    versionAbbreviation?: string | null
    versionId?: number | null
    versionTitle?: string | null
  } | null
}

type AdminStudyQuestionRaw = {
  documentId: string | null
  languageSlug?: string | null
  value?: string | null
  order?: number | null
}

type AdminVideoRaw = {
  documentId: string | null
  slug?: string | null
  publishedAt?: string | null
  noIndex?: boolean | null
  label?: string | null
  images?: AdminImageRaw[] | null
  primaryLanguage?: { coreId?: string | null; bcp47?: string | null } | null
  locales?: AdminLocaleRaw[] | null
  parents?: AdminParentRelationRaw[] | null
  children?: AdminChildRelationRaw[] | null
  variants?: AdminVideoVariantRaw[] | null
  playableDubLanguageCount?: number | null
  studyQuestions?: AdminStudyQuestionRaw[] | null
  bibleCitations?: AdminBibleCitationRaw[] | null
}

type AdminVideoRouteSnapshotCopyLayer = "exact" | "broad" | "english"

type AdminVideoRouteSnapshotAliases = {
  exactLocales?: AdminLocaleRaw[] | null
  broadLocales?: AdminLocaleRaw[] | null
  englishLocales?: AdminLocaleRaw[] | null
}

type AdminVideoRouteSnapshotStudyQuestionAliases = {
  exactStudyQuestions?: AdminStudyQuestionRaw[] | null
  broadStudyQuestions?: AdminStudyQuestionRaw[] | null
  englishStudyQuestions?: AdminStudyQuestionRaw[] | null
}

type AdminVideoRouteSnapshotChildRelation = {
  order?: number | null
  child:
    | (NonNullable<AdminChildRelationRaw["child"]> &
        AdminVideoRouteSnapshotAliases)
    | null
}

type AdminVideoRouteSnapshotParentRelation = {
  parent:
    | (NonNullable<AdminParentRelationRaw["parent"]> &
        AdminVideoRouteSnapshotAliases & {
          children?: AdminVideoRouteSnapshotChildRelation[] | null
        })
    | null
}

type AdminVideoRouteSnapshotRaw = AdminVideoRaw &
  AdminVideoRouteSnapshotAliases &
  AdminVideoRouteSnapshotStudyQuestionAliases & {
    preferredVariant?: AdminVideoVariantRaw | null
    playableDubLanguageCount?: number | null
    parents?: AdminVideoRouteSnapshotParentRelation[] | null
    children?: AdminVideoRouteSnapshotChildRelation[] | null
  }

function normalizeImage(img: AdminImageRaw): WatchImage | null {
  if (!img.documentId) return null
  return {
    documentId: img.documentId,
    url: img.url ?? null,
    thumbnail: img.thumbnail ?? null,
    mobileCinematicHigh: img.mobileCinematicHigh ?? null,
    mobileCinematicLow: img.mobileCinematicLow ?? null,
    blurDataUrl: img.blurDataUrl ?? null,
    dominantColor: img.dominantColor ?? null,
  }
}

function normalizeImages(
  images: AdminVideoRaw["images"] | null | undefined,
): WatchImage[] {
  return (images ?? [])
    .map(normalizeImage)
    .filter((i): i is WatchImage => i != null)
}

function normalizeSocialImage(
  image: AdminLocaleRaw["socialImage"],
): WatchSocialImage | null {
  if (!image?.url) return null
  return {
    url: image.url,
    width: image.width ?? null,
    height: image.height ?? null,
    ...(image.mimeType?.trim() ? { mimeType: image.mimeType.trim() } : {}),
  }
}

// Stable-order dedup by documentId. Keeps the first occurrence so the
// editor-curated ordering survives. Used to scrub the parents/children
// lists in `normalizeAdminVideo` against admin's duplicate VideoRelation
// rows.
function dedupeByDocumentId<T extends { documentId: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    if (seen.has(item.documentId)) continue
    seen.add(item.documentId)
    result.push(item)
  }
  return result
}

// Admin's `Language.name` and `BibleBook.name` are typed `JSON` — a
// locale-keyed object like `{ "en": "Afrikaans", "af": "Afrikaans" }`
// (or, for some Core-synced rows, a plain string). Prefer the English
// label so the language pill on the download dialog + language picker
// always shows a readable string; fall back to other locale keys
// in a fixed priority order if `en` is absent. Returns null only when
// the input is missing or has no usable string entries.
//
// The fallback list is pinned (not `Object.values(map)` iteration
// order) so admin-side jsonb key-ordering changes can't shift the
// rendered label between deploys. New high-traffic locales should be
// added here explicitly rather than relying on insertion order.
const LOCALIZED_NAME_FALLBACK_ORDER = [
  "en",
  "es",
  "fr",
  "pt",
  "de",
  "id",
  "ja",
  "ko",
  "ru",
  "th",
  "tr",
  "zh",
  "zh-Hans-CN",
] as const

function pickNativeName(value: unknown): string | null {
  if (typeof value !== "object" || !value) return null
  const map = value as Record<string, unknown>
  const english = map.en
  for (const [key, val] of Object.entries(map)) {
    if (key === "en") continue
    if (typeof val === "string" && val.length > 0 && val !== english) return val
  }
  return null
}

function pickLocalizedName(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null
  if (!value || typeof value !== "object") return null
  const map = value as Record<string, unknown>
  for (const key of LOCALIZED_NAME_FALLBACK_ORDER) {
    const candidate = map[key]
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }
  // Last-ditch: any remaining non-empty string entry. Order is
  // implementation-defined; this branch should rarely fire because
  // every locale we support has a key in the fallback list above.
  for (const v of Object.values(map)) {
    if (typeof v === "string" && v.length > 0) return v
  }
  return null
}

// Maps one server-aggregated distinct dub language into the minimal display
// shape the /series-page picker consumes. Fed by the dedicated
// `getVideoChildDubLanguagesBySlugOperation` — fetched only for series pages,
// never the watch page (which doesn't read it). Drops slug-less rows so the
// picker never renders an unaddressable language.
function normalizeChildDubLanguage(
  raw: AdminChildDubLanguageRaw,
): WatchChildLanguage | null {
  if (!raw.slug) return null
  return {
    slug: raw.slug,
    name: pickLocalizedName(raw.name),
    bcp47: raw.bcp47 ?? null,
  }
}

function normalizeChild(
  rel: NonNullable<AdminVideoRaw["children"]>[number],
): WatchChild | null {
  const child = rel.child
  if (!child || !child.documentId) return null
  return {
    documentId: child.documentId,
    ...(rel.order === undefined ? {} : { order: rel.order }),
    slug: child.slug ?? null,
    title:
      firstNonBlankLocaleTitle(child.locales) ??
      humanizeContentSlug(child.slug),
    label: child.label ?? null,
    images: normalizeImages(child.images),
    durationSeconds: child.durationSeconds ?? null,
    muxPlaybackId: child.muxPlaybackId ?? null,
    muxThumbnailBlurDataUrl: child.muxThumbnailBlurDataUrl ?? null,
    muxHeroPosterBlurDataUrl: child.muxHeroPosterBlurDataUrl ?? null,
  }
}

function normalizeParent(
  rel: NonNullable<AdminVideoRaw["parents"]>[number],
): WatchParent | null {
  const parent = rel.parent
  if (!parent || !parent.documentId) return null
  return {
    documentId: parent.documentId,
    slug: parent.slug ?? null,
    title:
      firstNonBlankLocaleTitle(parent.locales) ??
      humanizeContentSlug(parent.slug),
    noIndex: parent.noIndex ?? null,
    label: parent.label ?? null,
    images: normalizeImages(parent.images),
    children: (parent.children ?? [])
      .map((childRel): WatchChild | null => {
        const c = childRel.child
        if (!c || !c.documentId) return null
        return {
          documentId: c.documentId,
          ...(childRel.order === undefined ? {} : { order: childRel.order }),
          slug: c.slug ?? null,
          title:
            firstNonBlankLocaleTitle(c.locales) ?? humanizeContentSlug(c.slug),
          label: c.label ?? null,
          images: normalizeImages(c.images),
          muxPlaybackId: c.muxPlaybackId ?? null,
          muxThumbnailBlurDataUrl: c.muxThumbnailBlurDataUrl ?? null,
          muxHeroPosterBlurDataUrl: c.muxHeroPosterBlurDataUrl ?? null,
          // Nested children inside `parent.children` feed only the
          // SiblingCarousel (thumbnails + titles), which never reads a
          // runtime. The fragment doesn't project durationSeconds here, so
          // surface null.
          durationSeconds: null,
        }
      })
      .filter((c): c is WatchChild => c != null),
  }
}

function normalizeVariant(
  v: NonNullable<AdminVideoRaw["variants"]>[number],
): WatchVariant | null {
  if (!v.documentId) return null
  return {
    documentId: v.documentId,
    slug: v.slug ?? null,
    published: v.published ?? null,
    hls: v.hls ?? null,
    duration: v.duration ?? null,
    language: v.language
      ? {
          coreId: v.language.coreId ?? null,
          bcp47: v.language.bcp47 ?? null,
          iso3: v.language.iso3 ?? null,
          slug: v.language.slug ?? null,
          name: pickLocalizedName(v.language.name),
          nativeName: pickNativeName(v.language.name),
        }
      : null,
    downloads: (v.downloads ?? [])
      .map((d): WatchVariantDownload | null => {
        if (!d.documentId) return null
        return {
          documentId: d.documentId,
          height: d.height ?? null,
          quality: d.quality ?? null,
          size: d.size ?? null,
        }
      })
      .filter((d): d is WatchVariantDownload => d != null),
    muxVideo: v.muxVideo ? { playbackId: v.muxVideo.playbackId ?? null } : null,
    muxHeroPosterBlurDataUrl: v.muxHeroPosterBlurDataUrl ?? null,
    videoEdition: v.videoEdition
      ? {
          subtitles: (v.videoEdition.subtitles ?? []).map((subtitle) => ({
            documentId: subtitle.documentId ?? null,
            vttSrc: subtitle.vttSrc ?? null,
            srtSrc: subtitle.srtSrc ?? null,
            primary: subtitle.primary ?? null,
            aiGenerated: subtitle.aiGenerated ?? null,
            video: subtitle.video?.documentId
              ? { documentId: subtitle.video.documentId }
              : null,
            language: subtitle.language
              ? {
                  coreId: subtitle.language.coreId ?? null,
                  bcp47: subtitle.language.bcp47 ?? null,
                  iso3: subtitle.language.iso3 ?? null,
                  slug: subtitle.language.slug ?? null,
                  name: pickLocalizedName(subtitle.language.name),
                  nativeName: pickNativeName(subtitle.language.name),
                }
              : null,
          })),
        }
      : null,
  }
}

function normalizeSubtitlesFromVariants(
  variants: WatchVariant[],
  videoDocumentId: string,
): WatchSubtitle[] {
  const edition = variants.find(
    (variant) => (variant.videoEdition?.subtitles?.length ?? 0) > 0,
  )?.videoEdition
  if (!edition?.subtitles) return []

  const seen = new Set<string>()
  return edition.subtitles
    .map((subtitle, index) => ({ subtitle, index }))
    .filter(
      ({ subtitle }) =>
        subtitle.video == null || subtitle.video.documentId === videoDocumentId,
    )
    .sort((left, right) => {
      const leftDirect = left.subtitle.video != null ? 1 : 0
      const rightDirect = right.subtitle.video != null ? 1 : 0
      return rightDirect - leftDirect || left.index - right.index
    })
    .map(({ subtitle }) => subtitle)
    .filter((s) => {
      if (!s.documentId || !s.vttSrc || !s.language?.slug) return false
      if (seen.has(s.language.slug)) return false
      seen.add(s.language.slug)
      return true
    })
    .map(
      (s): WatchSubtitle => ({
        documentId: s.documentId!,
        language: {
          slug: s.language!.slug!,
          name: s.language!.name ?? s.language!.slug!,
          nativeName: s.language!.nativeName,
          bcp47: s.language!.bcp47 ?? s.language!.slug!,
        },
        vttSrc: s.vttSrc!,
        primary: s.primary ?? false,
        aiGenerated: s.aiGenerated ?? false,
      }),
    )
    .sort((a, b) => a.language.name.localeCompare(b.language.name))
}

function normalizeAdminVideo(raw: AdminVideoRaw): WatchVideoRecord | null {
  if (!raw.documentId) return null
  const localeRow = raw.locales?.[0] ?? null
  const variants = (raw.variants ?? [])
    .map(normalizeVariant)
    .filter((v): v is WatchVariant => v != null)
  return {
    documentId: raw.documentId,
    slug: raw.slug ?? null,
    publishedAt: raw.publishedAt ?? null,
    localePublishedAt: localeRow?.publishedAt ?? null,
    title:
      firstNonBlankLocaleTitle(raw.locales) ?? humanizeContentSlug(raw.slug),
    snippet: localeRow?.snippet ?? null,
    description: localeRow?.description ?? null,
    noIndex: raw.noIndex ?? null,
    label: raw.label ?? null,
    imageAlt: localeRow?.imageAlt ?? null,
    searchTitle: localeRow?.searchTitle ?? null,
    searchDescription: localeRow?.searchDescription ?? null,
    socialImage: normalizeSocialImage(localeRow?.socialImage),
    images: normalizeImages(raw.images),
    primaryLanguage: raw.primaryLanguage
      ? {
          coreId: raw.primaryLanguage.coreId ?? null,
          bcp47: raw.primaryLanguage.bcp47 ?? null,
        }
      : null,
    // Belt-and-braces against admin data-quality issues: filter out
    // self-references (a VideoRelation row pointing the video at itself
    // — seen in the wild for `1-jesus-our-loving-pursuer` with 3 such
    // rows) and dedupe by documentId so a duplicated relation never
    // surfaces as repeated sibling-carousel tiles or React duplicate-key
    // warnings.
    parents: dedupeByDocumentId(
      (raw.parents ?? [])
        .map(normalizeParent)
        .filter(
          (p): p is WatchParent => p != null && p.documentId !== raw.documentId,
        ),
    ),
    children: dedupeByDocumentId(
      (raw.children ?? [])
        .map(normalizeChild)
        .filter(
          (c): c is WatchChild => c != null && c.documentId !== raw.documentId,
        ),
    ),
    // Populated only on the series path via resolveSeriesBySlug's dedicated
    // childDubLanguages fetch — the watch fragment deliberately omits it so
    // watch-page renders (which never read it) stay lean. See
    // getVideoChildDubLanguagesBySlugOperation.
    childDubLanguages: [],
    variants,
    playableLanguageCount:
      raw.playableDubLanguageCount ?? countPlayableWatchVariants(variants),
    subtitles: normalizeSubtitlesFromVariants(variants, raw.documentId),
    studyQuestions: (raw.studyQuestions ?? [])
      .map((q): WatchStudyQuestion | null => {
        if (!q.documentId) return null
        return {
          documentId: q.documentId,
          value: q.value ?? null,
          order: q.order ?? null,
        }
      })
      .filter((q): q is WatchStudyQuestion => q != null),
    bibleCitations: (raw.bibleCitations ?? [])
      .map((c): WatchBibleCitation | null => {
        if (!c.documentId) return null
        return {
          documentId: c.documentId,
          chapterStart: c.chapterStart ?? null,
          chapterEnd: c.chapterEnd ?? null,
          verseStart: c.verseStart ?? null,
          verseEnd: c.verseEnd ?? null,
          order: c.order ?? null,
          osisId: c.osisId ?? null,
          bibleBook:
            c.bibleBook && c.bibleBook.documentId
              ? {
                  documentId: c.bibleBook.documentId,
                  // Admin's `BibleBook.name` is JSON keyed by locale (Core
                  // mirror). `pickLocalizedName` prefers the English entry
                  // so the citation card renders something readable; for
                  // rows admin still emits as a plain string the helper
                  // returns it verbatim.
                  name: pickLocalizedName(c.bibleBook.name),
                }
              : null,
          passage:
            c.passage &&
            c.passage.content &&
            c.passage.copyright &&
            c.passage.humanReference &&
            c.passage.provider &&
            c.passage.reference &&
            c.passage.versionId
              ? {
                  citationDocumentId: c.documentId,
                  content: c.passage.content,
                  copyright: c.passage.copyright,
                  humanReference: c.passage.humanReference,
                  provider: c.passage.provider,
                  publisherUrl: c.passage.publisherUrl ?? null,
                  reference: c.passage.reference,
                  versionAbbreviation: c.passage.versionAbbreviation ?? null,
                  versionId: c.passage.versionId,
                  versionTitle: c.passage.versionTitle ?? null,
                }
              : null,
        }
      })
      .filter((c): c is WatchBibleCitation => c != null),
  }
}

// Used by resolveSlugPage's video-template branch to fetch a route video
// record for the slug-based watch URL. The locale param threads into the
// fragment's `locales(locale:)` arg so the response only carries the
// active locale's title/description/snippet/imageAlt.
async function getVideoBySlug(
  locale: string,
  slug: string,
): Promise<WatchVideoRecord | null> {
  return fetchWatchVideoRecord("", slug, locale, null)
}

// Route-synthesis variant picker: no URL locale to honor, so only Tier 3
// (primary language by coreId) and Tier 4 (first playable) apply. Used by
// `normalizeRouteVideo` to synthesize a relatable item from a collection
// child without a per-request locale. URL-bearing call sites (the two-seg
// and three-seg watch routes) use `selectPlayableVariant` below, which
// accepts a locale and applies the full 4-tier chain.
function selectPlayableVariantForRouteSynth(video: WatchVideoRecord) {
  const playableVariants = video.variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )
  if (!playableVariants.length) return null

  const primaryLanguageId = video.primaryLanguage?.coreId ?? null
  if (primaryLanguageId) {
    const primaryVariant = playableVariants.find(
      (variant) => variant.language?.coreId === primaryLanguageId,
    )
    if (primaryVariant) return primaryVariant
  }

  return playableVariants[0] ?? null
}

function normalizeRelatedRouteItems(
  video: WatchVideoRecord,
): EnrichedMediaItem[] {
  const selfDocumentId = video.documentId
  const selfSlug = video.slug ?? null

  return video.children
    .filter((child) => {
      if (child.documentId === selfDocumentId) return false
      if (selfSlug && child.slug === selfSlug) return false
      return true
    })
    .map((child) =>
      enrichRouteRelatedVideo({
        documentId: child.documentId,
        title: child.title,
        slug: child.slug,
        label: child.label,
        muxPlaybackId: child.muxPlaybackId,
        images: child.images.map((img) => ({
          url: img.url,
          blurDataUrl: img.blurDataUrl,
          dominantColor: img.dominantColor,
        })),
      }),
    )
    .filter((item): item is EnrichedMediaItem => item != null)
    .slice(0, 24)
}

function normalizeRouteVideo(video: WatchVideoRecord): RouteVideo | null {
  const selectedVariant = selectPlayableVariantForRouteSynth(video)
  if (!selectedVariant?.hls) return null

  return {
    documentId: video.documentId,
    slug: video.slug ?? "",
    title: video.title ?? "",
    snippet: video.snippet ?? null,
    description: video.description ?? null,
    searchTitle: video.searchTitle,
    searchDescription: video.searchDescription,
    socialImage: video.socialImage,
    noIndex: video.noIndex ?? false,
    imageUrl: video.images?.[0]?.url ?? null,
    imageAlt: video.imageAlt ?? null,
    streamingUrl: selectedVariant.hls ?? null,
    relatedItems: normalizeRelatedRouteItems(video),
  }
}

async function resolveHomepage(
  locale: string,
): Promise<ResolvedWatchPage | null> {
  const settings = await getWatchSettings(locale)
  const homepageExperience = settings?.homepageExperience ?? null
  if (!homepageExperience) return null
  // Admin's PUBLIC contract guarantees `homepageExperience` is the
  // resolved homepage locale row; `isTemplate` is stripped on PUBLIC so
  // a misconfig can't reach this code path through ABAC.
  return {
    kind: "experience",
    experience: homepageExperience,
  }
}

async function resolveSlugPage(
  locale: string,
  slug: string,
): Promise<ResolvedWatchPage | null> {
  const settings = await getWatchSettings(locale)
  // Lowercase both sides of the template-slug comparison. Editors can save
  // `defaultTemplateExperience.slug` as `Single-Video` while users hit
  // `/single-video`; byte-equality would silently mis-route the request.
  const templateSlug =
    settings?.defaultTemplateExperience?.slug?.toLowerCase() ?? null

  const routeVideoRecord = await getVideoBySlug(locale, slug)
  if (routeVideoRecord) {
    const templateExperience = settings?.defaultTemplateExperience ?? null
    if (!templateExperience) return null

    const routeVideo = normalizeRouteVideo(routeVideoRecord)
    if (!routeVideo?.streamingUrl) return null

    return {
      kind: "video-template",
      template: templateExperience,
      routeVideo,
    }
  }

  // watchSetting.defaultTemplateExperience is reserved for template
  // rendering, not a public Experience page. Any non-template slug can still
  // fall back to a curated Experience when no route video exists.
  if (slug.toLowerCase() !== templateSlug) {
    const experience = await getExperienceBySlug(locale, slug)
    if (experience) {
      return { kind: "experience", experience }
    }
  }

  return null
}

const fetchResolvedWatchPage = unstable_cache(
  async (
    locale: string,
    slugOrNull: string | null,
  ): Promise<WatchPageResult> => {
    try {
      const resolved =
        slugOrNull === null
          ? await resolveHomepage(locale)
          : await resolveSlugPage(locale, slugOrNull)

      if (!resolved) {
        return { data: null, error: missingExperienceError() }
      }

      return {
        data: JSON.parse(JSON.stringify(resolved)) as ResolvedWatchPage,
        error: null,
      }
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  },
  ["watch-page", "v4-serializable-errors"],
  {
    revalidate: 60,
    tags: [
      WATCH_CACHE_TAGS.home,
      WATCH_CACHE_TAGS.settings,
      WATCH_CACHE_TAGS.experience,
      WATCH_CACHE_TAGS.video,
    ],
  },
)

/** Shared watch-page resolver for page rendering and metadata generation. */
export const resolveWatchPage = cache(
  async (locale: string, slug?: string): Promise<WatchPageResult> => {
    return fetchResolvedWatchPage(locale, slug ?? null)
  },
)

const fetchResolvedWatchExperiencePage = unstable_cache(
  async (locale: string, slug: string): Promise<WatchPageResult> => {
    try {
      const experience = await getExperienceBySlug(locale, slug)
      if (!experience) {
        return { data: null, error: missingExperienceError() }
      }

      return {
        data: JSON.parse(
          JSON.stringify({ kind: "experience", experience }),
        ) as ResolvedWatchPage,
        error: null,
      }
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  },
  ["watch-experience-page"],
  { revalidate: 60, tags: [WATCH_CACHE_TAGS.experience] },
)

/**
 * One-segment collection landings must not fall through to the default video
 * template. Production serves only explicitly curated Experiences at this
 * shape, while single-video slugs such as /watch/jesus.html 404.
 */
export const resolveWatchExperiencePage = cache(
  async (locale: string, slug: string): Promise<WatchPageResult> => {
    return fetchResolvedWatchExperiencePage(locale, slug)
  },
)

// Dedicated watch route resolver

export type WatchVideoErrorCode =
  | "PARENT_NOT_FOUND"
  | "LOCALE_NOT_FOUND"
  | "NO_PLAYABLE_VARIANT"
  | "VIDEO_NOT_FOUND"
  | "INVALID_HERO_PLAYER_BLOCK"

/**
 * Typed error surfaced from `resolveWatchVideo` (and `mergeWatchExperience`)
 * when the requested collection/video/locale combination cannot be rendered,
 * or when an Experience supplies a typed player block targeting the
 * watch-page HeroPlayer slot. The route layer
 * (`apps/web/src/app/[slug]/[video]/[locale]/page.tsx`) re-throws this so the
 * sibling `error.tsx` boundary can map the code to copy.
 *
 * `INVALID_HERO_PLAYER_BLOCK` is thrown by `mergeWatchExperience` and may not
 * have request-scope fields, so collectionSlug/videoSlug/languageSlug are
 * optional and default to empty strings when omitted.
 */
export class WatchVideoError extends Error {
  readonly code: WatchVideoErrorCode
  readonly collectionSlug: string
  readonly videoSlug: string
  readonly languageSlug: string

  constructor(
    code: WatchVideoErrorCode,
    {
      collectionSlug,
      videoSlug,
      languageSlug,
      cause,
      message,
    }: {
      collectionSlug?: string
      videoSlug?: string
      languageSlug?: string
      cause?: unknown
      message?: string
    } = {},
  ) {
    super(message ?? `watch-video:${code}`, cause ? { cause } : undefined)
    this.name = "WatchVideoError"
    this.code = code
    this.collectionSlug = collectionSlug ?? ""
    this.videoSlug = videoSlug ?? ""
    this.languageSlug = languageSlug ?? ""
  }
}

/**
 * Resolved payload for `/watch/[collection]/[video]/[locale]`.
 *
 * The `video` field carries the normalised admin projection;
 * `canonicalParent` and `selectedVariant` are resolver-side picks (URL slug
 * match + language.slug filter) referenced by the same identity inside
 * `video.parents` / `video.variants` so downstream consumers can correlate
 * without a second lookup.
 */
export type ResolvedWatchVideo = {
  video: WatchVideoRecord
  canonicalParent: WatchParent
  selectedVariant: WatchVariant
}

type ResolveWatchVideoArgs = {
  collectionSlug: string
  videoSlug: string
  languageSlug: string
}

function contentIdentityForWatchLanguage(languageSlugOrLocale: string): {
  locale: string
  languageSlug: string | null
} {
  const mappedLocale = slugToBcp47Tag(languageSlugOrLocale)
  const hasExactSlug =
    mappedLocale != null && mappedLocale !== languageSlugOrLocale
  return {
    locale: mappedLocale ?? languageSlugOrLocale,
    languageSlug: hasExactSlug ? languageSlugOrLocale : null,
  }
}

function hasItems<T>(items: readonly T[] | null | undefined): boolean {
  return (items?.length ?? 0) > 0
}

function nonBlankText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function humanizeContentSlug(slug: string | null | undefined): string | null {
  const words = slug
    ?.trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  return words && words.length > 0 ? words.join(" ") : null
}

function firstNonBlankLocaleTitle(
  locales: readonly AdminLocaleRaw[] | null | undefined,
): string | null {
  for (const locale of locales ?? []) {
    const title = nonBlankText(locale.title)
    if (title) return title
  }
  return null
}

function mergeLocaleTitleFallback(
  localized: readonly AdminLocaleRaw[] | null | undefined,
  fallback: readonly AdminLocaleRaw[] | null | undefined,
): AdminLocaleRaw[] {
  const localizedRows = [...(localized ?? [])]
  if (firstNonBlankLocaleTitle(localizedRows)) return localizedRows
  return [...localizedRows, ...(fallback ?? [])]
}

type ChildRelationWithLocales = {
  order?: number | null
  child:
    | ({
        documentId: string | null
        locales?: readonly AdminLocaleRaw[] | null
      } & Record<string, unknown>)
    | null
}

function mergeChildRelationLocales<
  T extends readonly ChildRelationWithLocales[] | null | undefined,
>(relations: T, fallbackRelations: T): T {
  const fallbackByChildId = new Map(
    (fallbackRelations ?? []).flatMap((relation) => {
      const id = relation.child?.documentId
      return id ? [[id, relation] as const] : []
    }),
  )

  return (relations ?? []).map((relation) => {
    const child = relation.child
    const fallbackChild = child?.documentId
      ? fallbackByChildId.get(child.documentId)?.child
      : null
    if (!child || !fallbackChild) return relation
    return {
      ...relation,
      child: {
        ...child,
        locales: mergeLocaleTitleFallback(child.locales, fallbackChild.locales),
      },
    }
  }) as unknown as T
}

function mergeParentRelationLocales(
  relations: AdminVideoLocalizedCopyRaw["parents"],
  fallbackRelations: AdminVideoLocalizedCopyRaw["parents"],
): AdminVideoLocalizedCopyRaw["parents"] {
  const fallbackByParentId = new Map(
    (fallbackRelations ?? []).flatMap((relation) => {
      const id = relation.parent?.documentId
      return id ? [[id, relation] as const] : []
    }),
  )

  return (relations ?? []).map((relation) => {
    const parent = relation.parent
    const fallbackParent = parent?.documentId
      ? fallbackByParentId.get(parent.documentId)?.parent
      : null
    if (!parent || !fallbackParent) return relation

    return {
      ...relation,
      parent: {
        ...parent,
        locales: mergeLocaleTitleFallback(
          parent.locales,
          fallbackParent.locales,
        ),
        children: mergeChildRelationLocales(
          parent.children,
          fallbackParent.children,
        ),
      },
    }
  }) as AdminVideoLocalizedCopyRaw["parents"]
}

function mergeContentFallback(
  localized: AdminVideoLocalizedCopyRaw,
  fallback: AdminVideoLocalizedCopyRaw,
): AdminVideoLocalizedCopyRaw {
  return {
    ...localized,
    locales: mergeLocaleTitleFallback(localized.locales, fallback.locales),
    studyQuestions: hasItems(localized.studyQuestions)
      ? localized.studyQuestions
      : fallback.studyQuestions,
    parents: mergeParentRelationLocales(localized.parents, fallback.parents),
    children: mergeChildRelationLocales(localized.children, fallback.children),
  } as AdminVideoLocalizedCopyRaw
}

function childRelationLocalesMissing(
  relations: readonly ChildRelationWithLocales[] | null | undefined,
): boolean {
  return (relations ?? []).some(
    (relation) =>
      relation.child != null &&
      firstNonBlankLocaleTitle(relation.child.locales) == null,
  )
}

function parentRelationLocalesMissing(
  relations: AdminVideoLocalizedCopyRaw["parents"],
): boolean {
  return (relations ?? []).some((relation) => {
    const parent = relation.parent
    if (!parent) return false
    return (
      firstNonBlankLocaleTitle(parent.locales) == null ||
      childRelationLocalesMissing(parent.children)
    )
  })
}

function needsContentFallback(raw: AdminVideoLocalizedCopyRaw): boolean {
  return (
    firstNonBlankLocaleTitle(raw.locales) == null ||
    !hasItems(raw.studyQuestions) ||
    parentRelationLocalesMissing(raw.parents) ||
    childRelationLocalesMissing(raw.children)
  )
}

function snapshotLocalesForLayer(
  node: AdminVideoRouteSnapshotAliases | null | undefined,
  layer: AdminVideoRouteSnapshotCopyLayer,
): AdminLocaleRaw[] {
  if (!node) return []
  const legacyLocales = (node as { locales?: AdminLocaleRaw[] | null }).locales
  let locales: AdminLocaleRaw[]
  switch (layer) {
    case "exact":
      locales = node.exactLocales ?? legacyLocales ?? []
      break
    case "broad":
      locales = node.broadLocales ?? []
      break
    case "english":
      locales = node.englishLocales ?? []
      break
  }
  return locales
}

function snapshotStudyQuestionsForLayer(
  node: AdminVideoRouteSnapshotStudyQuestionAliases,
  layer: AdminVideoRouteSnapshotCopyLayer,
): AdminStudyQuestionRaw[] {
  const legacyStudyQuestions = (
    node as { studyQuestions?: AdminStudyQuestionRaw[] | null }
  ).studyQuestions
  switch (layer) {
    case "exact":
      return node.exactStudyQuestions ?? legacyStudyQuestions ?? []
    case "broad":
      return node.broadStudyQuestions ?? []
    case "english":
      return node.englishStudyQuestions ?? []
  }
}

function snapshotChildRelationsForLayer(
  relations: AdminVideoRouteSnapshotChildRelation[] | null | undefined,
  layer: AdminVideoRouteSnapshotCopyLayer,
): AdminVideoLocalizedCopyRaw["children"] {
  return (relations ?? []).map((relation) => ({
    ...relation,
    child: relation.child
      ? {
          ...relation.child,
          locales: snapshotLocalesForLayer(relation.child, layer),
        }
      : null,
  })) as AdminVideoLocalizedCopyRaw["children"]
}

function snapshotParentRelationsForLayer(
  relations: AdminVideoRouteSnapshotParentRelation[] | null | undefined,
  layer: AdminVideoRouteSnapshotCopyLayer,
): AdminVideoLocalizedCopyRaw["parents"] {
  return (relations ?? []).map((relation) => ({
    parent: relation.parent
      ? {
          ...relation.parent,
          locales: snapshotLocalesForLayer(relation.parent, layer),
          children: snapshotChildRelationsForLayer(
            relation.parent.children,
            layer,
          ),
        }
      : null,
  })) as AdminVideoLocalizedCopyRaw["parents"]
}

function snapshotCopyForLayer(
  snapshot: AdminVideoRouteSnapshotRaw,
  layer: AdminVideoRouteSnapshotCopyLayer,
): AdminVideoLocalizedCopyRaw {
  return {
    ...snapshot,
    locales: snapshotLocalesForLayer(snapshot, layer),
    parents: snapshotParentRelationsForLayer(snapshot.parents, layer),
    children: snapshotChildRelationsForLayer(snapshot.children, layer),
    studyQuestions: snapshotStudyQuestionsForLayer(snapshot, layer),
  } as AdminVideoLocalizedCopyRaw
}

function snapshotLocalizedCopyWithFallback({
  snapshot,
  locale,
  languageSlug,
}: {
  snapshot: AdminVideoRouteSnapshotRaw
  locale: string
  languageSlug: string | null
}): AdminVideoLocalizedCopyRaw {
  let merged = snapshotCopyForLayer(snapshot, "exact")

  if (languageSlug != null && needsContentFallback(merged)) {
    merged = mergeContentFallback(
      merged,
      snapshotCopyForLayer(snapshot, "broad"),
    )
  }

  if (locale !== "en" && needsContentFallback(merged)) {
    merged = mergeContentFallback(
      merged,
      snapshotCopyForLayer(snapshot, "english"),
    )
  }

  return merged
}

async function queryWatchLanguagePickerVariantsBySlug(
  videoSlug: string,
): Promise<AdminLanguagePickerVideoRaw | null> {
  const result = await client.query({
    query: getWatchLanguagePickerVariantsBySlugOperation,
    variables: { videoSlug },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return result.data?.videoBySlug ?? null
}

async function queryWatchVideoRouteSnapshotBySlug(
  videoSlug: string,
  variables: {
    locale: string
    languageSlug: string | null
    subtitleLanguageSlug?: string | null
  },
): Promise<AdminVideoRouteSnapshotRaw | null> {
  const result = await client.query({
    query: getWatchVideoRouteSnapshotBySlugOperation,
    variables: {
      locale: variables.locale,
      languageSlug: variables.languageSlug,
      ...(variables.subtitleLanguageSlug
        ? { subtitleLanguageSlug: variables.subtitleLanguageSlug }
        : {}),
      videoSlug,
    },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  const data = result.data as
    | {
        watchVideoRouteSnapshotBySlug?: unknown
        videoBySlug?: unknown
      }
    | null
    | undefined

  return (data?.watchVideoRouteSnapshotBySlug ??
    data?.videoBySlug ??
    null) as unknown as AdminVideoRouteSnapshotRaw | null
}

async function queryWatchVideoDubDetail(
  dubId: string,
): Promise<AdminVideoDubDetailRaw | null> {
  const result = await client.query({
    query: getWatchVideoDubDetailOperation,
    variables: { id: dubId },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return result.data?.videoDub ?? null
}

const fetchWatchLanguagePickerVariants = unstable_cache(
  queryWatchLanguagePickerVariantsBySlug,
  ["watch-language-picker-variants"],
  { revalidate: 60, tags: [WATCH_CACHE_TAGS.video] },
)

const fetchWatchVideoRouteSnapshot = unstable_cache(
  queryWatchVideoRouteSnapshotBySlug,
  ["watch-video-route-snapshot"],
  { revalidate: 60, tags: [WATCH_CACHE_TAGS.video] },
)

const fetchWatchVideoDubDetail = unstable_cache(
  queryWatchVideoDubDetail,
  ["watch-video-dub-detail"],
  { revalidate: 60, tags: [WATCH_CACHE_TAGS.video] },
)

function isPlayableWatchVariant(variant: WatchVariant): boolean {
  return variant.published === true && Boolean(variant.hls)
}

function countPlayableWatchVariants(variants: WatchVariant[]): number {
  return variants.filter(isPlayableWatchVariant).length
}

export const resolveWatchLanguagePickerVariants = cache(
  async (videoSlug: string): Promise<WatchLanguagePickerVariant[]> => {
    const shell = await fetchWatchLanguagePickerVariants(videoSlug)
    if (!shell) return []

    const seenLanguageSlugs = new Set<string>()
    return (shell.variants ?? [])
      .map(normalizeVariant)
      .filter((variant): variant is WatchVariant => variant != null)
      .filter((variant) => {
        if (!isPlayableWatchVariant(variant)) return false
        const slug = variant.language?.slug
        if (!slug) return false
        if (seenLanguageSlugs.has(slug)) return false
        seenLanguageSlugs.add(slug)
        return true
      })
      .map((variant) => ({
        documentId: variant.documentId,
        hls: variant.hls,
        published: variant.published,
        language: variant.language,
        videoEdition: null,
      }))
  },
)

export type WatchUnavailableRecoveryTarget = {
  contentTitle: string | null
  imageUrl: string | null
}

export const resolveWatchUnavailableRecoveryTarget = cache(
  async (
    videoSlug: string,
    requestedLanguageSlug: string,
  ): Promise<WatchUnavailableRecoveryTarget | null> => {
    const identity = contentIdentityForWatchLanguage(requestedLanguageSlug)
    const snapshot = await fetchWatchVideoRouteSnapshot(videoSlug, identity)
    if (!snapshot) return null

    const localizedCopy = snapshotLocalizedCopyWithFallback({
      snapshot,
      locale: identity.locale,
      languageSlug: identity.languageSlug,
    })
    const video = normalizeAdminVideo(localizedCopy)
    if (!video) return null

    return {
      contentTitle: video.title,
      imageUrl: resolvePosterUrl(video.images[0]),
    }
  },
)

function mergeChildShellAndCopy(
  child: AdminChildRelationRaw["child"],
  copyChild: ChildRelationWithLocales["child"] | null | undefined,
): AdminChildRelationRaw["child"] {
  if (!child) return child
  return {
    ...child,
    locales: (copyChild?.locales as AdminLocaleRaw[] | null | undefined) ?? [],
  }
}

function mergeChildRelationsShellAndCopy(
  relations:
    | readonly ({ child: AdminChildRelationRaw["child"] } | null)[]
    | null
    | undefined,
  copyRelations:
    | readonly ({ child: ChildRelationWithLocales["child"] } | null)[]
    | null
    | undefined,
): AdminChildRelationRaw[] {
  const copyByChildId = new Map(
    (copyRelations ?? []).flatMap((relation) => {
      if (!relation) return []
      const id = relation.child?.documentId
      return id ? [[id, relation] as const] : []
    }),
  )

  return (relations ?? []).flatMap((relation) => {
    if (!relation) return []
    const child = relation.child
    return [
      {
        ...relation,
        child: mergeChildShellAndCopy(
          child as AdminChildRelationRaw["child"],
          child?.documentId ? copyByChildId.get(child.documentId)?.child : null,
        ),
      },
    ]
  })
}

function mergeParentRelationsShellAndCopy(
  relations: AdminVideoRaw["parents"],
  copyRelations: AdminVideoLocalizedCopyRaw["parents"] | undefined,
): AdminParentRelationRaw[] {
  const copyByParentId = new Map(
    (copyRelations ?? []).flatMap((relation) => {
      const id = relation.parent?.documentId
      return id ? [[id, relation] as const] : []
    }),
  )

  return (relations ?? []).map((relation) => {
    const parent = relation.parent
    const copyParent = parent?.documentId
      ? copyByParentId.get(parent.documentId)?.parent
      : null
    return {
      ...relation,
      parent: parent
        ? {
            ...parent,
            locales:
              (copyParent?.locales as AdminLocaleRaw[] | null | undefined) ??
              [],
            children: mergeChildRelationsShellAndCopy(
              parent.children,
              copyParent?.children,
            ),
          }
        : null,
    }
  })
}

function mergeWatchVideoShellWithCopy(
  shell: AdminVideoRaw & {
    preferredVariant?: AdminVideoVariantRaw | null
    playableDubLanguageCount?: number | null
    variants?: AdminVideoVariantRaw[] | null
  },
  copy: AdminVideoLocalizedCopyRaw | null,
): AdminVideoRaw {
  return {
    ...shell,
    locales: (copy?.locales as AdminLocaleRaw[] | null | undefined) ?? [],
    parents: mergeParentRelationsShellAndCopy(shell.parents, copy?.parents),
    children: mergeChildRelationsShellAndCopy(shell.children, copy?.children),
    playableDubLanguageCount: shell.playableDubLanguageCount ?? null,
    variants: (shell.preferredVariant
      ? [shell.preferredVariant]
      : (shell.variants ?? [])
    ).map((variant) => ({
      ...variant,
      downloads: [],
      muxVideo: null,
      videoEdition: null,
    })),
    studyQuestions:
      (copy?.studyQuestions as AdminStudyQuestionRaw[] | null | undefined) ??
      [],
  } as AdminVideoRaw
}

async function hydrateSelectedVariant(
  record: WatchVideoRecord,
  selectedVariant: WatchVariant,
): Promise<{
  record: WatchVideoRecord
  selectedVariant: WatchVariant
}> {
  let detail: AdminVideoDubDetailRaw | null
  try {
    detail = await fetchWatchVideoDubDetail(selectedVariant.documentId)
  } catch (error) {
    logWatchServerEvent("watch_video_dub_detail.hydration_failed", {
      videoSlug: record.slug,
      variantId: selectedVariant.documentId,
      languageSlug: selectedVariant.language?.slug ?? null,
      detail: error instanceof Error ? error : String(error),
    })
    return { record, selectedVariant }
  }
  const hydratedVariant = detail
    ? normalizeVariant(detail as AdminVideoVariantRaw)
    : null
  if (!hydratedVariant) return { record, selectedVariant }

  const variants = record.variants.map((variant) =>
    variant.documentId === selectedVariant.documentId
      ? hydratedVariant
      : variant,
  )
  const hydratedRecord = {
    ...record,
    variants,
    subtitles: normalizeSubtitlesFromVariants(variants, record.documentId),
  }
  return {
    record: hydratedRecord,
    selectedVariant: hydratedVariant,
  }
}

async function fetchWatchVideoRecord(
  collectionSlug: string,
  videoSlug: string,
  contentLocale: string,
  languageSlug: string | null,
  subtitleLanguageSlug: string | null = null,
): Promise<WatchVideoRecord | null> {
  const snapshot = await fetchWatchVideoRouteSnapshot(videoSlug, {
    locale: contentLocale,
    languageSlug,
    subtitleLanguageSlug,
  })
  if (!snapshot) return null

  const copy = snapshotLocalizedCopyWithFallback({
    snapshot,
    locale: contentLocale,
    languageSlug,
  })
  const raw = mergeWatchVideoShellWithCopy(snapshot, copy)
  // Admin's `videoBySlug` resolves by slug only; the resolver enforces the
  // collection-slug match by walking `parents`. Returning the full record
  // and letting `tryResolveWatchVideo` decide keeps the not-found branch
  // (returns null) separate from the parent-mismatch branch (throws
  // PARENT_NOT_FOUND).
  void collectionSlug
  const normalized = normalizeAdminVideo(raw)
  return normalized
}

// Strip the heavy fields (`downloads`, `muxVideo`, `videoEdition`) from every
// variant in `record.variants` *except* the one matching `selectedDocumentId`.
// Each non-selected variant retains documentId, slug, published, hls, and
// language only — enough to power the language picker and the URL/locale
// guards without shipping per-quality download metadata OR per-variant
// subtitle lists × 2,200+ variants. The page-level subtitle list is sourced
// separately (`normalizeSubtitles` reads variant[0]) and the language picker
// reads the top-level `subtitles` prop, so dropping per-variant `videoEdition`
// on non-selected variants is invisible to consumers. Leaving subtitles on
// every variant inflated JESUS's resolved payload by ~10MB — over Next's
// unstable_cache 2MB limit.
//
// Runtime-only narrowing: the `WatchVideoRecord` type still claims those
// fields are present on every variant, so the stripped objects keep the
// same shape with empty `downloads: []`, `muxVideo: null`, `videoEdition: null`.
function stripNonSelectedVariantFields(
  record: WatchVideoRecord,
  selectedDocumentId: string | null,
): WatchVideoRecord {
  if (!record.variants.length) return record
  const variants = record.variants.map((variant) => {
    if (variant.documentId === selectedDocumentId) return variant
    return {
      ...variant,
      downloads: [] as WatchVariantDownload[],
      muxVideo: null,
      videoEdition: null,
    }
  })
  return { ...record, variants }
}

async function tryResolveWatchVideo(
  collectionSlug: string,
  videoSlug: string,
  languageSlug: string,
): Promise<ResolvedWatchVideo> {
  const contentIdentity = contentIdentityForWatchLanguage(languageSlug)
  const record = await fetchWatchVideoRecord(
    collectionSlug,
    videoSlug,
    contentIdentity.locale,
    contentIdentity.languageSlug,
  )
  if (!record) {
    throw new WatchVideoError("VIDEO_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const canonicalParent =
    record.parents.find((parent) => parent.slug === collectionSlug) ?? null
  if (!canonicalParent) {
    throw new WatchVideoError("PARENT_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const playableVariants = record.variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )

  const selectedVariant =
    playableVariants.find(
      (variant) => variant.language?.slug === languageSlug,
    ) ?? null

  if (!selectedVariant) {
    // Distinguish "language not in this video" vs. "no playable variant at
    // all" so the error boundary can show a useful English-fallback link.
    const matchedLanguageVariant = record.variants.find(
      (variant) => variant.language?.slug === languageSlug,
    )
    if (!playableVariants.length) {
      throw new WatchVideoError("NO_PLAYABLE_VARIANT", {
        collectionSlug,
        videoSlug,
        languageSlug,
      })
    }
    // Either the requested language has a variant but it's unpublished or
    // missing HLS, or the language is absent entirely. Both surface as
    // LOCALE_NOT_FOUND — error.tsx handles fallback link.
    void matchedLanguageVariant
    throw new WatchVideoError("LOCALE_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const hydrated = await hydrateSelectedVariant(record, selectedVariant)
  const narrowedRecord = stripNonSelectedVariantFields(
    hydrated.record,
    selectedVariant.documentId,
  )

  const resolved: ResolvedWatchVideo = {
    video: narrowedRecord,
    canonicalParent,
    selectedVariant: hydrated.selectedVariant,
  }

  // Match resolveWatchPage's plain-data normalization so the result is safe
  // to serialize across the RSC boundary.
  return JSON.parse(JSON.stringify(resolved)) as ResolvedWatchVideo
}

const fetchResolvedWatchVideo = unstable_cache(
  tryResolveWatchVideo,
  ["watch-video"],
  { revalidate: 60, tags: [WATCH_CACHE_TAGS.video] },
)

/**
 * Resolve the dedicated watch-page payload for `/watch/[collection]/[video]/[locale]`.
 *
 * Throws `WatchVideoError` with a typed `code` when the request cannot be
 * rendered. The caller (server component or `generateMetadata`) decides how
 * to surface that — typically by re-throwing for `error.tsx` to map.
 */
export const resolveWatchVideo = cache(
  async ({
    collectionSlug,
    videoSlug,
    languageSlug,
  }: ResolveWatchVideoArgs): Promise<ResolvedWatchVideo> => {
    return fetchResolvedWatchVideo(collectionSlug, videoSlug, languageSlug)
  },
)

// canonicalParent is null when the video has no parent (2-segment URL has no
// collection slug — picks parents[0] as canonical, or null if parents empty).
export type ResolvedWatchVideoBySlug = {
  video: WatchVideoRecord
  canonicalParent: WatchParent | null
  selectedVariant: WatchVariant
}

// React `cache()`-wrapped so that resolveWatchVideoBySlug and
// resolveSeriesBySlug, which both delegate to this fetch, dedupe to a
// single HTTP round-trip within one RSC render pass. unstable_cache around
// the outer resolvers does NOT dedupe across them — each resolver has its
// own cache-key namespace, so the deduplication has to live at the inner
// fetch instead.
const fetchWatchVideoBySlug = cache(
  async (
    videoSlug: string,
    languageSlug: string,
    subtitleLanguageSlug: string | null = null,
  ): Promise<WatchVideoRecord | null> => {
    const contentIdentity = contentIdentityForWatchLanguage(languageSlug)
    return fetchWatchVideoRecord(
      "",
      videoSlug,
      contentIdentity.locale,
      contentIdentity.languageSlug,
      subtitleLanguageSlug,
    )
  },
)

// How long the series-page language union is cached (seconds). The set of
// languages a series is dubbed into changes only when a new dub is published
// — far rarer than the title/episode edits the 60 s series-content cache
// targets — so it gets its own longer-lived cache. Caps the per-language
// DISTINCT-ON scan on heavy collections (Jesus film: ~137k dub rows) to once
// an hour instead of once a minute.
const CHILD_DUB_LANGUAGES_REVALIDATE_SECONDS = 60 * 60

// Series-only fetch for the cross-episode language picker. Kept separate from
// fetchWatchVideoBySlug (and out of the WatchVideo fragment) so the watch page
// never pays for it: admin aggregates the distinct playable dub languages
// across children via DISTINCT ON, bounded by the language union (~2,200 for
// the Jesus film), not children × dubs (~137k). Each entry is server-
// guaranteed playable and carries only display fields.
//
// `unstable_cache` (not React `cache()`) so the result is cached cross-request
// at its own long TTL — invoked from resolveSeriesBySlug as a SIBLING of the
// 60 s series-content cache, never nested inside it.
const fetchVideoChildDubLanguages = unstable_cache(
  async (videoSlug: string): Promise<WatchChildLanguage[]> => {
    const result = await client.query({
      query: getVideoChildDubLanguagesBySlugOperation,
      variables: { videoSlug },
      fetchPolicy: "no-cache",
    })

    const error = graphqlError(
      result as { error?: ErrorLike; errors?: unknown[] },
    )
    if (error) throw error

    return (result.data?.videoBySlug?.childDubLanguages ?? [])
      .map(normalizeChildDubLanguage)
      .filter((v): v is WatchChildLanguage => v != null)
  },
  ["video-child-dub-languages"],
  {
    revalidate: CHILD_DUB_LANGUAGES_REVALIDATE_SECONDS,
    tags: [WATCH_CACHE_TAGS.childDubLanguages],
  },
)

const WATCH_ROUTE_BY_SLUG_NOT_FOUND = "watch-route-by-slug:NOT_FOUND"

/**
 * Pick the best playable variant for a (locale, primaryLanguageId) pair.
 * Caller pre-filters `playableVariants` to (published + hls). Priority chain:
 *
 *   Tier 1: variant.language.slug === locale (e.g. "spanish-castilian")
 *   Tier 2: variant.language.bcp47 === locale (e.g. "en", "pt-BR")
 *   Tier 3: variant.language.coreId === primaryLanguageId (video's primary)
 *   Tier 4: first playable variant
 *
 * Returns null only when `playableVariants` is empty.
 *
 * Shared by video, series, and three-segment episode route resolution so the
 * four-tier priority stays in one place. See docs/solutions/logic-errors/
 * strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md for the
 * bug class this contract prevents.
 */
export function selectPlayableVariant(
  playableVariants: WatchVariant[],
  locale: string,
  primaryLanguageId: string | null,
): WatchVariant | null {
  if (!playableVariants.length) return null
  const localeMatch =
    playableVariants.find((variant) => variant.language?.slug === locale) ??
    playableVariants.find((variant) => variant.language?.bcp47 === locale)
  const primaryMatch = primaryLanguageId
    ? playableVariants.find(
        (variant) => variant.language?.coreId === primaryLanguageId,
      )
    : null
  return localeMatch ?? primaryMatch ?? playableVariants[0] ?? null
}

function playableVariantsForRecord(record: WatchVideoRecord): WatchVariant[] {
  return record.variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )
}

async function hydrateAndNarrowSelectedVariant(
  record: WatchVideoRecord,
  selectedVariant: WatchVariant,
): Promise<{ record: WatchVideoRecord; selectedVariant: WatchVariant }> {
  const hydrated = await hydrateSelectedVariant(record, selectedVariant)
  return {
    record: stripNonSelectedVariantFields(
      hydrated.record,
      hydrated.selectedVariant.documentId,
    ),
    selectedVariant: hydrated.selectedVariant,
  }
}

export type ResolvedSeriesBySlug = {
  video: WatchVideoRecord
  selectedVariant: WatchVariant | null
}

export type ResolvedWatchRouteBySlug =
  | ({
      kind: "video"
    } & ResolvedWatchVideoBySlug)
  | ({
      kind: "series"
    } & ResolvedSeriesBySlug)
  | { kind: "none" }

type ResolvedWatchRouteBySlugHit = Exclude<
  ResolvedWatchRouteBySlug,
  { kind: "none" }
>

async function tryResolveWatchRouteBySlug(
  videoSlug: string,
  languageSlug: string,
  subtitleLanguageSlug: string | null,
): Promise<ResolvedWatchRouteBySlugHit> {
  const record = await fetchWatchVideoBySlug(
    videoSlug,
    languageSlug,
    subtitleLanguageSlug,
  )
  if (!record) throw new Error(WATCH_ROUTE_BY_SLUG_NOT_FOUND)
  const playableVariants = playableVariantsForRecord(record)
  const selectedVariant = selectPlayableVariant(
    playableVariants,
    languageSlug,
    record.primaryLanguage?.coreId ?? null,
  )

  if (isSeriesRecord(record)) {
    const resolved = selectedVariant
      ? await hydrateAndNarrowSelectedVariant(record, selectedVariant)
      : { record, selectedVariant: null }

    return JSON.parse(
      JSON.stringify({
        kind: "series",
        video: resolved.record,
        selectedVariant: resolved.selectedVariant,
      }),
    ) as ResolvedWatchRouteBySlugHit
  }

  if (!selectedVariant) throw new Error(WATCH_ROUTE_BY_SLUG_NOT_FOUND)

  const resolved = await hydrateAndNarrowSelectedVariant(
    record,
    selectedVariant,
  )
  return JSON.parse(
    JSON.stringify({
      kind: "video",
      video: resolved.record,
      canonicalParent: record.parents[0] ?? null,
      selectedVariant: resolved.selectedVariant,
    }),
  ) as ResolvedWatchRouteBySlugHit
}

const fetchResolvedWatchRouteBySlug = unstable_cache(
  tryResolveWatchRouteBySlug,
  ["watch-route-by-slug"],
  { revalidate: 60, tags: [WATCH_CACHE_TAGS.series, WATCH_CACHE_TAGS.video] },
)

export const resolveWatchRouteBySlug = cache(
  async (
    videoSlug: string,
    locale: string,
    subtitleLanguageSlug: string | null = null,
  ): Promise<ResolvedWatchRouteBySlug> => {
    let resolved: ResolvedWatchRouteBySlugHit
    try {
      resolved = await fetchResolvedWatchRouteBySlug(
        videoSlug,
        locale,
        subtitleLanguageSlug,
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === WATCH_ROUTE_BY_SLUG_NOT_FOUND
      ) {
        return { kind: "none" }
      }
      throw error
    }

    if (resolved.kind !== "series") return resolved

    const childDubLanguages = await fetchVideoChildDubLanguages(videoSlug)
    return {
      ...resolved,
      video: { ...resolved.video, childDubLanguages },
    }
  },
)

// Returns null when the slug doesn't match a record OR the video has no
// playable variant (published + hls). Caller falls through to Experience.
export const resolveWatchVideoBySlug = cache(
  async (
    videoSlug: string,
    locale: string,
    subtitleLanguageSlug: string | null = null,
  ): Promise<ResolvedWatchVideoBySlug | null> => {
    const resolved = await resolveWatchRouteBySlug(
      videoSlug,
      locale,
      subtitleLanguageSlug,
    )
    if (resolved.kind === "video") return resolved
    if (resolved.kind === "series" && resolved.selectedVariant) {
      return {
        video: resolved.video,
        canonicalParent: resolved.video.parents[0] ?? null,
        selectedVariant: resolved.selectedVariant,
      }
    }
    return null
  },
)

/**
 * Find the parent of an episode video whose slug matches `seriesSlug`.
 * Returns null when no parent has that slug — caller treats null as
 * "the requested series isn't this episode's parent" and `notFound()`s.
 * Case-sensitive on the slug per production contract (uppercase slugs 404).
 * Consumed by `resolveSeriesEpisodeBySlug` for the three-segment URL shape.
 */
export function findSeriesParent(
  video: WatchVideoRecord,
  seriesSlug: string,
): WatchParent | null {
  return video.parents.find((parent) => parent.slug === seriesSlug) ?? null
}

/** Result of resolving a three-segment series-episode URL. */
export type ResolvedSeriesEpisodeBySlug = ResolvedWatchVideoBySlug & {
  series: WatchParent
}

/**
 * Resolve a three-segment series-episode URL `/{series}.html/{episode}/{lang}.html`
 * to the playable episode video plus the verified series parent.
 *
 * The episode is fetched via the canonical `resolveWatchVideoBySlug` so the
 * 4-tier locale priority chain and the unstable_cache hit path are shared
 * with the two-segment route. The series segment acts as a context guard:
 * if the requested series slug doesn't appear in the episode's `parents`
 * list, return null and let the route handler `notFound()`. This prevents
 * an inbound URL like `/lumo.html/the-beginning/english.html` from
 * resolving the Jesus-film episode "the-beginning" — different series,
 * different episode by happenstance of shared slug.
 *
 * Returns null when the episode doesn't exist, has no playable variant,
 * or doesn't belong to the requested series.
 */
export const resolveSeriesEpisodeBySlug = cache(
  async (
    seriesSlug: string,
    episodeSlug: string,
    locale: string,
    subtitleLanguageSlug: string | null = null,
  ): Promise<ResolvedSeriesEpisodeBySlug | null> => {
    const resolved = await resolveWatchVideoBySlug(
      episodeSlug,
      locale,
      subtitleLanguageSlug,
    )
    if (!resolved) return null
    const series = findSeriesParent(resolved.video, seriesSlug)
    if (!series) return null
    return { ...resolved, series }
  },
)

// Series-shaped resolver — accepts records that the canonical
// resolveWatchVideoBySlug rejects (no playable variant). Used by the series
// details page when a slug points at a parent record (collection / series).
//
// `isSeriesRecord` is consumed by the Watch route and re-exported here for
// existing server callers. Its client-safe implementation lives in
// watch-content-kind.ts.
// Returns null when the slug doesn't match a record OR the record is not
// series-shaped. Caller falls through to resolveWatchPage / Experience.
export const resolveSeriesBySlug = cache(
  async (
    videoSlug: string,
    locale: string,
  ): Promise<ResolvedSeriesBySlug | null> => {
    const resolved = await resolveWatchRouteBySlug(videoSlug, locale)
    if (resolved.kind !== "series") return null
    return { video: resolved.video, selectedVariant: resolved.selectedVariant }
  },
)

// Hybrid resolver — synthetic watch blocks + per-block-type override merge

/**
 * Synthetic block-type discriminators owned by the watch route. These are NOT
 * admin `__typename` values — they exist purely so `WatchSectionRenderer` can
 * dispatch watch-only components (HeroPlayer, SiblingCarousel, WatchBody,
 * StudyQuestions, BibleQuotes, Share) alongside admin-typed blocks coming
 * out of an optional Experience.
 *
 * The `kind` field is the discriminator. We deliberately avoid `__typename`
 * to make it impossible to confuse a synthetic block with an admin one in
 * the renderer switch.
 */
export type WatchHeroPlayerBlock = {
  kind: "HeroPlayer"
  video: WatchVideoRecord
  variant: WatchVariant
  playableLanguageCount?: number
  audioLanguageCountLabel?: string | null
  subtitleLanguageCountLabel?: string | null
  nextWatchItem?: WatchNextWatchItem | null
}

export type WatchNextWatchItem = {
  parentSlug: string
  slug: string
  title: string | null
  documentId: string
  kind: "chapter" | "episode"
}

/**
 * Structural subtype shared between the canonical-parent and
 * synthesized-from-current-video carousel sources. Captures the exact set
 * of fields the carousel UI reads, so the virtualParent literal in
 * `buildSiblingCarouselBlock` satisfies the type without an `as` cast or
 * a cross-path filter assertion.
 */
export type CarouselParent = {
  documentId: string
  slug: string | null
  title: string | null
  children: WatchChild[]
}

export type WatchSiblingCarouselBlock = {
  kind: "SiblingCarousel"
  canonicalParent: CarouselParent
  currentVideoDocumentId: string
  /** Standalone-only collection choices; omitted for fixed contextual rails. */
  selectableParents?: CarouselParent[]
}

export type WatchBodyBlock = {
  kind: "WatchBody"
  video: WatchVideoRecord
  variant: WatchVariant
}

export type WatchStudyQuestionsBlock = {
  kind: "StudyQuestions"
  studyQuestions: WatchStudyQuestion[]
}

export type WatchBibleQuotesBlock = {
  kind: "BibleQuotes"
  bibleCitations: WatchBibleCitation[]
  passages?: WatchBibleCitationPassage[]
}

export type WatchShareBlock = {
  kind: "Share"
  video: WatchVideoRecord
}

export type WatchBlock =
  | WatchHeroPlayerBlock
  | WatchSiblingCarouselBlock
  | WatchBodyBlock
  | WatchStudyQuestionsBlock
  | WatchBibleQuotesBlock
  | WatchShareBlock

/** Experience-typed block coming from a WatchExperience override (admin shape). */
export type ExperienceBlock = Section

/** Discriminator for entries in the merged watch-block array. */
export type MergedWatchBlock = WatchBlock | ExperienceBlock

/**
 * Admin `__typename` values that mount their own player and would steal
 * Mux Data attribution from the watch-page HeroPlayer. These are rejected
 * at merge time when targeting the HeroPlayer slot.
 */
const PLAYER_BEARING_BLOCK_TYPES = new Set<string>([
  "VideoHeroBlock",
  "VideoBlock",
  "VideoCarouselBlock",
])

const HERO_PLAYER_REJECTION_MESSAGE =
  "HeroPlayer slot accepts only the watch-page Mux Player; use the auto-template HeroPlayer or override a different slot."

// Auto-template builders ------------------------------------------------------

/** Always returns a HeroPlayer block — the page is unrenderable without one. */
export function buildHeroBlock(
  video: WatchVideoRecord,
  variant: WatchVariant,
  canonicalParent: WatchParent | null = null,
): WatchHeroPlayerBlock {
  return {
    kind: "HeroPlayer",
    video,
    variant,
    playableLanguageCount:
      video.playableLanguageCount ?? countPlayableWatchVariants(video.variants),
    audioLanguageCountLabel: null,
    subtitleLanguageCountLabel: null,
    nextWatchItem: buildNextWatchItem(canonicalParent, video),
  }
}

export function buildNextWatchItem(
  canonicalParent: WatchParent | null,
  video: WatchVideoRecord,
): WatchNextWatchItem | null {
  const ownChildren = video.children.filter(
    (child): child is WatchChild & { slug: string } =>
      isPlayableWatchChild(child),
  )
  const currentSlug =
    typeof video.slug === "string" && video.slug.length > 0 ? video.slug : null

  if (ownChildren.length > 0 && currentSlug != null) {
    return nextWatchItemFromChild(currentSlug, ownChildren[0]!)
  }

  if (!canonicalParent?.slug) return null
  const activeIndex = canonicalParent.children.findIndex(
    (child) => child.documentId === video.documentId,
  )
  if (activeIndex < 0 || activeIndex >= canonicalParent.children.length - 1) {
    return null
  }
  const nextChild = canonicalParent.children
    .slice(activeIndex + 1)
    .find(isPlayableWatchChild)
  if (!nextChild) return null

  return nextWatchItemFromChild(canonicalParent.slug, nextChild)
}

function isPlayableWatchChild(
  child: WatchChild,
): child is WatchChild & { slug: string } {
  return (
    child.slug != null &&
    child.slug.length > 0 &&
    child.muxPlaybackId != null &&
    child.muxPlaybackId.length > 0
  )
}

function nextWatchItemFromChild(
  parentSlug: string,
  child: WatchChild & { slug: string },
): WatchNextWatchItem {
  return {
    parentSlug,
    slug: child.slug,
    title: child.title,
    documentId: child.documentId,
    kind:
      child.label === "EPISODE" || child.label === "episode"
        ? "episode"
        : "chapter",
  }
}

/**
 * Returns a carousel block with the most relevant peer set, or null when none
 * is available:
 *
 * 1. When the standalone route supplies eligible selectable parents, use the
 *    first as the default and retain all choices for the client selector.
 * 2. When the current video has its **own** children (a parent / collection
 *    video like JESUS with 61 chapter segments), surface those — the user is
 *    looking at the parent, so chapters are the relevant peers.
 * 3. Otherwise, fall back to the canonical parent's children — the current
 *    video is itself a chapter, and the user wants to navigate between
 *    siblings of the same parent (e.g. between segments of JESUS).
 *
 * Returns null when neither source has at least 2 entries.
 */
export function buildSiblingCarouselBlock(
  canonicalParent: WatchParent | null,
  video: WatchVideoRecord,
  selectableParents: CarouselParent[] = [],
): WatchSiblingCarouselBlock | null {
  if (selectableParents.length > 0) {
    return {
      kind: "SiblingCarousel",
      canonicalParent: selectableParents[0]!,
      currentVideoDocumentId: video.documentId,
      selectableParents,
    }
  }

  const ownChildren = video.children
  if (ownChildren.length >= 2) {
    // Synthesize a virtual parent from the current video so the carousel's
    // header reads correctly ("JESUS · Clip N of M") and so the existing
    // canonicalParent.children consumer in <SiblingCarousel> doesn't need a
    // second branch. `currentVideoDocumentId` won't match any of its own
    // children, so no "Playing now" badge — accurate for a parent-page view.
    const virtualParent: CarouselParent = {
      documentId: video.documentId,
      slug: video.slug ?? "",
      title: video.title ?? "",
      children: ownChildren,
    }
    return {
      kind: "SiblingCarousel",
      canonicalParent: virtualParent,
      currentVideoDocumentId: video.documentId,
    }
  }
  if (!canonicalParent) return null
  const siblings = canonicalParent.children
  if (siblings.length < 2) return null
  return {
    kind: "SiblingCarousel",
    canonicalParent: {
      documentId: canonicalParent.documentId,
      slug: canonicalParent.slug ?? null,
      title: canonicalParent.title ?? null,
      children: siblings,
    },
    currentVideoDocumentId: video.documentId,
  }
}

/** Always returns a WatchBody block — the page always shows title + description. */
export function buildWatchBodyBlock(
  video: WatchVideoRecord,
  variant: WatchVariant,
): WatchBodyBlock {
  return { kind: "WatchBody", video, variant }
}

/** Returns null when the video has no study questions. */
export function buildStudyQuestionsBlock(
  studyQuestions: WatchVideoRecord["studyQuestions"] | null | undefined,
): WatchStudyQuestionsBlock | null {
  const items = (studyQuestions ?? []).filter(
    (q): q is WatchStudyQuestion => q != null,
  )
  if (items.length === 0) return null
  return { kind: "StudyQuestions", studyQuestions: items }
}

/**
 * Always returns a BibleQuotes block — every watch page surfaces the carousel
 * (the trailing "Join Our Bible Study" promo card is the always-on CTA).
 * `bibleCitations` may be empty; the section still renders the promo card.
 */
export function buildBibleQuotesBlock(
  bibleCitations: WatchVideoRecord["bibleCitations"] | null | undefined,
): WatchBibleQuotesBlock {
  const items = (bibleCitations ?? []).filter(
    (c): c is WatchBibleCitation => c != null,
  )
  return {
    kind: "BibleQuotes",
    bibleCitations: items,
    passages: items
      .map((citation) => citation.passage)
      .filter(
        (passage): passage is WatchBibleCitationPassage => passage != null,
      ),
  }
}

/** Always returns a Share block — every video is shareable. */
export function buildShareBlock(video: WatchVideoRecord): WatchShareBlock {
  return { kind: "Share", video }
}

// Slot mapping ----------------------------------------------------------------

/**
 * Slot identifiers for each of the 6 synthetic watch-block positions. Used
 * internally by `mergeWatchExperience` to decide which Experience-supplied
 * block (if any) overrides which auto-template builder.
 */
type WatchSlotKey =
  | "HeroPlayer"
  | "SiblingCarousel"
  | "WatchBody"
  | "StudyQuestions"
  | "BibleQuotes"
  | "Share"

/**
 * Maps an incoming Experience block (synthetic or admin-typed) to the
 * synthetic watch slot it fills, or `null` if the block does not target any
 * of the 6 slots and should pass through to delegated rendering.
 *
 * Slot mapping rules:
 * - Synthetic blocks fill the slot named by their `kind`.
 * - Admin `RelatedQuestionsBlock` → StudyQuestions slot.
 * - Admin `BibleQuotesCarouselBlock` → BibleQuotes slot.
 * - All other admin blocks (PromoBanner, InfoBlocks, Cta, etc.) pass
 *   through and render after the 6 watch slots.
 * - Admin player-bearing blocks (VideoHeroBlock/VideoBlock/VideoCarouselBlock)
 *   explicitly target HeroPlayer slot for the rejection check.
 *
 * Legacy Strapi `__typename` values (`ComponentSections*`) are matched here
 * too so test fixtures and any in-flight data feeding the merge stay
 * recognized — admin replaces the production source but the merge
 * contract stays compatible with the older shape.
 */
function blockSlot(block: MergedWatchBlock): WatchSlotKey | null {
  if ("kind" in block) {
    return block.kind
  }
  const tn = (block as { __typename?: string | null }).__typename
  if (!tn) return null
  if (tn === "RelatedQuestionsBlock") return "StudyQuestions"
  if (tn === "BibleQuotesCarouselBlock") return "BibleQuotes"
  if (PLAYER_BEARING_BLOCK_TYPES.has(tn)) return "HeroPlayer"
  // Strapi-shape compatibility for the merge contract — the renderer
  // dispatches admin __typename values today, but fixtures and legacy
  // call sites may still feed Strapi names. Keeping these mappings in
  // place is a low-cost compatibility shim.
  if (tn === "ComponentSectionsRelatedQuestions") return "StudyQuestions"
  if (tn === "ComponentSectionsBibleQuotesCarousel") return "BibleQuotes"
  if (
    tn === "ComponentSectionsVideoHero" ||
    tn === "ComponentSectionsVideo" ||
    tn === "ComponentSectionsVideoCarousel"
  ) {
    return "HeroPlayer"
  }
  return null
}

export { isWatchBlock } from "@/lib/watch-blocks"

// Merge -----------------------------------------------------------------------

type MergeWatchExperienceArgs = {
  video: WatchVideoRecord
  variant: WatchVariant
  /**
   * Canonical parent for the sibling carousel. May be null when the watch
   * page is hit via the 2-segment URL `/watch/[video]/[locale]` (no
   * collection in the URL) AND the video has no parent at all. When null,
   * the SiblingCarousel slot is omitted from the merged block array.
   */
  canonicalParent: WatchParent | null
  /** Eligible collection choices supplied only by the standalone route. */
  selectableParents?: CarouselParent[]
  /** Optional Experience override — when omitted, all 6 slots auto-template. */
  experience?: WatchExperience | null
}

/**
 * Merge an optional Experience override against the 6 auto-template watch
 * slots, returning the final ordered block array consumed by
 * `WatchSectionRenderer`.
 *
 * Behavior:
 * - For each of the 6 synthetic slots: if the Experience supplies a block
 *   targeting that slot, the override wins; else the slot's auto-template
 *   builder runs. Builders returning `null` (empty data) omit the slot.
 * - HeroPlayer slot is type-restricted: an Experience-supplied player-bearing
 *   block targeting HeroPlayer throws `WatchVideoError('INVALID_HERO_PLAYER_BLOCK')`.
 *   Only synthetic `HeroPlayer` overrides are accepted.
 * - Experience blocks not targeting any of the 6 slots (PromoBanner,
 *   InfoBlocks, Cta, etc.) append after the 6 slots in the order the
 *   Experience supplied them.
 *
 * The returned array order matches the visual watch-page order:
 * HeroPlayer → SiblingCarousel → WatchBody → StudyQuestions → BibleQuotes →
 * Share → ...passthrough Experience blocks.
 */
export function mergeWatchExperience({
  video,
  variant,
  canonicalParent,
  selectableParents,
  experience,
}: MergeWatchExperienceArgs): MergedWatchBlock[] {
  const overrides = new Map<WatchSlotKey, MergedWatchBlock>()
  const passthrough: ExperienceBlock[] = []

  const experienceBlocks = (experience?.blocks ?? []).filter(
    (b): b is ExperienceBlock => b != null,
  )

  for (const block of experienceBlocks) {
    const slot = blockSlot(block)
    if (slot === "HeroPlayer" && !isWatchBlock(block)) {
      // HeroPlayer slot is type-restricted: only synthetic HeroPlayer blocks
      // are accepted. Any Experience-typed player block reaching here is
      // rejected to preserve Mux Data attribution to the watch-page player.
      throw new WatchVideoError("INVALID_HERO_PLAYER_BLOCK", {
        message: HERO_PLAYER_REJECTION_MESSAGE,
      })
    }
    if (slot != null) {
      // Last-write-wins inside Experience for a given slot.
      overrides.set(slot, block)
    } else {
      passthrough.push(block)
    }
  }

  const result: MergedWatchBlock[] = []

  function pushSlot(slot: WatchSlotKey, fallback: MergedWatchBlock | null) {
    const override = overrides.get(slot)
    if (override !== undefined) {
      result.push(override)
      return
    }
    if (fallback !== null) result.push(fallback)
  }

  pushSlot("HeroPlayer", buildHeroBlock(video, variant, canonicalParent))
  pushSlot(
    "SiblingCarousel",
    buildSiblingCarouselBlock(canonicalParent, video, selectableParents),
  )
  pushSlot("WatchBody", buildWatchBodyBlock(video, variant))
  pushSlot("StudyQuestions", buildStudyQuestionsBlock(video.studyQuestions))
  pushSlot("BibleQuotes", buildBibleQuotesBlock(video.bibleCitations))
  pushSlot("Share", buildShareBlock(video))

  for (const block of passthrough) result.push(block)

  return result
}
