import { graphql, type ResultOf } from "@forge/graphql"
import { env } from "@/env"
import client from "@/lib/client"

const GET_EXPERIENCE = graphql(`
  query GetExperience($slug: String!, $locale: I18NLocaleCode!) {
    experiences(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
    }
  }
`)

const GET_WATCH_EXPERIENCE = graphql(`
  query GetWatchExperience(
    $locale: I18NLocaleCode!
    $filters: ExperienceFiltersInput!
  ) {
    experiences(filters: $filters, locale: $locale) {
      documentId
      slug
      sections {
        __typename
        ... on ComponentSectionsMediaCollection {
          id
          title
          subtitle
          mediaDescription: description
          categoryLabel
          mediaCtaLink: ctaLink
          showItemNumbers
          variant
          items {
            id
            titleOverride
            subtitleOverride
            imageOverride {
              url
            }
            video {
              documentId
              title
              slug
              image {
                url
              }
            }
          }
        }
        ... on ComponentSectionsPromoBanner {
          id
          promoHeading: heading
          promoDescription: description
          intro
          promoCtaLink: ctaLink
        }
        ... on ComponentSectionsInfoBlocks {
          id
          infoHeading: heading
          intro
          infoDescription: description
          blocks {
            id
            title
            description
            icon
          }
        }
        ... on ComponentSectionsCta {
          id
          ctaHeading: heading
          body
          buttonLabel
          buttonLink
        }
      }
    }
  }
`)

export async function readPublishedContent(slug: string, locale: string) {
  if (!env.NEXT_PUBLIC_GRAPHQL_URL) return null
  const result = await client.query({
    query: GET_EXPERIENCE,
    variables: { slug, locale },
  })
  if (result.error) return null
  const items = result.data?.experiences
  return items?.[0] ?? null
}

type WatchData = ResultOf<typeof GET_WATCH_EXPERIENCE>
type WatchExperience = WatchData["experiences"][number]

export type WatchExperienceResult =
  | { data: WatchExperience; error: null }
  | { data: null; error: Error }

export async function getWatchExperience(
  locale: string,
  options?: { slug?: string; homepage?: boolean },
): Promise<WatchExperienceResult> {
  if (!env.NEXT_PUBLIC_GRAPHQL_URL) {
    return { data: null, error: new Error("GraphQL URL not configured") }
  }
  const slug = options?.slug ?? null
  const filters =
    slug !== null ? { slug: { eq: slug } } : { isHomepage: { eq: true } }
  try {
    const result = await client.query({
      query: GET_WATCH_EXPERIENCE,
      variables: { locale, filters },
    })
    if (result.error) return { data: null, error: result.error as Error }
    const exp = result.data?.experiences?.[0]
    if (!exp) return { data: null, error: new Error("No experience found") }
    return { data: exp, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}
