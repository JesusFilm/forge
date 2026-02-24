import { graphql, type ResultOf, type VariablesOf } from "@forge/graphql"

/**
 * Watch experience query: homepage (isHomepage: true) or by slug, with locale.
 * Section selection is inline; types align with apps/cms/schema.graphql.
 */
export const GET_WATCH_EXPERIENCE = graphql(`
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
          description
          categoryLabel
          ctaLink
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
          heading
          description
          ctaLink
          intro
        }
        ... on ComponentSectionsInfoBlocks {
          id
          heading
          intro
          description
          blocks {
            id
            title
            description
            icon
          }
        }
        ... on ComponentSectionsCta {
          id
          heading
          body
          buttonLabel
          buttonLink
        }
      }
    }
  }
`)

export type WatchExperienceQueryResult = ResultOf<typeof GET_WATCH_EXPERIENCE>
export type WatchExperienceQueryVariables = VariablesOf<
  typeof GET_WATCH_EXPERIENCE
>
export type WatchExperience = NonNullable<
  NonNullable<WatchExperienceQueryResult["experiences"]>[number]
>
export type WatchExperienceSection = Exclude<
  NonNullable<WatchExperience["sections"]>[number],
  null | { __typename: "Error" }
>
