import type { ErrorLike } from "@apollo/client"
import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"
import { mediaCollectionFragment } from "@/components/sections/MediaCollection"
import { promoBannerFragment } from "@/components/sections/PromoBanner"
import { infoBlocksFragment } from "@/components/sections/InfoBlocks"
import { ctaSectionFragment } from "@/components/sections/CTASection"

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
        }
      }
    }
  `,
  [
    mediaCollectionFragment,
    promoBannerFragment,
    infoBlocksFragment,
    ctaSectionFragment,
  ],
)

export async function readPublishedContent(slug: string, locale: string) {
  const result = await client.query({
    query: GET_EXPERIENCE,
    variables: { slug, locale },
  })
  if (result.error) return null
  const items = result.data?.experiences
  return items?.[0] ?? null
}

type WatchData = ResultOf<typeof GET_WATCH_EXPERIENCE>
export type WatchExperience = WatchData["experiences"][number]

type MaybeSection = NonNullable<
  NonNullable<WatchExperience>["sections"]
>[number]
type WatchSection = Exclude<MaybeSection, null | { __typename: "Error" }>
type RenderableSectionTypename =
  | "ComponentSectionsMediaCollection"
  | "ComponentSectionsPromoBanner"
  | "ComponentSectionsInfoBlocks"
  | "ComponentSectionsCta"

export type Section = Extract<
  WatchSection,
  { __typename: RenderableSectionTypename }
>

const renderableSectionTypenames = new Set<RenderableSectionTypename>([
  "ComponentSectionsMediaCollection",
  "ComponentSectionsPromoBanner",
  "ComponentSectionsInfoBlocks",
  "ComponentSectionsCta",
])

export function isRenderableSection(section: MaybeSection): section is Section {
  return (
    section !== null &&
    section.__typename !== "Error" &&
    renderableSectionTypenames.has(
      section.__typename as RenderableSectionTypename,
    )
  )
}

export type WatchExperienceResult =
  | { data: NonNullable<WatchExperience>; error: null }
  | { data: null; error: ErrorLike | Error }

export async function getWatchExperience(
  locale: string,
  options?: { slug?: string },
): Promise<WatchExperienceResult> {
  const slug = options?.slug ?? null
  const filters =
    slug !== null ? { slug: { eq: slug } } : { isHomepage: { eq: true } }
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
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}
