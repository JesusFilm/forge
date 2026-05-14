import { adminGraphql } from "../../admin"

export const adminVideoCarouselFragment = adminGraphql(`
  fragment AdminVideoCarousel on VideoCarouselBlock @_unmask {
    __typename
    t
    sectionKey
    title
    subtitle
    carouselDescription: description
    itemsSource
    imageUrl
    imageAssetId
    backgroundColor
    items {
      videoId
      streamingUrl
      imageUrl
      imageAssetId
      imageOverrideUrl
      imageOverrideAssetId
      titleOverride
      subtitleOverride
      backgroundColor
    }
  }
`)
