import { adminGraphql } from "../../admin"
import { adminBlockVideoDubFragment } from "./video-dub"

export const adminVideoCarouselFragment = adminGraphql(
  `
    fragment AdminVideoCarousel on VideoCarouselBlock @_unmask {
      __typename
      t
      sectionKey
      title
      subtitle
      carouselDescription: description
      itemsSource
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
        videoId
        languageId
        videoDub {
          ...AdminBlockVideoDub
        }
        imageAssetId
        imageAsset {
          id
          previewUrl
          blurDataUrl
          dominantColor
          width
          height
        }
        titleOverride
        subtitleOverride
        backgroundColor
      }
    }
  `,
  [adminBlockVideoDubFragment],
)
