import { adminGraphql } from "../../admin"
import { adminBlockVideoDubFragment } from "./video-dub"

/** Blocks store video identity; admin resolves playable dub data dynamically. */
export const adminVideoHeroFragment = adminGraphql(
  `
    fragment AdminVideoHero on VideoHeroBlock @_unmask {
      __typename
      t
      sectionKey
      useRouteVideo
      heading
      subheading
      headingSource
      subheadingSource
      ctaEnabled
      ctaLabel
      ctaLink
      videoId
      languageId
      videoDub {
        ...AdminBlockVideoDub
      }
      clipStartSeconds
      clipEndSeconds
      autoplay
      muted
      loop
      showControls
    }
  `,
  [adminBlockVideoDubFragment],
)
