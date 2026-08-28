import { adminGraphql } from "../../admin"

export const adminWatchHomeCategoryRailFragment = adminGraphql(`
  fragment AdminWatchHomeCategoryRail on WatchHomeCategoryRailBlock @_unmask {
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
