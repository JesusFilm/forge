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
      imageUrl
      imageAssetId
      backgroundColor
      items {
        videoId
        languageId
        videoDub {
          ...AdminBlockVideoDub
        }
        imageUrl
        imageAssetId
        titleOverride
        subtitleOverride
        backgroundColor
      }
    }
  `,
  [adminBlockVideoDubFragment],
)
