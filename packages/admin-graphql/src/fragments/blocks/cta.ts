import { adminGraphql } from "../../admin"

export const adminCtaFragment = adminGraphql(`
  fragment AdminCta on CtaBlock @_unmask {
    __typename
    t
    sectionKey
    ctaHeading: heading
    body
    buttonLabel
    buttonLink
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
    ctaVariant: variant
  }
`)
