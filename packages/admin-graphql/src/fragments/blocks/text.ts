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
    imageAssetId
    imageAsset {
      id
      previewUrl
      blurDataUrl
      dominantColor
      width
      height
    }
    backgroundColor
  }
`)
