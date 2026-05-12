import { adminGraphql } from "../../../admin"

/**
 * CardBlock has NO Strapi precedent — admin introduced it post-Strapi.
 * Web renderer doesn't dispatch on it yet; the fragment selects the
 * full admin field set so a future renderer has the types ready.
 */
export const adminCardFragment = adminGraphql(`
  fragment AdminCard on CardBlock @_unmask {
    __typename
    t
    sectionKey
    title
    description
    mediaUrl
    mediaAssetId
    backgroundColor
    link
    variant
  }
`)
