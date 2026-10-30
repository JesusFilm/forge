import { adminGraphql } from "../../admin"
export const adminWatchAudienceFragment = adminGraphql(`
  fragment AdminWatchAudience on WatchAudienceBlock @_unmask {
    t
    sectionKey
    configurationJson
  }
`)
