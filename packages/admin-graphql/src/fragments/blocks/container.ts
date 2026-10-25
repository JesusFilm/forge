import { adminGraphql } from "../../admin"
import { adminAdventCountdownFragment } from "./advent-countdown"
import { adminBibleQuotesCarouselFragment } from "./bible-quotes-carousel"
import { adminCardFragment } from "./card"
import { adminContainerSlotFragment } from "./container-slot"
import { adminCtaFragment } from "./cta"
import { adminEasterDatesFragment } from "./easter-dates"
import { adminMediaCollectionFragment } from "./media-collection"
import { adminRelatedQuestionsFragment } from "./related-questions"
import { adminTextFragment } from "./text"
import { adminVideoFragment } from "./video"

/** Flat container — slot dividers are sibling `containerSlot` markers in `content[]`, not Strapi-style `slots[].content[]`. */
export const adminContainerFragment = adminGraphql(
  `
    fragment AdminContainer on ContainerBlock @_unmask {
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
      content {
        __typename
        ... on AdventCountdownBlock {
          ...AdminAdventCountdown
        }
        ... on BibleQuotesCarouselBlock {
          ...AdminBibleQuotesCarousel
        }
        ... on CardBlock {
          ...AdminCard
        }
        ... on ContainerSlotBlock {
          ...AdminContainerSlot
        }
        ... on CtaBlock {
          ...AdminCta
        }
        ... on EasterDatesBlock {
          ...AdminEasterDates
        }
        ... on MediaCollectionBlock {
          ...AdminMediaCollection
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
      }
    }
  `,
  [
    adminAdventCountdownFragment,
    adminBibleQuotesCarouselFragment,
    adminCardFragment,
    adminContainerSlotFragment,
    adminCtaFragment,
    adminEasterDatesFragment,
    adminMediaCollectionFragment,
    adminRelatedQuestionsFragment,
    adminTextFragment,
    adminVideoFragment,
  ],
)
