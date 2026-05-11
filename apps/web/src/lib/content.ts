import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/graphql"
import {
  BlocksSchema,
  type Block,
  type Blocks,
} from "../../../admin/src/domain/blocks"
import client from "@/lib/client"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichRouteRelatedVideo } from "@/lib/enrichment"

const EXPERIENCE_FIELDS = `
  id
  slug
  isHomepage
  title
  metaDescription
  ogTitle
  ogDescription
  ogImageUrl
  pathSegment
  blocks
  referencedVideos {
    documentId: id
    slug
    noIndex
    locales(locale: $locale) {
      id
      locale
      title
      snippet
      description
      imageAlt
    }
    images {
      id
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
    }
    variants: dubs {
      documentId: id
      published
      hls
      language {
        coreId
      }
    }
  }
`

const WATCH_VIDEO_FIELDS = `
  documentId: id
  slug
  noIndex
  label
  primaryLanguage {
    id
    coreId
    bcp47
    slug
    name
  }
  locales(locale: $locale) {
    id
    locale
    title
    snippet
    description
    imageAlt
  }
  images {
    id
    url
    thumbnail
    mobileCinematicHigh
    mobileCinematicLow
  }
  parents {
    documentId: id
    slug
    locales(locale: $locale) {
      id
      locale
      title
    }
    children {
      documentId: id
      slug
      label
      locales(locale: $locale) {
        id
        locale
        title
        snippet
        description
        imageAlt
      }
      images {
        id
        url
        thumbnail
        mobileCinematicHigh
        mobileCinematicLow
      }
    }
  }
  children {
    documentId: id
    slug
    label
    locales(locale: $locale) {
      id
      locale
      title
      snippet
      description
      imageAlt
    }
    images {
      id
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
    }
  }
  variants: dubs {
    documentId: id
    slug
    published
    hls
    duration
    language {
      id
      coreId
      bcp47
      slug
      name
    }
    downloads {
      documentId: id
      quality
      size
      url
    }
    muxVideo {
      playbackId
    }
  }
  studyQuestions {
    documentId: id
    value: text
    order
  }
  bibleCitations {
    documentId: id
    chapterStart
    chapterEnd
    verseStart
    verseEnd
    order
    osisId
    bibleBook {
      documentId: id
      name
    }
  }
`

const GET_EXPERIENCE = adminGraphql(`
  query GetExperience($slug: String!, $locale: String!) {
    experienceBySlug(slug: $slug, locale: $locale) {
      id
    }
  }
`)

const GET_WATCH_EXPERIENCE = adminGraphql(`
  query GetWatchExperience($slug: String!, $locale: String!) {
    experienceBySlug(slug: $slug, locale: $locale) {
      ${EXPERIENCE_FIELDS}
    }
  }
`)

const GET_WATCH_SETTINGS = adminGraphql(`
  query GetWatchSettings($locale: String!) {
    homepageExperienceLocale(locale: $locale) {
      ${EXPERIENCE_FIELDS}
    }
    defaultTemplateExperienceLocale(locale: $locale) {
      ${EXPERIENCE_FIELDS}
    }
  }
`)

const GET_ROUTE_VIDEO = adminGraphql(`
  query GetRouteVideo($slug: String!, $locale: String!) {
    videoBySlug(slug: $slug, locale: $locale) {
      ${WATCH_VIDEO_FIELDS}
    }
  }
`)

const GET_WATCH_VIDEO = adminGraphql(`
  query GetWatchVideo($videoSlug: String!, $locale: String!) {
    videoBySlug(slug: $videoSlug, locale: $locale) {
      ${WATCH_VIDEO_FIELDS}
    }
  }
`)

const GET_WATCH_VIDEO_BY_SLUG = adminGraphql(`
  query GetWatchVideoBySlug($videoSlug: String!, $locale: String!) {
    videoBySlug(slug: $videoSlug, locale: $locale) {
      ${WATCH_VIDEO_FIELDS}
    }
  }
`)

