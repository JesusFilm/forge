import { adminGraphql } from "../../../admin"

/**
 * Admin-shape AdventCountdownBlock fragment. Field aliases mirror the
 * Strapi watch-experience fragment vocabulary so consuming renderers
 * keep the same destructure shape across the cutover.
 */
export const adminAdventCountdownFragment = adminGraphql(`
  fragment AdminAdventCountdown on AdventCountdownBlock @_unmask {
    __typename
    t
    sectionKey
    adventTitle: title
    scripture
    scriptureReference
    locale
    imageUrl
    imageAssetId
    backgroundColor
  }
`)
