// LEGACY PROPS-ONLY — Strapi fragment kept for prop-type derivation
// in section components (`FragmentOf<typeof xFragment>`). Runtime data
// is admin-shape post-U22; this fragment never reaches an admin Apollo
// query. Do not add new operations against it. Migrating section
// components to AdminFragmentOf is a clean follow-up bundle — see
// apps/web/CLAUDE.md "Common Pitfalls".
import { graphql } from "@/lib/legacy-fragment-types"

export const sectionFragment = graphql(`
  fragment Section on ComponentSectionsSection @_unmask {
    id
    sectionKey
    backgroundColor
    backgroundImageUrl
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
