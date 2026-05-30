import { adminGraphql } from "../../admin"

/** Flat video metadata — no Strapi-style `videoRef { ... }` join; `mediaUrl` replaces `media { url }`. */
export const adminVideoFragment = adminGraphql(`
  fragment AdminVideoSection on VideoBlock @_unmask {
    __typename
    t
    sectionKey
    useRouteVideo
    streamingUrl
    title
    subtitle
    titleSource
    subtitleSource
    videoId
    mediaUrl
    mediaAssetId
    clipStartSeconds
    clipEndSeconds
    autoplay
    muted
    loop
    showControls
  }
`)
