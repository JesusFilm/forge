import { graphql } from "@forge/graphql"
import { adventCountdownFragment } from "./advent-countdown"
import { bibleQuotesCarouselFragment } from "./bible-quotes-carousel"
import { containerFragment } from "./container"
import { ctaSectionFragment } from "./cta-section"
import { easterDatesFragment } from "./easter-dates"
import { infoBlocksFragment } from "./info-blocks"
import { mediaCollectionFragment } from "./media-collection"
import { navigationCarouselFragment } from "./navigation-carousel"
import { promoBannerFragment } from "./promo-banner"
import { relatedQuestionsFragment } from "./related-questions"
import { sectionFragment } from "./section"
import { textSectionFragment } from "./text-section"
import { videoCarouselFragment } from "./video-carousel"
import { videoHeroFragment } from "./video-hero"
import { videoSectionFragment } from "./video-section"

export const watchExperienceFragment = graphql(
  `
    fragment WatchExperience on Experience @_unmask {
      documentId
      slug
      locale
      title
      metaDescription
      ogTitle
      ogDescription
      pathSegment
      ogImage {
        url
        width
        height
        alternativeText
      }
      blocks {
        __typename
        ... on ComponentSectionsMediaCollection {
          ...MediaCollection
        }
        ... on ComponentSectionsPromoBanner {
          ...PromoBanner
        }
        ... on ComponentSectionsInfoBlocks {
          ...InfoBlocks
        }
        ... on ComponentSectionsCta {
          ...CTASection
        }
        ... on ComponentSectionsVideoHero {
          ...VideoHero
        }
        ... on ComponentSectionsBibleQuotesCarousel {
          ...BibleQuotesCarousel
        }
        ... on ComponentSectionsText {
          ...TextSection
        }
        ... on ComponentSectionsEasterDates {
          ...EasterDates
        }
        ... on ComponentSectionsAdventCountdown {
          ...AdventCountdown
        }
        ... on ComponentSectionsContainer {
          ...Container
        }
        ... on ComponentSectionsVideo {
          ...VideoSection
        }
        ... on ComponentSectionsSection {
          ...Section
        }
        ... on ComponentSectionsRelatedQuestions {
          ...RelatedQuestions
        }
        ... on ComponentSectionsVideoCarousel {
          ...VideoCarousel
        }
        ... on ComponentSectionsNavigationCarousel {
          ...NavigationCarousel
        }
      }
    }
  `,
  [
    mediaCollectionFragment,
    promoBannerFragment,
    infoBlocksFragment,
    ctaSectionFragment,
    videoHeroFragment,
    videoSectionFragment,
    bibleQuotesCarouselFragment,
    textSectionFragment,
    easterDatesFragment,
    adventCountdownFragment,
    containerFragment,
    sectionFragment,
    videoCarouselFragment,
    relatedQuestionsFragment,
    navigationCarouselFragment,
  ],
)
