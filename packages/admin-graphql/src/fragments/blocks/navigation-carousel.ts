import { adminGraphql } from "../../admin"

export const adminNavigationCarouselFragment = adminGraphql(`
  fragment AdminNavigationCarousel on NavigationCarouselBlock @_unmask {
    __typename
    t
    sectionKey
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
    items {
      contentId
      title
      category
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
    }
  }
`)
