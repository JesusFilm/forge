// LEGACY PROPS-ONLY — Strapi fragment kept for prop-type derivation
// in section components (`FragmentOf<typeof xFragment>`). Runtime data
// is admin-shape post-U22; this fragment never reaches an admin Apollo
// query. Do not add new operations against it. Migrating section
// components to AdminFragmentOf is a clean follow-up bundle — see
// apps/web/CLAUDE.md "Common Pitfalls".
import { graphql } from "@forge/graphql"
import { mediaCollectionFragment } from "./media-collection"

export const containerFragment = graphql(
  `
    fragment Container on ComponentSectionsContainer @_unmask {
      id
      sectionKey
      slots {
        id
        gridSpan
        spans
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
            ...MediaCollection
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
            useRouteVideo
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
  `,
  [mediaCollectionFragment],
)
