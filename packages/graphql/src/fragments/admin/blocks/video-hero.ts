import { adminGraphql } from "../../../admin"

/** Flat-video posture (no `video { ... }` join); admin returns `videoId` + `streamingUrl` only. */
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
