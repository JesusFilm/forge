import { graphql } from "@forge/graphql"

export const sectionFragment = graphql(`
  fragment Section on ComponentSectionsSection @_unmask {
    id
    sectionKey
    backgroundColor
    backgroundOpacity
    dynamicBackgroundImage
    blurHash
    sectionContent: content {
      __typename
      ... on ComponentSectionsContainer {
        ...Container
      }
      ... on ComponentSectionsVideo {
        ...VideoSection
      }
      ... on ComponentSectionsRelatedQuestions {
        ...RelatedQuestions
      }
      ... on ComponentSectionsBibleQuotesCarousel {
        ...BibleQuotesCarousel
      }
      ... on ComponentSectionsMediaCollection {
        ...MediaCollection
      }
      ... on ComponentSectionsVideoCarousel {
        ...VideoCarousel
      }
      ... on ComponentSectionsQuizButton {
        id
        buttonText
        iframeSrc
      }
    }
  }
`)
