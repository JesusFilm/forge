import { adminGraphql } from "../../../admin"
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

/**
 * ContainerBlock — admin's flat container shape. Slot dividers are
 * sibling `containerSlot` markers inside `content[]`; no
 * `slots[].content[]` nesting like Strapi.
 *
 * The 10-member ContainerContentBlock union mirrors admin's Zod
 * `ContainerContentBlockSchema` exactly (see
 * apps/admin/src/graphql/types/blocks.ts).
 */
export const adminContainerFragment = adminGraphql(
  `
    fragment AdminContainer on ContainerBlock @_unmask {
      __typename
      t
      sectionKey
      backgroundColor
      backgroundImageUrl
      backgroundImageAssetId
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
