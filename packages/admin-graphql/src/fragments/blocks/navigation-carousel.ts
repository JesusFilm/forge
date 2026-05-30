import { adminGraphql } from "../../admin"

export const adminNavigationCarouselFragment = adminGraphql(`
  fragment AdminNavigationCarousel on NavigationCarouselBlock @_unmask {
    __typename
    t
    sectionKey
    imageUrl
    imageAssetId
    backgroundColor
    items {
      contentId
      title
      category
      imageUrl
      imageAssetId
      backgroundColor
    }
  }
`)
