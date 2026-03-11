import { parse, type DocumentNode } from "graphql"
import type { VariablesOf } from "./graphql"
import { graphql } from "./graphql"

/**
 * Minimal typed query used only for VariablesOf inference.
 * @internal — not used at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typedVariables = graphql(`
  query GetWatchExperienceVars(
    $locale: I18NLocaleCode!
    $filters: ExperienceFiltersInput!
  ) {
    experiences(filters: $filters, locale: $locale) {
      documentId
    }
  }
`)

export type WatchExperienceQueryVariables = VariablesOf<typeof _typedVariables>

/**
 * Watch experience query with all 10 section types, including nested
 * Section.content and Container.slots.content dynamic zones.
 *
 * Uses raw `parse()` instead of gql-tada's `graphql()` because gql-tada
 * hits TS2589 ("Type instantiation is excessively deep") when resolving
 * nested union types across 3 levels of dynamic zones (blocks → Section
 * content → Container slot content). The sectionMapper already processes
 * nested content as `any`, so static typing of the full response is not
 * required.
 *
 * Aliases avoid GraphQL field-name conflicts across union members
 * (e.g. `title` String vs String!, `variant` different enums).
 * Alias names match what the Expo sectionMapper expects.
 */
export const GET_WATCH_EXPERIENCE: DocumentNode = parse(/* GraphQL */ `
  query GetWatchExperience(
    $locale: I18NLocaleCode!
    $filters: ExperienceFiltersInput!
  ) {
    experiences(filters: $filters, locale: $locale) {
      documentId
      slug
      blocks {
        __typename
        ... on ComponentSectionsVideoHero {
          id
          sectionKey
          videoHeroHeading: heading
          subheading
          ctaLink
          ctaLabel
          streamingUrl
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
        ... on ComponentSectionsMediaCollection {
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
            }
            itemVideo: video {
              documentId
              title
              slug
              image {
                url
              }
            }
          }
        }
        ... on ComponentSectionsCta {
          id
          sectionKey
          ctaHeading: heading
          body
          buttonLabel
          buttonLink
          ctaVariant: variant
        }
        ... on ComponentSectionsText {
          id
          sectionKey
          textHeading: heading
          headingLevel
          textSubtitle: subtitle
          textContent: contentParagraphs
          textVariant: variant
        }
        ... on ComponentSectionsRelatedQuestions {
          id
          sectionKey
          relatedQuestionsHeading: heading
          questions {
            id
            question
            answer
          }
        }
        ... on ComponentSectionsBibleQuotesCarousel {
          id
          sectionKey
          carouselHeading: heading
          quotes {
            id
            reference
            text
            attribution
            ctaLabel
            ctaLink
            backgroundImage {
              url
              alternativeText
            }
          }
        }
        ... on ComponentSectionsCard {
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
        ... on ComponentSectionsVideo {
          id
          sectionKey
          videoTitle: title
          videoSubtitle: subtitle
          streamingUrl
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
              ... on ComponentSectionsText {
                id
                sectionKey
                textHeading: heading
                headingLevel
                textSubtitle: subtitle
                textContent: contentParagraphs
                textVariant: variant
              }
              ... on ComponentSectionsCta {
                id
                sectionKey
                ctaHeading: heading
                body
                buttonLabel
                buttonLink
                ctaVariant: variant
              }
              ... on ComponentSectionsCard {
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
              ... on ComponentSectionsVideo {
                id
                sectionKey
                videoTitle: title
                videoSubtitle: subtitle
                streamingUrl
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
              ... on ComponentSectionsMediaCollection {
                id
                sectionKey
                mediaCollectionTitle: title
                subtitle
                mediaCollectionDescription: description
                mediaCollectionVariant: variant
                items {
                  id
                  titleOverride
                  subtitleOverride
                  collectionSize
                  linkToSectionKey
                  imageOverride {
                    url
                  }
                  itemVideo: video {
                    documentId
                    title
                    slug
                    image {
                      url
                    }
                  }
                }
              }
              ... on ComponentSectionsRelatedQuestions {
                id
                sectionKey
                relatedQuestionsHeading: heading
                questions {
                  id
                  question
                  answer
                }
              }
              ... on ComponentSectionsBibleQuotesCarousel {
                id
                sectionKey
                carouselHeading: heading
                quotes {
                  id
                  reference
                  text
                  attribution
                  ctaLabel
                  ctaLink
                  backgroundImage {
                    url
                    alternativeText
                  }
                }
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
            ... on ComponentSectionsText {
              id
              sectionKey
              textHeading: heading
              headingLevel
              textSubtitle: subtitle
              textContent: contentParagraphs
              textVariant: variant
            }
            ... on ComponentSectionsCta {
              id
              sectionKey
              ctaHeading: heading
              body
              buttonLabel
              buttonLink
              ctaVariant: variant
            }
            ... on ComponentSectionsCard {
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
            ... on ComponentSectionsVideo {
              id
              sectionKey
              videoTitle: title
              videoSubtitle: subtitle
              streamingUrl
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
            ... on ComponentSectionsMediaCollection {
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
                }
                itemVideo: video {
                  documentId
                  title
                  slug
                  image {
                    url
                  }
                }
              }
            }
            ... on ComponentSectionsRelatedQuestions {
              id
              sectionKey
              relatedQuestionsHeading: heading
              questions {
                id
                question
                answer
              }
            }
            ... on ComponentSectionsBibleQuotesCarousel {
              id
              sectionKey
              carouselHeading: heading
              quotes {
                id
                reference
                text
                attribution
                ctaLabel
                ctaLink
                backgroundImage {
                  url
                  alternativeText
                }
              }
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
                  ... on ComponentSectionsText {
                    id
                    sectionKey
                    textHeading: heading
                    headingLevel
                    textSubtitle: subtitle
                    textContent: contentParagraphs
                    textVariant: variant
                  }
                  ... on ComponentSectionsCta {
                    id
                    sectionKey
                    ctaHeading: heading
                    body
                    buttonLabel
                    buttonLink
                    ctaVariant: variant
                  }
                  ... on ComponentSectionsCard {
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
                  ... on ComponentSectionsVideo {
                    id
                    sectionKey
                    videoTitle: title
                    videoSubtitle: subtitle
                    streamingUrl
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
                  ... on ComponentSectionsMediaCollection {
                    id
                    sectionKey
                    mediaCollectionTitle: title
                    subtitle
                    mediaCollectionDescription: description
                    mediaCollectionVariant: variant
                    items {
                      id
                      titleOverride
                      subtitleOverride
                      imageOverride {
                        url
                      }
                      itemVideo: video {
                        documentId
                        title
                        slug
                        image {
                          url
                        }
                      }
                    }
                  }
                  ... on ComponentSectionsRelatedQuestions {
                    id
                    sectionKey
                    relatedQuestionsHeading: heading
                    questions {
                      id
                      question
                      answer
                    }
                  }
                  ... on ComponentSectionsBibleQuotesCarousel {
                    id
                    sectionKey
                    carouselHeading: heading
                    quotes {
                      id
                      reference
                      text
                      attribution
                      ctaLabel
                      ctaLink
                      backgroundImage {
                        url
                        alternativeText
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`)

/**
 * Result type for the watch experience query.
 * Manually defined because the query uses raw `parse()` instead of
 * gql-tada (see TS2589 comment above).
 */
export interface WatchExperienceQueryResult {
  experiences: WatchExperience[] | null
}

export interface WatchExperience {
  documentId: string
  slug: string
  blocks: (WatchExperienceBlock | null)[] | null
}

/**
 * Union of all block types returned by the query.
 * The sectionMapper switches on `__typename` and uses field aliases.
 * Typed as a loose record so the mapper can access aliased fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WatchExperienceBlock = Record<string, any> & {
  __typename:
    | "ComponentSectionsVideoHero"
    | "ComponentSectionsMediaCollection"
    | "ComponentSectionsCta"
    | "ComponentSectionsText"
    | "ComponentSectionsRelatedQuestions"
    | "ComponentSectionsBibleQuotesCarousel"
    | "ComponentSectionsCard"
    | "ComponentSectionsVideo"
    | "ComponentSectionsContainer"
    | "ComponentSectionsSection"
    | "ComponentSectionsPromoBanner"
    | "ComponentSectionsInfoBlocks"
    | "ComponentSectionsEasterDates"
  id: string
}
