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
  getWatchVideoBySlugOperation,
  watchExperienceFragment,
  watchVideoFragment,
} from "@/lib/fragments"

// Keep gql.tada introspection types live for the watch-page fragment.
void watchVideoFragment

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
        ...AdminWatchExperience
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
          ...AdminWatchExperience
        }
        defaultTemplateExperience {
          ...AdminWatchExperience
        }
      }
    }
  `,
  [watchExperienceFragment],
)

type WatchSettingsData = AdminResultOf<typeof GET_WATCH_SETTINGS>
type GetWatchVideoData = AdminResultOf<typeof getWatchVideoBySlugOperation>
type AdminVideoRaw = NonNullable<GetWatchVideoData["videoBySlug"]>

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
}

export type WatchChildVariant = {
  documentId: string
  published: boolean | null
  hls: string | null
  duration: number | null
  language: {
    slug: string | null
    name: string | null
    bcp47: string | null
  } | null
}

export type WatchChild = {
  documentId: string
  slug: string | null
  title: string | null
  label: string | null
  images: WatchImage[]
  variants: WatchChildVariant[]
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
  slug: string | null
  name: string | null
}

export type WatchVariantDownload = {
  documentId: string
  quality: string | null
  size: string | null
  url: string | null
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
  videoEdition?: {
    subtitles: {
      vttSrc: string | null
      srtSrc: string | null
      language: WatchVariantLanguage | null
    }[]
  } | null
}

export type WatchStudyQuestion = {
  documentId: string
  value: string | null
  order: number | null
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
}

export type WatchVideoRecord = {
  documentId: string
  slug: string | null
  title: string | null
  snippet: string | null
  description: string | null
  noIndex: boolean | null
  label: string | null
  imageAlt: string | null
  images: WatchImage[]
  primaryLanguage: { coreId: string | null; bcp47: string | null } | null
  parents: WatchParent[]
  children: WatchChild[]
  variants: WatchVariant[]
  studyQuestions: WatchStudyQuestion[]
  bibleCitations: WatchBibleCitation[]
}

export type RouteVideo = {
  documentId: string
  slug: string
  title: string
  snippet: string | null
  description: string | null
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
// share `getWatchVideoBySlugOperation`; keeps the resolver-visible
// `WatchVideoRecord` shape stable across both call sites.
//
// Admin's `id: ID` is nominally `string | null` at the SDL layer but is
// always non-null in practice (every Prisma row has a generated id). The
// normalisers reject nodes whose `documentId` projects to null so the
// consumer-facing types can stay `string` instead of `string | null` —
// a null id from admin would surface as a dropped row, not a runtime
// crash deep inside the renderer.

type AdminImageRaw = NonNullable<AdminVideoRaw["images"]>[number]

function normalizeImage(img: AdminImageRaw): WatchImage | null {
  if (!img.documentId) return null
  return {
    documentId: img.documentId,
    url: img.url ?? null,
    thumbnail: img.thumbnail ?? null,
    mobileCinematicHigh: img.mobileCinematicHigh ?? null,
    mobileCinematicLow: img.mobileCinematicLow ?? null,
  }
}

function normalizeImages(
  images: AdminVideoRaw["images"] | null | undefined,
): WatchImage[] {
  return (images ?? [])
    .map(normalizeImage)
    .filter((i): i is WatchImage => i != null)
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

function normalizeChildVariant(
  dub: NonNullable<
    NonNullable<NonNullable<AdminVideoRaw["children"]>[number]["child"]>["dubs"]
  >[number],
): WatchChildVariant | null {
  if (!dub.documentId) return null
  return {
    documentId: dub.documentId,
    published: dub.published ?? null,
    hls: dub.hls ?? null,
    duration: dub.duration ?? null,
    language: dub.language
      ? {
          slug: dub.language.slug ?? null,
          name: pickLocalizedName(dub.language.name),
          bcp47: dub.language.bcp47 ?? null,
        }
      : null,
  }
}

function normalizeChild(
  rel: NonNullable<AdminVideoRaw["children"]>[number],
): WatchChild | null {
  const child = rel.child
  if (!child || !child.documentId) return null
  const localeRow = child.locales?.[0] ?? null
  return {
    documentId: child.documentId,
    slug: child.slug ?? null,
    title: localeRow?.title ?? null,
    label: child.label ?? null,
    images: normalizeImages(child.images),
    variants: (child.dubs ?? [])
      .map(normalizeChildVariant)
      .filter((v): v is WatchChildVariant => v != null),
  }
}

function normalizeParent(
  rel: NonNullable<AdminVideoRaw["parents"]>[number],
): WatchParent | null {
  const parent = rel.parent
  if (!parent || !parent.documentId) return null
  const localeRow = parent.locales?.[0] ?? null
  return {
    documentId: parent.documentId,
    slug: parent.slug ?? null,
    title: localeRow?.title ?? null,
    noIndex: parent.noIndex ?? null,
    label: parent.label ?? null,
    images: normalizeImages(parent.images),
    children: (parent.children ?? [])
      .map((childRel): WatchChild | null => {
        const c = childRel.child
        if (!c || !c.documentId) return null
        const cLocale = c.locales?.[0] ?? null
        return {
          documentId: c.documentId,
          slug: c.slug ?? null,
          title: cLocale?.title ?? null,
          label: c.label ?? null,
          images: normalizeImages(c.images),
          // Nested children inside `parent.children` don't project variants
          // in the fragment (we only need them on top-level `children` for
          // the SiblingCarousel's language aggregator). Surface as empty.
          variants: [],
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
          slug: v.language.slug ?? null,
          name: pickLocalizedName(v.language.name),
        }
      : null,
    downloads: (v.downloads ?? [])
      .map((d): WatchVariantDownload | null => {
        if (!d.documentId) return null
        return {
          documentId: d.documentId,
          quality: d.quality ?? null,
          size: d.size ?? null,
          url: d.url ?? null,
        }
      })
      .filter((d): d is WatchVariantDownload => d != null),
    muxVideo: v.muxVideo ? { playbackId: v.muxVideo.playbackId ?? null } : null,
    videoEdition: v.videoEdition
      ? {
          subtitles: (v.videoEdition.subtitles ?? []).map((subtitle) => ({
            vttSrc: subtitle.vttSrc ?? null,
            srtSrc: subtitle.srtSrc ?? null,
            language: subtitle.language
              ? {
                  coreId: subtitle.language.coreId ?? null,
                  bcp47: null,
                  slug: subtitle.language.slug ?? null,
                  name: pickLocalizedName(subtitle.language.name),
                }
              : null,
          })),
        }
      : null,
  }
}

function normalizeAdminVideo(raw: AdminVideoRaw): WatchVideoRecord | null {
  if (!raw.documentId) return null
  const localeRow = raw.locales?.[0] ?? null
  return {
    documentId: raw.documentId,
    slug: raw.slug ?? null,
    title: localeRow?.title ?? null,
    snippet: localeRow?.snippet ?? null,
    description: localeRow?.description ?? null,
    noIndex: raw.noIndex ?? null,
    label: raw.label ?? null,
    imageAlt: localeRow?.imageAlt ?? null,
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
    variants: (raw.variants ?? [])
      .map(normalizeVariant)
      .filter((v): v is WatchVariant => v != null),
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
  const result = await client.query({
    query: getWatchVideoBySlugOperation,
    variables: { locale, videoSlug: slug },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  const raw = result.data?.videoBySlug ?? null
  return raw ? normalizeAdminVideo(raw) : null
}

// Wraps `getVideoBySlug`'s null-on-missing semantics inside the
// fetchWatchVideoRecord path so a raw record without a documentId
// surfaces as "not found" rather than a synthetic crash deep in the
// variant picker.
function selectPlayableVariant(video: WatchVideoRecord) {
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
        images: child.images.map((img) => ({ url: img.url })),
      }),
    )
    .filter((item): item is EnrichedMediaItem => item != null)
    .slice(0, 24)
}

function normalizeRouteVideo(video: WatchVideoRecord): RouteVideo | null {
  const selectedVariant = selectPlayableVariant(video)
  if (!selectedVariant?.hls) return null

  return {
    documentId: video.documentId,
    slug: video.slug ?? "",
    title: video.title ?? "",
    snippet: video.snippet ?? null,
    description: video.description ?? null,
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

  // watchSetting.defaultTemplateExperience is the single source of truth for
  // "this slug is the video-template route". Any other slug resolves first
  // as a regular Experience and falls through to a template-rendered video
  // when no Experience matches. Admin's `experienceBySlug` returns only
  // non-template, published locales for PUBLIC callers, so a template hit
  // at this slug naturally falls through to the video branch.
  if (slug.toLowerCase() !== templateSlug) {
    const experience = await getExperienceBySlug(locale, slug)
    if (experience) {
      return { kind: "experience", experience }
    }
  }

  const routeVideoRecord = await getVideoBySlug(locale, slug)
  if (!routeVideoRecord) return null

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
        return { data: null, error: new Error(NO_EXPERIENCE_FOUND_MESSAGE) }
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
  ["watch-page"],
  { revalidate: 60 },
)

/** Shared watch-page resolver for page rendering and metadata generation. */
export const resolveWatchPage = cache(
  async (locale: string, slug?: string): Promise<WatchPageResult> => {
    return fetchResolvedWatchPage(locale, slug ?? null)
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

// Default locale used by the dedicated watch route when fetching the
// video record. The route's URL carries an explicit language slug (per
// the 3-segment shape `/watch/[collection]/[video]/[language]`), so the
// locale here only controls which `VideoLocale` row hydrates the
// title/description/snippet fields — not playback selection.
const WATCH_VIDEO_LOCALE = "en"

async function fetchWatchVideoRecord(
  collectionSlug: string,
  videoSlug: string,
): Promise<WatchVideoRecord | null> {
  const result = await client.query({
    query: getWatchVideoBySlugOperation,
    variables: {
      locale: WATCH_VIDEO_LOCALE,
      videoSlug,
    },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  const raw = result.data?.videoBySlug ?? null
  if (!raw) return null
  // Admin's `videoBySlug` resolves by slug only; the resolver enforces the
  // collection-slug match by walking `parents`. Returning the full record
  // and letting `tryResolveWatchVideo` decide keeps the not-found branch
  // (returns null) separate from the parent-mismatch branch (throws
  // PARENT_NOT_FOUND).
  void collectionSlug
  const normalized = normalizeAdminVideo(raw)
  return normalized
}

// Strip the heavy fields (`downloads`, `muxVideo`) from every variant in
// `record.variants` *except* the one matching `selectedDocumentId`.
// Each non-selected variant retains documentId, slug, published, hls, and
// language only — enough to power the language picker and the URL/locale
// guards without shipping per-quality download metadata × 240+ variants.
//
// Runtime-only narrowing: the `WatchVideoRecord` type still claims those
// fields are present on every variant, so the stripped objects keep the
// same shape with empty `downloads: []` and `muxVideo: null`.
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
    }
  })
  return { ...record, variants }
}

async function tryResolveWatchVideo(
  collectionSlug: string,
  videoSlug: string,
  languageSlug: string,
): Promise<ResolvedWatchVideo> {
  const record = await fetchWatchVideoRecord(collectionSlug, videoSlug)
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

  const narrowedRecord = stripNonSelectedVariantFields(
    record,
    selectedVariant.documentId,
  )

  const resolved: ResolvedWatchVideo = {
    video: narrowedRecord,
    canonicalParent,
    selectedVariant,
  }

  // Match resolveWatchPage's plain-data normalization so the result is safe
  // to serialize across the RSC boundary.
  return JSON.parse(JSON.stringify(resolved)) as ResolvedWatchVideo
}

const fetchResolvedWatchVideo = unstable_cache(
  tryResolveWatchVideo,
  ["watch-video"],
  { revalidate: 60 },
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
    locale: string,
  ): Promise<WatchVideoRecord | null> => {
    const result = await client.query({
      query: getWatchVideoBySlugOperation,
      variables: {
        locale,
        videoSlug,
      },
      fetchPolicy: "no-cache",
    })

    const error = graphqlError(
      result as { error?: ErrorLike; errors?: unknown[] },
    )
    if (error) throw error

    const raw = result.data?.videoBySlug ?? null
    if (!raw) return null

    // Locale-text fallback: admin's `locales(locale:)` arg filters on
    // bcp47 strictly, but URLs use the language slug ("afrikaans" not
    // "af") and many videos don't have a localized VideoLocale row in
    // every requested language. Either case returns an empty `locales[]`
    // — which would render an empty <h1> on the watch page. Re-fetch
    // with "en" when the primary record came back without locale text;
    // the variant chain already handles audio-language selection so
    // the user still gets the right dub, just with English title /
    // description as a graceful fallback.
    if (!raw.locales?.[0] && locale !== "en") {
      const fallback = await client.query({
        query: getWatchVideoBySlugOperation,
        variables: { locale: "en", videoSlug },
        fetchPolicy: "no-cache",
      })
      const fallbackError = graphqlError(
        fallback as { error?: ErrorLike; errors?: unknown[] },
      )
      if (!fallbackError && fallback.data?.videoBySlug?.locales?.[0]) {
        // Use the entire EN-fetched shape, not just top-level `locales`.
        // The fragment applies `locales(locale: $locale)` at every nesting
        // tier (parents, parents.children, etc.); a slug-form locale like
        // "english" matches no BCP-47 row, so all nested `locales[]` come
        // back empty too. Returning the fallback shape fills the sibling
        // carousel + canonical-parent titles in one go. `dubs`, `images`,
        // `parents`, `children` aren't locale-filtered, so the two shapes
        // are byte-equivalent outside the `locales[]` arrays we want.
        return normalizeAdminVideo(fallback.data.videoBySlug)
      }
    }

    return normalizeAdminVideo(raw)
  },
)

// Sentinel thrown by the cached inner so unstable_cache never persists a
// "no playable variant" miss. unstable_cache re-throws on error and does
// NOT cache failures — the outer wrapper catches this sentinel and returns
// null, while real downstream errors propagate as before.
const WATCH_VIDEO_BY_SLUG_NOT_FOUND = "watch-video-by-slug:NOT_FOUND"

async function tryResolveWatchVideoBySlug(
  videoSlug: string,
  locale: string,
): Promise<ResolvedWatchVideoBySlug> {
  const record = await fetchWatchVideoBySlug(videoSlug, locale)
  if (!record) throw new Error(WATCH_VIDEO_BY_SLUG_NOT_FOUND)

  const canonicalParent = record.parents[0] ?? null

  const playableVariants = record.variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )
  if (!playableVariants.length) throw new Error(WATCH_VIDEO_BY_SLUG_NOT_FOUND)

  // Priority: URL locale (slug → bcp47), then primary, then first playable.
  const localeMatch =
    playableVariants.find((variant) => variant.language?.slug === locale) ??
    playableVariants.find((variant) => variant.language?.bcp47 === locale)
  const primaryLanguageId = record.primaryLanguage?.coreId ?? null
  const primaryMatch = primaryLanguageId
    ? playableVariants.find(
        (variant) => variant.language?.coreId === primaryLanguageId,
      )
    : null
  const selectedVariant =
    localeMatch ?? primaryMatch ?? playableVariants[0] ?? null
  if (!selectedVariant) throw new Error(WATCH_VIDEO_BY_SLUG_NOT_FOUND)

  const narrowedRecord = stripNonSelectedVariantFields(
    record,
    selectedVariant.documentId,
  )

  const resolved: ResolvedWatchVideoBySlug = {
    video: narrowedRecord,
    canonicalParent,
    selectedVariant,
  }
  return JSON.parse(JSON.stringify(resolved)) as ResolvedWatchVideoBySlug
}

// Cache wraps only the success path. unstable_cache re-throws errors and does
// NOT cache them, so the NOT_FOUND sentinel naturally bypasses the cache —
// each request re-queries admin until a record exists. This avoids pinning
// a 60s "null" entry in the cache for a record that just hasn't been
// published yet.
const fetchResolvedWatchVideoBySlug = unstable_cache(
  tryResolveWatchVideoBySlug,
  ["watch-video-by-slug"],
  { revalidate: 60 },
)

// Returns null when the slug doesn't match a record OR the video has no
// playable variant (published + hls). Caller falls through to Experience.
export const resolveWatchVideoBySlug = cache(
  async (
    videoSlug: string,
    locale: string,
  ): Promise<ResolvedWatchVideoBySlug | null> => {
    try {
      return await fetchResolvedWatchVideoBySlug(videoSlug, locale)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === WATCH_VIDEO_BY_SLUG_NOT_FOUND
      ) {
        return null
      }
      throw error
    }
  },
)

// Series-shaped resolver — accepts records that the canonical
// resolveWatchVideoBySlug rejects (no playable variant). Used by the series
// details page when a slug points at a parent record (collection / series).
//
// The discriminator is intentionally defensive (case-insensitive label match
// against the known series-shaped enum values, OR null label with children
// present). Admin's `VideoLabel` enum uses uppercase values
// (`COLLECTION`, `SERIES`); legacy Strapi data used camelCase
// (`collection`, `series`). The defensive OR survives either shape and
// degrades gracefully for editor records that pre-date the label taxonomy.

export type ResolvedSeriesBySlug = {
  video: WatchVideoRecord
  selectedVariant: WatchVariant | null
}

// Explicit `Set<string>` annotation so the deliberate widening to string
// (to accept admin-uppercase labels via the `String(label).toLowerCase()`
// normalization below) is declared on the container, not buried in the
// call-site cast. Without this annotation the Set is inferred as
// `Set<"collection" | "series">` and a future typo in the contents
// (e.g. `"collectionn"`) would still pass the literal-union check.
const SERIES_LABEL_VALUES = new Set<string>(["collection", "series"])

// Consumed by `apps/web/src/app/[slug]/[locale]/page.tsx` (routing
// branch + `generateMetadata`) AND by unit tests that exercise the
// discriminator without standing up Apollo.
export function isSeriesRecord(record: {
  label?: string | null
  children?: { documentId: string }[] | null
}): boolean {
  const label = record.label
  if (label) return SERIES_LABEL_VALUES.has(String(label).toLowerCase())
  return (record.children?.length ?? 0) > 0
}

const SERIES_BY_SLUG_NOT_FOUND = "series-by-slug:NOT_FOUND"

async function tryResolveSeriesBySlug(
  videoSlug: string,
  locale: string,
): Promise<ResolvedSeriesBySlug> {
  // Reuses the same HTTP fetch the canonical video resolver uses, so a
  // COLLECTION-without-trailer slug never costs two admin round-trips —
  // unstable_cache wraps the per-resolver outer, fetchWatchVideoBySlug
  // is the shared HTTP call site.
  const record = await fetchWatchVideoBySlug(videoSlug, locale)
  if (!record) throw new Error(SERIES_BY_SLUG_NOT_FOUND)
  if (!isSeriesRecord(record)) throw new Error(SERIES_BY_SLUG_NOT_FOUND)

  const playableVariants = record.variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )

  let selectedVariant: WatchVariant | null = null
  if (playableVariants.length) {
    const localeMatch =
      playableVariants.find((variant) => variant.language?.slug === locale) ??
      playableVariants.find((variant) => variant.language?.bcp47 === locale)
    const primaryLanguageId = record.primaryLanguage?.coreId ?? null
    const primaryMatch = primaryLanguageId
      ? playableVariants.find(
          (variant) => variant.language?.coreId === primaryLanguageId,
        )
      : null
    selectedVariant = localeMatch ?? primaryMatch ?? playableVariants[0] ?? null
  }

  const narrowedRecord = selectedVariant
    ? stripNonSelectedVariantFields(record, selectedVariant.documentId)
    : record

  const resolved: ResolvedSeriesBySlug = {
    video: narrowedRecord,
    selectedVariant,
  }
  return JSON.parse(JSON.stringify(resolved)) as ResolvedSeriesBySlug
}

const fetchResolvedSeriesBySlug = unstable_cache(
  tryResolveSeriesBySlug,
  ["series-by-slug"],
  { revalidate: 60 },
)

// Returns null when the slug doesn't match a record OR the record is not
// series-shaped. Caller falls through to resolveWatchPage / Experience.
export const resolveSeriesBySlug = cache(
  async (
    videoSlug: string,
    locale: string,
  ): Promise<ResolvedSeriesBySlug | null> => {
    try {
      return await fetchResolvedSeriesBySlug(videoSlug, locale)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === SERIES_BY_SLUG_NOT_FOUND
      ) {
        return null
      }
      throw error
    }
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
): WatchHeroPlayerBlock {
  return { kind: "HeroPlayer", video, variant }
}

/**
 * Returns a carousel block with the most relevant peer set, or null when none
 * is available:
 *
 * 1. When the current video has its **own** children (a parent / collection
 *    video like JESUS with 61 chapter segments), surface those — the user is
 *    looking at the parent, so chapters are the relevant peers.
 * 2. Otherwise, fall back to the canonical parent's children — the current
 *    video is itself a chapter, and the user wants to navigate between
 *    siblings of the same parent (e.g. between segments of JESUS).
 *
 * Returns null when neither source has at least 2 entries.
 */
export function buildSiblingCarouselBlock(
  canonicalParent: WatchParent | null,
  video: WatchVideoRecord,
): WatchSiblingCarouselBlock | null {
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
  return { kind: "BibleQuotes", bibleCitations: items }
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

/**
 * Type guard distinguishing synthetic watch blocks from Experience blocks.
 * Synthetic blocks carry a `kind` discriminator; Experience blocks carry
 * `__typename`.
 */
export function isWatchBlock(block: MergedWatchBlock): block is WatchBlock {
  return "kind" in block
}

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

  pushSlot("HeroPlayer", buildHeroBlock(video, variant))
  pushSlot("SiblingCarousel", buildSiblingCarouselBlock(canonicalParent, video))
  pushSlot("WatchBody", buildWatchBodyBlock(video, variant))
  pushSlot("StudyQuestions", buildStudyQuestionsBlock(video.studyQuestions))
  pushSlot("BibleQuotes", buildBibleQuotesBlock(video.bibleCitations))
  pushSlot("Share", buildShareBlock(video))

  for (const block of passthrough) result.push(block)

  return result
}
