import { adminGraphql } from "../../admin"

export const adminWatchHomeCategoryRailFragment = adminGraphql(`
  fragment AdminWatchHomeCategoryRail on WatchHomeCategoryRailBlock @_unmask {
    t
    sectionKey
    eyebrow
    title
    description
    ctaLabel
    categoryIds
    tiles {
      id
      categoryId
      title
      href
      icon
      style
    }
  }
`)

// Rollout-only projection for Web revisions that can reach an Admin schema
// from before the four locale-owned copy fields existed. It deliberately
// retains categoryIds and tiles so copy lag never discards the authored rail.
export const adminPreCopyWatchHomeCategoryRailFragment = adminGraphql(`
  fragment AdminPreCopyWatchHomeCategoryRail on WatchHomeCategoryRailBlock @_unmask {
    t
    sectionKey
    categoryIds
    tiles {
      id
      categoryId
      title
      href
      icon
      style
    }
  }
`)