type WatchData = AdminResultOf<typeof GET_WATCH_EXPERIENCE>
type RouteVideoData = AdminResultOf<typeof GET_ROUTE_VIDEO>
type WatchVideoData = AdminResultOf<typeof GET_WATCH_VIDEO>

type AdminExperienceLocale = NonNullable<WatchData["experienceBySlug"]>
type AdminRouteVideoRecord = NonNullable<RouteVideoData["videoBySlug"]>
type AdminWatchVideoRecord = NonNullable<WatchVideoData["videoBySlug"]>
type AdminVideoLocale = NonNullable<
  NonNullable<AdminRouteVideoRecord["locales"]>[number]
>
type AdminReferencedVideo = NonNullable<
  NonNullable<AdminExperienceLocale["referencedVideos"]>[number]
>
type AdminLanguage = NonNullable<AdminRouteVideoRecord["primaryLanguage"]>

type LegacyMedia = {
  url?: string | null
  width?: number | null
  height?: number | null
  alternativeText?: string | null
}

type NormalizedExperience = Omit<
  AdminExperienceLocale,
  "blocks" | "ogImageUrl" | "referencedVideos"
> & {
  documentId: string
  isTemplate: boolean
  blocks: Section[]
  ogImage: LegacyMedia | null
  referencedVideos: (AdminReferencedVideo & {
    documentId: string
    id: string
    streamingUrl: string | null
  })[]
  videoMap: Map<
    string,
    AdminReferencedVideo & {
      documentId: string
      id: string
      streamingUrl: string | null
    }
  >
}

type NormalizedRouteVideoRecord = AdminRouteVideoRecord & {
  title: string | null
  snippet: string | null
  description: string | null
  imageAlt: string | null
}

export type WatchExperience = NormalizedExperience
type WatchSetting = {
  homepageExperience: WatchExperience | null
  defaultTemplateExperience: WatchExperience | null
}
type RouteVideoRecord = NormalizedRouteVideoRecord

function displayNameFromJson(value: unknown): string | null {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const entries = Object.values(value as Record<string, unknown>)
    const primary = entries.find((entry) => typeof entry === "string")
    if (typeof primary === "string") return primary
  }
  return null
}

function normalizeLanguage<T extends AdminLanguage | null | undefined>(
  language: T,
): T {
  if (!language) return language
  return {
    ...language,
    name: displayNameFromJson(language.name),
  } as T
}

function pickLocale<T extends { locale?: string | null } | null | undefined>(
  locales: readonly T[] | null | undefined,
  locale: string,
): NonNullable<T> | null {
  const items = (locales ?? []).filter(
    (item): item is NonNullable<T> => item != null,
  )
  return (
    items.find((item) => item.locale === locale) ??
    items.find((item) => item.locale === "en") ??
    items[0] ??
    null
  )
}

function parseBlocks(rawBlocks: AdminExperienceLocale["blocks"]): Blocks {
  if (!Array.isArray(rawBlocks)) return []
  return BlocksSchema.parse(rawBlocks)
}

function referencedVideoStreamingUrl(
  video: AdminReferencedVideo,
): string | null {
  const variants =
    "variants" in video && Array.isArray(video.variants) ? video.variants : []
  const playableVariants = variants.filter(
    (variant): variant is NonNullable<(typeof variants)[number]> =>
      variant != null && Boolean(variant.hls),
  )
  return (
    playableVariants.find((variant) => variant.published === true)?.hls ??
    playableVariants[0]?.hls ??
    null
  )
}

function normalizeExperience(
  experience: AdminExperienceLocale | null | undefined,
  isTemplate = false,
): WatchExperience | null {
  if (!experience) return null
  const referencedVideos = (experience.referencedVideos ?? [])
    .filter(
      (video): video is AdminReferencedVideo & { documentId: string } =>
        video != null && typeof video.documentId === "string",
    )
    .map((video) => ({
      ...video,
      id: video.documentId,
      streamingUrl: referencedVideoStreamingUrl(video),
    }))

  return {
    ...experience,
    documentId: experience.id ?? "",
    isTemplate,
    blocks: parseBlocks(experience.blocks),
    ogImage: experience.ogImageUrl
      ? {
          url: experience.ogImageUrl,
        }
      : null,
    referencedVideos,
    videoMap: new Map(
      referencedVideos.map((video) => [video.documentId, video]),
    ),
  }
}

