import { adminGraphql } from "../../admin"

export const adminHomepageRecommendationsFragment = adminGraphql(`
  fragment AdminHomepageRecommendations on HomepageRecommendationsBlock @_unmask {
    __typename
    t
    sectionKey
    title
  }
`)
