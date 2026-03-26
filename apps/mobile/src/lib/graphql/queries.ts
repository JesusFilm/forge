import { parse, type DocumentNode } from "graphql"

// ---------------------------------------------------------------------------
// Types — defined locally so Expo has no dependency on @forge/graphql.
// ---------------------------------------------------------------------------

export interface WatchExperienceQueryVariables {
  locale: string
  filters: Record<string, unknown>
}

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
    | "ComponentSectionsNavigationCarousel"
  id: string
}

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
            imageAlt
            images {
              url
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
              imageAlt
              images {
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
            imageUrl
            backgroundColor
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
            imageAlt
            images {
              url
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
        ... on ComponentSectionsNavigationCarousel {
          id
          sectionKey
          items {
            id
            contentId
            title
            category
            imageUrl
            backgroundColor
          }
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
                  imageAlt
                  images {
                    url
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
                    imageAlt
                    images {
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
                  imageUrl
                  backgroundColor
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
                imageAlt
                images {
                  url
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
                  imageAlt
                  images {
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
                imageUrl
                backgroundColor
                backgroundImage {
                  url
                  alternativeText
                }
              }
            }
            ... on ComponentSectionsNavigationCarousel {
              id
              sectionKey
              items {
                id
                contentId
                title
                category
                imageUrl
                backgroundColor
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
                      imageAlt
                      images {
                        url
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
                        imageAlt
                        images {
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
                      imageUrl
                      backgroundColor
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
