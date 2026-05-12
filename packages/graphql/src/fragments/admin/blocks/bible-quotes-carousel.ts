import { adminGraphql } from "../../../admin"

export const adminBibleQuotesCarouselFragment = adminGraphql(`
  fragment AdminBibleQuotesCarousel on BibleQuotesCarouselBlock @_unmask {
    __typename
    t
    sectionKey
    heading
    imageUrl
    imageAssetId
    backgroundColor
    quotes {
      reference
      text
      attribution
      imageUrl
      imageAssetId
      backgroundImageUrl
      backgroundImageAssetId
      backgroundColor
      ctaEnabled
      ctaLabel
      ctaLink
    }
  }
`)
