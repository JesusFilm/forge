import { graphql, type ResultOf, type VariablesOf } from "./graphql"

/**
 * Section fragments for the Watch Experience query.
 *
 * Each leaf section type gets its own named fragment with @_unmask so the
 * fields are directly accessible on the query result (no readFragment needed).
 *
 * Aliases (e.g. mediaCollectionTitle) avoid conflicts where different component
 * types expose fields with the same name but different nullability.
 */

// -- Leaf fragments --------------------------------------------------------

export const watchMediaCollectionFragment = graphql(`
  fragment WatchMediaCollection on ComponentSectionsMediaCollection @_unmask {
    id
    sectionKey
    mediaCollectionTitle: title
    subtitle
    mediaCollectionDescription: description
    categoryLabel
    mediaCollectionCtaLink: ctaLink
    showItemNumbers
    footerText
    mediaCollectionVariant: variant
    items {
      id
      titleOverride
      subtitleOverride
      collectionSize
      linkToSectionKey
      imageOverride {
        url
        alternativeText
      }
      itemVideo: video {
        documentId
        slug
        title
        image {
          url
          alternativeText
        }
      }
    }
  }
`)

export const watchCtaFragment = graphql(`
  fragment WatchCta on ComponentSectionsCta @_unmask {
    id
    sectionKey
    ctaHeading: heading
    body
    buttonLabel
    buttonLink
    ctaVariant: variant
  }
`)

export const watchVideoHeroFragment = graphql(`
  fragment WatchVideoHero on ComponentSectionsVideoHero @_unmask {
    id
    sectionKey
    videoHeroHeading: heading
    subheading
    ctaLink
    ctaLabel
    heroVideo: video {
      documentId
      slug
      title
      image {
        url
        alternativeText
      }
    }
  }
`)

export const watchTextFragment = graphql(`
  fragment WatchText on ComponentSectionsText @_unmask {
    id
    sectionKey
    textHeading: heading
    headingLevel
    textSubtitle: subtitle
    textContent: content
    textVariant: variant
  }
`)

export const watchRelatedQuestionsFragment = graphql(`
  fragment WatchRelatedQuestions on ComponentSectionsRelatedQuestions @_unmask {
    id
    sectionKey
    relatedQuestionsHeading: heading
    questions {
      id
      question
      answer
    }
  }
`)

export const watchBibleQuotesCarouselFragment = graphql(`
  fragment WatchBibleQuotesCarousel on ComponentSectionsBibleQuotesCarousel
  @_unmask {
    id
    sectionKey
    carouselHeading: heading
    quotes {
      id
      reference
      text
      backgroundImage {
        url
        alternativeText
      }
      ctaLabel
      ctaLink
      attribution
    }
  }
`)

export const watchCardFragment = graphql(`
  fragment WatchCard on ComponentSectionsCard @_unmask {
    id
    sectionKey
    cardTitle: title
    cardDescription: description
    media {
      url
      alternativeText
    }
    link
    cardVariant: variant
  }
`)

export const watchVideoSectionFragment = graphql(`
  fragment WatchVideoSection on ComponentSectionsVideo @_unmask {
    id
    sectionKey
    streamingUrl
    videoTitle: title
    videoSubtitle: subtitle
    videoMedia: media {
      url
      alternativeText
    }
    sectionVideo: video {
      documentId
      slug
      title
      image {
        url
        alternativeText
      }
    }
  }
`)

// -- Main query ------------------------------------------------------------

/**
 * Watch experience query: homepage (isHomepage: true) or by slug, with locale.
 *
 * Covers all 10 active section types. PromoBanner and InfoBlocks are deprecated
 * stubs (id-only) kept for backwards compatibility.
 *
 * Leaf fragments are spread at each nesting level (top-level sections,
 * Container slot content, Section wrapper content) because the schema uses
 * separate dynamic zone unions at each level.
 *
 * SYNC NOTE: Fragment spreads are duplicated across three locations below:
 *   1. Top-level `sections { ... }` — all 10 types + deprecated stubs
 *   2. Container `slots.slotContent { ... }` — leaf types only (no VideoHero)
 *   3. Section wrapper `sectionContent { ... }` — leaf types + Container (no VideoHero)
 * When adding/removing a section type, update all three locations.
 */