function hydrateExperienceVideoMap(
  experience: WatchExperience,
): WatchExperience {
  const referencedVideos = (experience.referencedVideos ?? []).filter(
    (
      video,
    ): video is AdminReferencedVideo & {
      documentId: string
      id: string
      streamingUrl: string | null
    } => video != null && typeof video.documentId === "string",
  )
  return {
    ...experience,
    referencedVideos,
    videoMap: new Map(
      referencedVideos.map((video) => [video.documentId, video]),
    ),
  }
}

function hydrateWatchPageVideoMaps(page: ResolvedWatchPage): ResolvedWatchPage {
  if (page.kind === "experience") {
    return {
      ...page,
      experience: hydrateExperienceVideoMap(page.experience),
    }
  }

  return {
    ...page,
    template: hydrateExperienceVideoMap(page.template),
  }
}

function normalizeVideoLocaleFields<
  T extends AdminRouteVideoRecord | AdminWatchVideoRecord,
>(video: T, locale: string): T & NormalizedRouteVideoRecord {
  const localized = pickLocale(video.locales as AdminVideoLocale[], locale)
  const normalizeChild = (child: NonNullable<T["children"]>[number]) => {
    const childLocale = pickLocale(child?.locales ?? null, locale)
    return {
      ...child,
      title: childLocale?.title ?? child?.slug ?? null,
      snippet: childLocale?.snippet ?? null,
      description: childLocale?.description ?? null,
      imageAlt: childLocale?.imageAlt ?? null,
    }
  }
  const normalizeParent = (parent: NonNullable<T["parents"]>[number]) => {
    const parentLocale = pickLocale(parent?.locales ?? null, locale)
    return {
      ...parent,
      title: parentLocale?.title ?? parent?.slug ?? null,
      children: (parent?.children ?? []).map(normalizeChild),
    }
  }
  return {
    ...video,
    title: localized?.title ?? video.slug ?? null,
    snippet: localized?.snippet ?? null,
    description: localized?.description ?? null,
    imageAlt: localized?.imageAlt ?? null,
    primaryLanguage: normalizeLanguage(video.primaryLanguage),
    variants: (video.variants ?? []).map((variant) =>
      variant
        ? { ...variant, language: normalizeLanguage(variant.language) }
        : variant,
    ),
    bibleCitations: (video.bibleCitations ?? []).map((citation) =>
      citation
        ? {
            ...citation,
            bibleBook: citation.bibleBook
              ? {
                  ...citation.bibleBook,
                  name: displayNameFromJson(citation.bibleBook.name),
                }
              : null,
          }
        : citation,
    ),
    children: (video.children ?? []).map(normalizeChild),
    parents: (video.parents ?? []).map(normalizeParent),
  } as T & NormalizedRouteVideoRecord
}

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
const INVALID_HOMEPAGE_EXPERIENCE_MESSAGE =
  "Homepage experience must not be marked as template."
