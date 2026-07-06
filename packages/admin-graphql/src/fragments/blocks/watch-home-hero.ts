import { adminGraphql } from "../../admin"

export const adminWatchHomeHeroFragment = adminGraphql(`
  fragment AdminWatchHomeHero on WatchHomeHeroBlock @_unmask {
    t
    sectionKey
  }
`)
