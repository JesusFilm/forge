import { graphql } from "@forge/graphql"

export const sectionFragment = graphql(`
  fragment Section on ComponentSectionsSection @_unmask {
    id
    sectionKey
    backgroundColor
    backgroundOpacity
    dynamicBackgroundImage
    staticOverlay
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
      ... on ComponentSectionsQuizButton {
        id
        buttonText
        iframeSrc
      }
      ... on ComponentSectionsVideoCarousel {
        ...VideoCarousel
      }
      ... on ComponentSectionsNavigationCarousel {
        ...NavigationCarousel
      }
    }
  }
`)
