import { adminGraphql } from "../../admin"
import { adminBibleQuotesCarouselFragment } from "./bible-quotes-carousel"
import { adminCardFragment } from "./card"
import { adminContainerFragment } from "./container"
import { adminCtaFragment } from "./cta"
import { adminInfoBlocksFragment } from "./info-blocks"
import { adminMediaCollectionFragment } from "./media-collection"
import { adminNavigationCarouselFragment } from "./navigation-carousel"
import { adminPromoBannerFragment } from "./promo-banner"
import { adminQuizButtonFragment } from "./quiz-button"
import { adminRelatedQuestionsFragment } from "./related-questions"
import { adminTextFragment } from "./text"
import { adminVideoFragment } from "./video"
import { adminVideoCarouselFragment } from "./video-carousel"

/** SectionBlock cannot nest another SectionBlock; ContainerBlock IS allowed. */
export const adminSectionFragment = adminGraphql(
  `
    fragment AdminSection on SectionBlock @_unmask {
      __typename
      t
      sectionKey
      backgroundColor
      backgroundImageAssetId
      backgroundImageAsset {
        id
        previewUrl
        blurDataUrl
        dominantColor
        width
        height
      }
      backgroundOpacity
      dynamicBackgroundImage
      staticOverlay
      blurHash
      sectionContent: content {
        __typename
        ... on BibleQuotesCarouselBlock {
          ...AdminBibleQuotesCarousel
        }
        ... on CardBlock {
          ...AdminCard
        }
        ... on ContainerBlock {
          ...AdminContainer
        }
        ... on CtaBlock {
          ...AdminCta
        }
        ... on InfoBlocksBlock {
          ...AdminInfoBlocks
        }
        ... on MediaCollectionBlock {
          ...AdminMediaCollection
        }
        ... on NavigationCarouselBlock {
          ...AdminNavigationCarousel
        }
        ... on PromoBannerBlock {
          ...AdminPromoBanner
        }
        ... on QuizButtonBlock {
          ...AdminQuizButton
        }
        ... on RelatedQuestionsBlock {
          ...AdminRelatedQuestions
        }
        ... on TextBlock {
          ...AdminText
        }
        ... on VideoBlock {
          ...AdminVideoSection
        }
        ... on VideoCarouselBlock {
          ...AdminVideoCarousel
        }
      }
    }
  `,
  [
    adminBibleQuotesCarouselFragment,
    adminCardFragment,
    adminContainerFragment,
    adminCtaFragment,
    adminInfoBlocksFragment,
    adminMediaCollectionFragment,
    adminNavigationCarouselFragment,
    adminPromoBannerFragment,
    adminQuizButtonFragment,
    adminRelatedQuestionsFragment,
    adminTextFragment,
    adminVideoFragment,
    adminVideoCarouselFragment,
  ],
)
