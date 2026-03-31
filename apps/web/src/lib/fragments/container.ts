import { graphql } from "@forge/graphql"

export const containerFragment = graphql(`
  fragment Container on ComponentSectionsContainer @_unmask {
    id
    sectionKey
    slots {
      id
      gridSpan
      content {
        __typename
        ... on ComponentSectionsText {
          id
          sectionKey
          heading
          headingLevel
          subtitle
          contentParagraphs
          textVariant: variant
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
        ... on ComponentSectionsAdventCountdown {
          id
          sectionKey
          adventTitle: title
          scripture
          scriptureReference
          locale
        }
        ... on ComponentSectionsMediaCollection {
          id
          title
          subtitle
          mediaDescription: description
          categoryLabel
          mediaCtaLink: ctaLink
          showItemNumbers
          mediaCollectionVariant: variant
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
              images {
                url
              }
            }
          }
        }
        ... on ComponentSectionsCta {
          id
          ctaHeading: heading
          body
          buttonLabel
          buttonLink
        }
        ... on ComponentSectionsVideo {
          id
          sectionKey
          streamingUrl
          title
          subtitle
          media {
            url
          }
          videoRef: video {
            documentId
            title
            slug
            images {
              url
            }
          }
        }
        ... on ComponentSectionsRelatedQuestions {
          id
          sectionKey
          heading
          ctaLabel
          ctaLink
          questions {
            id
            question
            answer
          }
        }
      }
    }
  }
`)
