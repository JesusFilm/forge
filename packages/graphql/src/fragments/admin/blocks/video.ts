import { adminGraphql } from "../../../admin"

/**
 * VideoBlock — embedded inline video. Admin returns FLAT video metadata
 * (`videoId`, `streamingUrl`, `mediaUrl`); there is no Strapi-style
 * `videoRef { documentId, title, slug, images { url } }` join. The
 * Strapi fragment's `media { url }` projection collapses to the flat
 * `mediaUrl` here; the `videoRef` join collapses to `videoId`.
 */
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
