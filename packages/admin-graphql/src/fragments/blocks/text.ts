import { adminGraphql } from "../../admin"

export const adminTextFragment = adminGraphql(`
  fragment AdminText on TextBlock @_unmask {
    __typename
    t
    sectionKey
    heading
    headingLevel
    subtitle
    contentParagraphs
    textVariant: variant
    imageUrl
    imageAssetId
    backgroundColor
  }
`)
