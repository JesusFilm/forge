import { adminGraphql } from "../../admin"

export const adminWatchHomeLanguagesFragment = adminGraphql(`
  fragment AdminWatchHomeLanguages on WatchHomeLanguagesBlock @_unmask {
    t
    sectionKey
  }
`)
