import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"
import { mediaCollectionFragment } from "@/components/sections/MediaCollection"
import { promoBannerFragment } from "@/components/sections/PromoBanner"
import { infoBlocksFragment } from "@/components/sections/InfoBlocks"
import { ctaSectionFragment } from "@/components/sections/CTASection"
import { bibleQuotesCarouselFragment } from "@/components/sections/BibleQuotesCarousel"

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
        documentId
        slug
        title
        metaDescription
        ogTitle
        ogDescription
        pathSegment
        ogImage {
          url
          width
          height
          alternativeText
        }
        sections {
          __typename
          ... on ComponentSectionsMediaCollection {
            ...MediaCollection
          }
          ... on ComponentSectionsPromoBanner {
            ...PromoBanner
          }
          ... on ComponentSectionsInfoBlocks {
            ...InfoBlocks
          }
          ... on ComponentSectionsCta {
            ...CTASection
          }
          ... on ComponentSectionsBibleQuotesCarousel {
            ...BibleQuotesCarousel
          }
        }
      }
    }
  `,
  [
    mediaCollectionFragment,
    promoBannerFragment,
    infoBlocksFragment,
    ctaSectionFragment,
    bibleQuotesCarouselFragment,
  ],
)

type WatchData = ResultOf<typeof GET_WATCH_EXPERIENCE>
export type WatchExperience = WatchData["experiences"][number]

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

/** Maps a WatchExperience (from getWatchExperience) to metadata shape. Returns null if no usable title/description. */
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
  NonNullable<NonNullable<WatchExperience>["sections"]>[number],
  null | { __typename: "Error" }
>

export type WatchExperienceResult =
  | { data: NonNullable<WatchExperience>; error: null }
  | { data: null; error: ErrorLike | Error }

/** Fetches experience (sections + metadata) by locale and optional slug. Cached per request; slug is a primitive so cache keys are stable. */
export const getWatchExperience = cache(
  async (locale: string, slug?: string): Promise<WatchExperienceResult> => {
    const slugOrNull = slug ?? null
    const filters =
      slugOrNull !== null
        ? { slug: { eq: slugOrNull } }
        : { isHomepage: { eq: true } }
    try {
      const result = await client.query({
        query: GET_WATCH_EXPERIENCE,
        variables: { locale, filters },
      })
      if (result.error) return { data: null, error: result.error }
      const exp = result.data?.experiences?.[0]
      if (!exp) return { data: null, error: new Error("No experience found") }
      return { data: exp as NonNullable<WatchExperience>, error: null }
    } catch (e) {
      return {
        data: null,
        error: e instanceof Error ? e : new Error(String(e)),
      }
    }
  },
)
