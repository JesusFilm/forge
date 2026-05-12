import { adminGraphql } from "../../../admin"

/**
 * VideoHeroBlock — full-bleed hero video. Same flat-video posture as
 * VideoBlock: admin returns `videoId` + `streamingUrl` only. No nested
 * `video { documentId, title, slug, images { url } }` join.
 */
export const adminVideoHeroFragment = adminGraphql(`
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
    streamingUrl
    videoId
    clipStartSeconds
    clipEndSeconds
    autoplay
    muted
    loop
    showControls
  }
`)
