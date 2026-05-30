import { adminGraphql } from "../../admin"

export const adminPromoBannerFragment = adminGraphql(`
  fragment AdminPromoBanner on PromoBannerBlock @_unmask {
    __typename
    t
    sectionKey
    promoHeading: heading
    promoDescription: description
    intro
    promoCtaLink: ctaLink
    ctaEnabled
    ctaLabel
    widthPercent
    imageUrl
    imageAssetId
    backgroundColor
  }
`)
