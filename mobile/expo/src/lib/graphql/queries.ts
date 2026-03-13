import { parse, type DocumentNode } from "graphql"

/**
 * Re-export types from the shared GraphQL package.
 * The query itself is defined locally so Expo can request additional
 * fields (e.g. EasterDates) without modifying the shared package.
 */
export {
  type WatchExperience,
  type WatchExperienceQueryResult,
  type WatchExperienceQueryVariables,
  type WatchExperienceBlock,
} from "@forge/graphql"

import type { WatchExperienceBlock } from "@forge/graphql"

/** Alias for sectionMapper (schema field is blocks). */
export type WatchExperienceSection = WatchExperienceBlock

/**
 * Watch experience query with all section types.
 *
 * This is a local copy of the shared query with expanded EasterDates
 * fields. Expo owns its own query so it can evolve independently.
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
        ... on ComponentSectionsEasterDates {
          id
          sectionKey
          easterDatesTitle
          westernEasterLabel
          orthodoxEasterLabel
          passoverLabel
          locale
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
              ... on ComponentSectionsEasterDates {
                id
                sectionKey
                easterDatesTitle
                westernEasterLabel
                orthodoxEasterLabel
                passoverLabel
                locale
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
            ... on ComponentSectionsEasterDates {
              id
              sectionKey
              easterDatesTitle
              westernEasterLabel
              orthodoxEasterLabel
              passoverLabel
              locale
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
                  ... on ComponentSectionsEasterDates {
                    id
                    sectionKey
                    easterDatesTitle
                    westernEasterLabel
                    orthodoxEasterLabel
                    passoverLabel
                    locale
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
