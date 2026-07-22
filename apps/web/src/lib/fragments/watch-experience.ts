import { adminGraphql } from "@forge/admin-graphql"
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"

import { watchMediaCollectionTitlesFragment } from "./watch-media-collection-titles"

// Compose Web's locale-aware media collection titles over the canonical Watch
// Experience projection. The extension stays local so native consumers retain
// the shared operation text without resolvedTitle resolver work.
export const watchExperienceFragment = adminGraphql(
  `
    fragment WatchExperience on ExperienceLocale @_unmask {
      ...AdminWatchExperience
      ...WatchMediaCollectionTitles
    }
  `,
  [adminWatchExperienceFragment, watchMediaCollectionTitlesFragment],
)
