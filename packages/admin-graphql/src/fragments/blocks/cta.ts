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
    imageUrl
    imageAssetId
    backgroundColor
    ctaVariant: variant
  }
`)
