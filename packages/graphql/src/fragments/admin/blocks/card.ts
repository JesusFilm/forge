import { adminGraphql } from "../../../admin"

/** Admin-only (no Strapi precedent). Web renderer doesn't dispatch yet. */
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
