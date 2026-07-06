import { adminGraphql } from "../../admin"

export const adminWatchHomePromoFragment = adminGraphql(`
  fragment AdminWatchHomePromo on WatchHomePromoBlock @_unmask {
    t
    sectionKey
    eyebrow
    heading
    description
    points {
      icon
      title
      description
    }
    highlightsHeading
    highlights {
      icon
      title
      description
    }
    invitationEyebrow
    invitationHeading
    invitationGradientText
    invitationDescription
    ctaLabel
    ctaLink
  }
`)
