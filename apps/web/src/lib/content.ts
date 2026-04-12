import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichRouteRelatedVideo } from "@/lib/enrichment"
import { watchExperienceFragment } from "@/lib/fragments"

const GET_EXPERIENCE = graphql(`
  query GetExperience($slug: String!, $locale: I18NLocaleCode!) {
    experiences(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
    }
  }
`)

const GET_WATCH_EXPERIENCE = graphql(
  `
    query GetWatchExperience(
      $locale: I18NLocaleCode!
      $filters: ExperienceFiltersInput!
    ) {
      experiences(filters: $filters, locale: $locale) {
        ...WatchExperience
      }
    }
  `,
  [watchExperienceFragment],
)

const GET_WATCH_SETTINGS = graphql(
  `
    query GetWatchSettings($locale: I18NLocaleCode!) {
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

const GET_ROUTE_VIDEO = graphql(`
  query GetRouteVideo($slug: String!, $locale: I18NLocaleCode!) {
    videos(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
      slug
      title
      snippet
      description
      imageAlt
      noIndex
      images {
        url
      }
      primaryLanguage {
        coreId
      }
      variants {
        documentId
        hls
        published
        language {
          coreId
        }
      }
      children(pagination: { limit: 24 }) {
        documentId
        slug
        title
        label
        images {
          url
        }
      }
    }
  }
`)

type WatchData = ResultOf<typeof GET_WATCH_EXPERIENCE>
type WatchSettingsData = ResultOf<typeof GET_WATCH_SETTINGS>
type RouteVideoData = ResultOf<typeof GET_ROUTE_VIDEO>

export type WatchExperience = WatchData["experiences"][number]
type WatchSetting = WatchSettingsData["watchSetting"]
type RouteVideoRecord = RouteVideoData["videos"][number]

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
    ogImage: exp.ogImage
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
  const items = result.data?.experiences
  return items?.[0] ?? null
}

export type Section = Exclude<
  NonNullable<NonNullable<NonNullable<WatchExperience>["blocks"]>[number]>,
  null | { __typename: "Error" }
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

async function getExperienceByFilters(
  locale: string,
  filters: Record<string, unknown>,
): Promise<NonNullable<WatchExperience> | null> {
  const result = await client.query({
    query: GET_WATCH_EXPERIENCE,
    variables: { locale, filters },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return (result.data?.experiences?.[0] ??
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

  return (result.data?.videos?.[0] ?? null) as RouteVideoRecord | null
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
    .map(enrichRouteRelatedVideo)
    .filter((item): item is EnrichedMediaItem => item != null)
    .slice(0, 24)
}

function normalizeRouteVideo(
  video: NonNullable<RouteVideoRecord>,
): RouteVideo | null {
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
  if (settings?.homepageExperience?.isTemplate === true) {
    throw new Error(INVALID_HOMEPAGE_EXPERIENCE_MESSAGE)
  }

  const homepageExperience = asNonTemplateExperience(
    settings?.homepageExperience ?? null,
  )
  if (homepageExperience) {
    return { kind: "experience", experience: homepageExperience }
  }

  const legacyHomepage = asNonTemplateExperience(
    await getExperienceByFilters(locale, {
      isHomepage: { eq: true },
    }),
  )
  if (!legacyHomepage) return null

  return { kind: "experience", experience: legacyHomepage }
}

async function resolveSlugPage(
  locale: string,
  slug: string,
): Promise<ResolvedWatchPage | null> {
  const explicitExperience = asNonTemplateExperience(
    await getExperienceByFilters(locale, {
      slug: { eq: slug },
    }),
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
    return fetchResolvedWatchPage(locale, slug ?? null)
  },
)
