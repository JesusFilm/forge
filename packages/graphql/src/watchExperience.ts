import { graphql, type ResultOf, type VariablesOf } from "./graphql"

/**
 * Watch experience query: homepage (isHomepage: true) or by slug, with locale.
 * Section selection is inline with aliases to avoid String vs String! conflicts.
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
          mediaCollectionDescription: description
          categoryLabel
          mediaCollectionCtaLink: ctaLink
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
          promoBannerHeading: heading
          promoBannerDescription: description
          promoBannerCtaLink: ctaLink
          intro
        }
        ... on ComponentSectionsInfoBlocks {
          id
          infoBlocksHeading: heading
          intro
          infoBlocksDescription: description
          blocks {
            id
            title
            infoBlockDescription: description
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
