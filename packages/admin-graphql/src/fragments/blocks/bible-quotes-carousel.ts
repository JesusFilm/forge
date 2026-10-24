import { adminGraphql } from "../../admin"

export const adminBibleQuotesCarouselFragment = adminGraphql(`
  fragment AdminBibleQuotesCarousel on BibleQuotesCarouselBlock @_unmask {
    __typename
    t
    sectionKey
    heading
    imageAssetId
    imageAsset {
      id
      previewUrl
      blurDataUrl
      dominantColor
      width
      height
    }
    backgroundColor
    quotes {
      reference
      text
      attribution
      imageAssetId
      imageAsset {
        id
        previewUrl
        blurDataUrl
        dominantColor
        width
        height
      }
      backgroundImageAssetId
      backgroundImageAsset {
        id
        previewUrl
        blurDataUrl
        dominantColor
        width
        height
      }
      backgroundColor
      ctaEnabled
      ctaLabel
      ctaLink
    }
  }
`)
