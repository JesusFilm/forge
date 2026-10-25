import { adminGraphql } from "../../admin"
import { adminBlockVideoDubFragment } from "./video-dub"

/** Flat video metadata — no Strapi-style `videoRef { ... }` join; `mediaUrl` replaces `media { url }`. */
export const adminVideoFragment = adminGraphql(
  `
    fragment AdminVideoSection on VideoBlock @_unmask {
      __typename
      t
      sectionKey
      useRouteVideo
      title
      subtitle
      titleSource
      subtitleSource
      videoId
      languageId
      videoDub {
        ...AdminBlockVideoDub
      }
      mediaUrl
      mediaAssetId
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