export const GET_WATCH_EXPERIENCE = graphql(
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
            ...WatchMediaCollection
          }
          ... on ComponentSectionsCta {
            ...WatchCta
          }
          ... on ComponentSectionsVideoHero {
            ...WatchVideoHero
          }
          ... on ComponentSectionsText {
            ...WatchText
          }
          ... on ComponentSectionsRelatedQuestions {
            ...WatchRelatedQuestions
          }
          ... on ComponentSectionsBibleQuotesCarousel {
            ...WatchBibleQuotesCarousel
          }
          ... on ComponentSectionsCard {
            ...WatchCard
          }
          ... on ComponentSectionsVideo {
            ...WatchVideoSection
          }

          ... on ComponentSectionsPromoBanner {
            id
          }
          ... on ComponentSectionsInfoBlocks {
            id
          }

          ... on ComponentSectionsContainer {
            id
            sectionKey
            slots {
              id
              gridSpan
              slotContent: content {
                __typename
                ... on ComponentSectionsMediaCollection {
                  ...WatchMediaCollection
                }
                ... on ComponentSectionsCta {
                  ...WatchCta
                }
                ... on ComponentSectionsText {
                  ...WatchText
                }
                ... on ComponentSectionsRelatedQuestions {
                  ...WatchRelatedQuestions
                }
                ... on ComponentSectionsBibleQuotesCarousel {
                  ...WatchBibleQuotesCarousel
                }
                ... on ComponentSectionsCard {
                  ...WatchCard
                }
                ... on ComponentSectionsVideo {
                  ...WatchVideoSection
                }
              }
            }
          }

          ... on ComponentSectionsSection {
            id
            sectionKey
            backgroundColor
            blurHash
            sectionContent: content {
              __typename
              ... on ComponentSectionsMediaCollection {
                ...WatchMediaCollection
              }
              ... on ComponentSectionsCta {
                ...WatchCta
              }
              ... on ComponentSectionsText {
                ...WatchText
              }
              ... on ComponentSectionsRelatedQuestions {
                ...WatchRelatedQuestions
              }
              ... on ComponentSectionsBibleQuotesCarousel {
                ...WatchBibleQuotesCarousel
              }
              ... on ComponentSectionsCard {
                ...WatchCard
              }
              ... on ComponentSectionsVideo {
                ...WatchVideoSection
              }
              ... on ComponentSectionsPromoBanner {
                id
              }
              ... on ComponentSectionsInfoBlocks {
                id
              }
              ... on ComponentSectionsContainer {
                id
                sectionKey
                slots {
                  id
                  gridSpan
                  slotContent: content {
                    __typename
                    ... on ComponentSectionsMediaCollection {
                      ...WatchMediaCollection
                    }
                    ... on ComponentSectionsCta {
                      ...WatchCta
                    }
                    ... on ComponentSectionsText {
                      ...WatchText
                    }
                    ... on ComponentSectionsRelatedQuestions {
                      ...WatchRelatedQuestions
                    }
                    ... on ComponentSectionsBibleQuotesCarousel {
                      ...WatchBibleQuotesCarousel
                    }
                    ... on ComponentSectionsCard {
                      ...WatchCard
                    }
                    ... on ComponentSectionsVideo {
                      ...WatchVideoSection
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
  [
    watchMediaCollectionFragment,
    watchCtaFragment,
    watchVideoHeroFragment,
    watchTextFragment,
    watchRelatedQuestionsFragment,
    watchBibleQuotesCarouselFragment,
    watchCardFragment,
    watchVideoSectionFragment,
  ],
)

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
