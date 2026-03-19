import { cacheLife, cacheTag } from "next/cache"
import { print } from "graphql"
import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"
import {
  mediaCollectionFragment,
  promoBannerFragment,
  infoBlocksFragment,
  ctaSectionFragment,
  bibleQuotesCarouselFragment,
  textSectionFragment,
  containerFragment,
  sectionFragment,
  videoHeroFragment,
  videoCarouselFragment,
  videoSectionFragment,
  easterDatesFragment,
  relatedQuestionsFragment,
  navigationCarouselFragment,
} from "@/lib/fragments"

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
        blocks {
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
          ... on ComponentSectionsVideoHero {
            ...VideoHero
          }
          ... on ComponentSectionsBibleQuotesCarousel {
            ...BibleQuotesCarousel
          }
          ... on ComponentSectionsText {
            ...TextSection
          }
          ... on ComponentSectionsEasterDates {
            ...EasterDates
          }
          ... on ComponentSectionsContainer {
            ...Container
          }
          ... on ComponentSectionsVideo {
            ...VideoSection
          }
          ... on ComponentSectionsSection {
            ...Section
          }
          ... on ComponentSectionsRelatedQuestions {
            ...RelatedQuestions
          }
          ... on ComponentSectionsVideoCarousel {
            ...VideoCarousel
          }
          ... on ComponentSectionsNavigationCarousel {
            ...NavigationCarousel
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
    videoHeroFragment,
    videoSectionFragment,
    bibleQuotesCarouselFragment,
    textSectionFragment,
    easterDatesFragment,
    containerFragment,
    sectionFragment,
    videoCarouselFragment,
    relatedQuestionsFragment,
    navigationCarouselFragment,
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
  NonNullable<NonNullable<WatchExperience>["blocks"]>[number],
  null | { __typename: "Error" }
>

export type WatchExperienceResult =
  | { data: NonNullable<WatchExperience>; error: null }
  | { data: null; error: { message: string } }

/** Fetches experience by locale and optional slug. Cached via "use cache" with
 *  three-tier cache tags (`experience`, `experience:{slug}`, `experience:{slug}:{locale}`)
 *  for surgical on-demand invalidation via Strapi webhook. */
export async function getWatchExperience(
  locale: string,
  slug?: string,
): Promise<WatchExperienceResult> {
  "use cache"

  const tagSlug = slug ?? "homepage"
  cacheTag(
    "experience",
    `experience:${tagSlug}`,
    `experience:${tagSlug}:${locale}`,
  )
  cacheLife("max")

  const filters =
    slug != null ? { slug: { eq: slug } } : { isHomepage: { eq: true } }
  try {
    const res = await fetch(process.env.INTERNAL_GRAPHQL_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
      },
      body: JSON.stringify({
        query: print(GET_WATCH_EXPERIENCE),
        variables: { locale, filters },
      }),
    })
    const json = (await res.json()) as {
      data?: WatchData
      errors?: Array<{ message?: string }>
    }
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message ?? "Unknown").join("; ")
      return { data: null, error: { message: msg } }
    }
    const exp = json.data?.experiences?.[0]
    if (!exp) return { data: null, error: { message: "No experience found" } }
    return { data: exp as NonNullable<WatchExperience>, error: null }
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : String(e) },
    }
  }
}