const INVALID_DEFAULT_TEMPLATE_MESSAGE =
  "Default template experience must be marked as template."

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
    ogImage: exp.ogImage?.url
      ? {
          url: exp.ogImage.url,
          width: exp.ogImage.width ?? null,
          height: exp.ogImage.height ?? null,
          alt: exp.ogImage.alternativeText ?? "",
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

// Legacy section renderers still consume Strapi-shaped blocks until the U5
// component rewrite lands. U4 owns parsing admin blocks but keeps this public
// alias permissive so existing routes/components continue to typecheck.
export type Section = Block & { __typename?: string | null; id?: string | null }

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

function asNonTemplateExperience(
  experience: WatchExperience | null | undefined,
): NonNullable<WatchExperience> | null {
  if (!experience || experience.isTemplate === true) return null
  return experience as NonNullable<WatchExperience>
}

function asTemplateExperience(
  experience: WatchExperience | null | undefined,
): NonNullable<WatchExperience> | null {
  if (!experience || experience.isTemplate !== true) return null
  return experience as NonNullable<WatchExperience>
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

  return normalizeExperience(result.data?.experienceBySlug)
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

  if (!result.data) return null

  return {
    homepageExperience: normalizeExperience(
      result.data.homepageExperienceLocale,
    ),
    defaultTemplateExperience: normalizeExperience(
      result.data.defaultTemplateExperienceLocale,
      true,
    ),
  }
}

async function getVideoBySlug(
  locale: string,
  slug: string,
): Promise<RouteVideoRecord | null> {
  const result = await client.query({
    query: GET_ROUTE_VIDEO,
    variables: { locale, slug },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  const video = result.data?.videoBySlug ?? null
  return video ? normalizeVideoLocaleFields(video, locale) : null
}

function selectPlayableVariant(video: NonNullable<RouteVideoRecord>) {
  const variants = (video.variants ?? []).filter(
    (variant): variant is NonNullable<typeof variant> => variant != null,
  )

  const playableVariants = variants.filter(
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
  video: NonNullable<RouteVideoRecord>,
): EnrichedMediaItem[] {
  const selfDocumentId = video.documentId
  const selfSlug = video.slug ?? null

  return (video.children ?? [])
    .filter((child): child is NonNullable<typeof child> => child != null)
    .filter((child) => {
      if (child.documentId === selfDocumentId) return false
      if (selfSlug && child.slug === selfSlug) return false
      return true
    })
    .map((child) =>
      enrichRouteRelatedVideo({
        documentId: child.documentId ?? "",
        slug: child.slug ?? null,
        title: "title" in child ? (child.title as string | null) : null,
        label: child.label ?? null,
        images: child.images ?? null,
      }),
    )
    .filter((item): item is EnrichedMediaItem => item != null)
    .slice(0, 24)
}

function normalizeRouteVideo(
  video: NonNullable<RouteVideoRecord>,
): RouteVideo | null {
  const selectedVariant = selectPlayableVariant(video)
  if (!selectedVariant?.hls) return null

  return {
    documentId: video.documentId ?? "",
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
  if (settings?.homepageExperience?.isTemplate === true) {
    throw new Error(INVALID_HOMEPAGE_EXPERIENCE_MESSAGE)
  }

  const homepageExperience = asNonTemplateExperience(
    settings?.homepageExperience ?? null,
  )
  if (homepageExperience) {
    return { kind: "experience", experience: homepageExperience }
  }
  return null
}

async function resolveSlugPage(
  locale: string,
  slug: string,
): Promise<ResolvedWatchPage | null> {
  const explicitExperience = asNonTemplateExperience(
    await getExperienceBySlug(locale, slug),
  )
  if (explicitExperience) {
    return { kind: "experience", experience: explicitExperience }
  }

  const routeVideoRecord = await getVideoBySlug(locale, slug)
  if (!routeVideoRecord) return null

  const settings = await getWatchSettings(locale)
  if (
    settings?.defaultTemplateExperience &&
    settings.defaultTemplateExperience.isTemplate !== true
  ) {
    throw new Error(INVALID_DEFAULT_TEMPLATE_MESSAGE)
  }

  const templateExperience = asTemplateExperience(
    settings?.defaultTemplateExperience ?? null,
  )
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
    const result = await fetchResolvedWatchPage(locale, slug ?? null)
    if (!result.data) return result
    return {
      ...result,
      data: hydrateWatchPageVideoMaps(result.data),
    }
  },
)

// ---------------------------------------------------------------------------
// U3: dedicated watch route resolver
// ---------------------------------------------------------------------------

type WatchImage = { url?: string | null; thumbnail?: string | null } | null
type WatchLanguage = {
  coreId?: string | null
  bcp47?: string | null
  slug?: string | null
  name?: string | null
} | null
type WatchChild = {
  documentId: string
  slug: string | null
  title: string | null
  label?: string | null
  images?: WatchImage[] | null
}
type WatchParent = WatchChild & { children?: WatchChild[] | null }
type WatchVariant = {
  documentId: string
  slug?: string | null
  published?: boolean | null
  hls?: string | null
  duration?: number | null
  language?: WatchLanguage
  downloads?:
    | {
        documentId: string
        quality?: string | null
        size?: string | null
        url?: string | null
      }[]
    | null
  muxVideo?: { playbackId?: string | null } | null
}
type WatchVideoRecord = {
  documentId: string
  slug: string | null
  title: string | null
  snippet: string | null
  description: string | null
  noIndex: boolean | null
  label?: string | null
  imageAlt?: string | null
  images?: WatchImage[] | null
  primaryLanguage?: WatchLanguage
  parents?: WatchParent[] | null
  children?: WatchChild[] | null
  variants?: WatchVariant[] | null
  studyQuestions?:
    | {
        documentId?: string | null
        value?: string | null
        order?: number | null
      }[]
    | null
  bibleCitations?:
    | {
        documentId?: string | null
        chapterStart?: number | null
        chapterEnd?: number | null
        verseStart?: number | null
        verseEnd?: number | null
        order?: number | null
        osisId?: string | null
        bibleBook?: { documentId?: string | null; name?: string | null } | null
      }[]
    | null
}

export type WatchVideoErrorCode =
  | "PARENT_NOT_FOUND"
  | "LOCALE_NOT_FOUND"
  | "NO_PLAYABLE_VARIANT"
  | "VIDEO_NOT_FOUND"
  | "INVALID_HERO_PLAYER_BLOCK"

/**
 * Typed error surfaced from `resolveWatchVideo` (and `mergeWatchExperience`)
 * when the requested collection/video/locale combination cannot be rendered,
 * or when an Experience supplies an admin-authored player block targeting the
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
 * The `video` field carries the admin Video projection; `canonicalParent` and
 * `selectedVariant` are
 * resolver-side picks (URL slug match + language.slug filter) and are
 * **also referenced by the same identity inside `video.parents` /
 * `video.variants`** so downstream consumers can correlate without a second
 * lookup.
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

async function fetchWatchVideoRecord(
  collectionSlug: string,
  videoSlug: string,
  locale: string,
): Promise<WatchVideoRecord | null> {
  const result = await client.query({
    query: GET_WATCH_VIDEO,
    variables: {
      videoSlug,
      locale,
    },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  const record = result.data?.videoBySlug ?? null
  if (!record) return null

  const normalized = normalizeVideoLocaleFields(record, locale)
  const parents = (normalized.parents ?? []).filter(
    (parent) => parent != null,
  ) as unknown as WatchParent[]
  if (!parents.some((parent) => parent.slug === collectionSlug)) return null

  return normalized as unknown as WatchVideoRecord
}

// Strip the heavy fields (`downloads`, `muxVideo`, `duration`) from every
// variant in `record.variants` *except* the one matching `selectedDocumentId`.
// Each non-selected variant retains documentId, slug, published, hls, and
// language only — enough to power the language picker and the URL/locale
// guards without shipping ~2KB of MP4 download metadata × 240+ variants.
//
// Runtime-only narrowing: the `WatchVideoRecord` type still claims those
// fields are present on every variant, so we cast through `unknown` to keep
// the public type stable. Consumers that reach for `variant.downloads` on a
// non-selected variant will see `undefined` — that's the cost we pay for
// keeping the RSC payload sub-100KB instead of the original ~500KB.
function stripNonSelectedVariantFields(
  record: WatchVideoRecord,
  selectedDocumentId: string | null,
): WatchVideoRecord {
  if (!record.variants?.length) return record
  const variants = record.variants.map((variant) => {
    if (variant == null) return variant
    if (variant.documentId === selectedDocumentId) return variant
    return {
      documentId: variant.documentId,
      slug: variant.slug,
      published: variant.published,
      hls: variant.hls,
      language: variant.language,
    } as unknown as typeof variant
  })
  return { ...record, variants } as WatchVideoRecord
}

async function tryResolveWatchVideo(
  collectionSlug: string,
  videoSlug: string,
  languageSlug: string,
): Promise<ResolvedWatchVideo> {
  const record = await fetchWatchVideoRecord(
    collectionSlug,
    videoSlug,
    languageSlug,
  )
  if (!record) {
    throw new WatchVideoError("VIDEO_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const parents = (record.parents ?? []).filter(
    (parent): parent is WatchParent => parent != null,
  )
  const canonicalParent =
    parents.find((parent) => parent.slug === collectionSlug) ?? null
  if (!canonicalParent) {
    throw new WatchVideoError("PARENT_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const variants = (record.variants ?? []).filter(
    (variant): variant is WatchVariant => variant != null,
  )
  const playableVariants = variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )

  const selectedVariant =
    playableVariants.find(
      (variant) => variant.language?.slug === languageSlug,
    ) ?? null

  if (!selectedVariant) {
    // Distinguish "language not in this video" vs. "no playable variant at
    // all" so the error boundary can show a useful English-fallback link.
    const matchedLanguageVariant = variants.find(
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

async function fetchWatchVideoBySlug(
  videoSlug: string,
  locale: string,
): Promise<WatchVideoRecord | null> {
  const result = await client.query({
    query: GET_WATCH_VIDEO_BY_SLUG,
    variables: {
      videoSlug,
      locale,
    },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  const record = result.data?.videoBySlug ?? null
  return record
    ? (normalizeVideoLocaleFields(
        record,
        locale,
      ) as unknown as WatchVideoRecord)
    : null
}

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

  const parents = (record.parents ?? []).filter(
    (parent): parent is WatchParent => parent != null,
  )
  const canonicalParent = parents[0] ?? null

  const variants = (record.variants ?? []).filter(
    (variant): variant is WatchVariant => variant != null,
  )
  const playableVariants = variants.filter(
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
// published yet (the original bug).
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

// ---------------------------------------------------------------------------
// U4: Hybrid resolver — synthetic watch blocks + per-block-type override merge
// ---------------------------------------------------------------------------

type WatchStudyQuestion = NonNullable<
  NonNullable<WatchVideoRecord["studyQuestions"]>[number]
>
type WatchBibleCitation = NonNullable<
  NonNullable<WatchVideoRecord["bibleCitations"]>[number]
>

/**
 * Synthetic block-type discriminators owned by the watch route. These are NOT
 * Admin block `t` values — they exist purely so `WatchSectionRenderer` can
 * dispatch watch-only components (HeroPlayer, SiblingCarousel, WatchBody,
 * StudyQuestions, BibleQuotes, Share) alongside admin blocks coming
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
  children: NonNullable<WatchParent["children"]>
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

/** Admin-authored block coming from an Experience. */
export type AdminWatchBlock = Block

/** Discriminator for entries in the merged watch-block array. */
export type MergedWatchBlock = WatchBlock | AdminWatchBlock

/**
 * Admin `t` values that mount their own player and would steal Mux
 * Data attribution from the watch-page HeroPlayer. These are rejected at
 * merge time when targeting the HeroPlayer slot.
 */
const PLAYER_BEARING_ADMIN_TYPES = new Set<string>([
  "videoHero",
  "video",
  "videoCarousel",
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
  // Narrow nulls only — both the parent's children and the current video's
  // children share the same element type at the schema level, so we don't
  // need a cross-path type assertion (each branch's narrow already lands
  // inside `CarouselParent.children`).
  const ownChildren = (video.children ?? []).filter(
    (child): child is NonNullable<typeof child> => child != null,
  )
  if (ownChildren.length >= 2) {
    // Synthesize a virtual parent from the current video so the carousel's
    // header reads correctly ("JESUS · Clip N of M") and so the existing
    // canonicalParent.children consumer in <SiblingCarousel> doesn't need a
    // second branch. `currentVideoDocumentId` won't match any of its own
    // children, so no "Playing now" badge — accurate for a parent-page view.
    const virtualParent: CarouselParent = {
      documentId: video.documentId ?? "",
      slug: video.slug ?? "",
      title: video.title ?? "",
      children: ownChildren,
    }
    return {
      kind: "SiblingCarousel",
      canonicalParent: virtualParent,
      currentVideoDocumentId: video.documentId ?? "",
    }
  }
  if (!canonicalParent) return null
  const siblings = (canonicalParent.children ?? []).filter(
    (child): child is WatchChild => child != null,
  )
  if (siblings.length < 2) return null
  return {
    kind: "SiblingCarousel",
    canonicalParent: {
      documentId: canonicalParent.documentId ?? "",
      slug: canonicalParent.slug ?? null,
      title: canonicalParent.title ?? null,
      children: siblings,
    },
    currentVideoDocumentId: video.documentId ?? "",
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
  studyQuestions: WatchVideoRecord["studyQuestions"],
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
  bibleCitations: WatchVideoRecord["bibleCitations"],
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
 * Maps an incoming Experience block (synthetic or admin-authored) to the
 * synthetic watch slot it fills, or `null` if the block does not target any
 * of the 6 slots and should pass through to delegated rendering.
 *
 * Slot mapping rules:
 * - Synthetic blocks fill the slot named by their `kind`.
 * - Admin `relatedQuestions` → StudyQuestions slot.
 * - Admin `bibleQuotesCarousel` → BibleQuotes slot.
 * - All other admin blocks (promoBanner, infoBlocks, cta, etc.)
 *   pass through and render after the 6 watch slots.
 * - Admin player-bearing blocks (videoHero/video/videoCarousel) explicitly
 *   target HeroPlayer slot for the rejection check.
 */
function blockSlot(block: MergedWatchBlock): WatchSlotKey | null {
  if ("kind" in block) {
    return block.kind
  }
  const type = block.t
  if (type === "relatedQuestions") return "StudyQuestions"
  if (type === "bibleQuotesCarousel") return "BibleQuotes"
  if (PLAYER_BEARING_ADMIN_TYPES.has(type)) return "HeroPlayer"
  return null
}

/**
 * Type guard distinguishing synthetic watch blocks from admin blocks.
 * Synthetic blocks carry a `kind` discriminator; admin blocks carry `t`.
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
 * - HeroPlayer slot is type-restricted: a Strapi-typed player-bearing block
 *   targeting HeroPlayer throws `WatchVideoError('INVALID_HERO_PLAYER_BLOCK')`.
 *   Only synthetic `HeroPlayer` overrides are accepted.
 * - Strapi blocks not targeting any of the 6 slots (PromoBanner, InfoBlocks,
 *   CTA, etc.) append after the 6 slots in the order the Experience supplied
 *   them.
 *
 * The returned array order matches the visual watch-page order:
 * HeroPlayer → SiblingCarousel → WatchBody → StudyQuestions → BibleQuotes →
 * Share → ...passthrough Strapi blocks.
 */
export function mergeWatchExperience({
  video,
  variant,
  canonicalParent,
  experience,
}: MergeWatchExperienceArgs): MergedWatchBlock[] {
  const overrides = new Map<WatchSlotKey, MergedWatchBlock>()
  const passthrough: AdminWatchBlock[] = []

  const experienceBlocks = (experience?.blocks ?? []).filter(
    (b): b is AdminWatchBlock => b != null,
  )

  for (const block of experienceBlocks) {
    const slot = blockSlot(block)
    if (slot === "HeroPlayer" && !isWatchBlock(block)) {
      // HeroPlayer slot is type-restricted: only synthetic HeroPlayer blocks
      // are accepted. Any Strapi-typed player block reaching here is rejected
      // to preserve Mux Data attribution to the watch-page player.
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
  pushSlot(
    "StudyQuestions",
    buildStudyQuestionsBlock(video.studyQuestions ?? null),
  )
  pushSlot("BibleQuotes", buildBibleQuotesBlock(video.bibleCitations ?? null))
  pushSlot("Share", buildShareBlock(video))

  for (const block of passthrough) result.push(block)

  return result
}
