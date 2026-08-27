import { adminGraphql } from "../../admin"

export const adminWatchHomeCategoryRailFragment = adminGraphql(`
  fragment AdminWatchHomeCategoryRail on WatchHomeCategoryRailBlock @_unmask {
    t
    sectionKey
    categoryIds
  }
`)
