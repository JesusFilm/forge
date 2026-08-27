import { adminGraphql } from "@forge/admin-graphql"
import {
  adminLegacyWatchExperienceFragment,
  adminWatchExperienceFragment,
} from "@forge/admin-graphql/fragments"

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

// Rollout-only equivalent that composes the old-schema-safe canonical
// fragment. Keep the Web-local title extension so a compatibility retry loses
// only the category block selection, not existing media collection copy.
export const legacyWatchExperienceFragment = adminGraphql(
  `
    fragment LegacyWatchExperience on ExperienceLocale @_unmask {
      ...AdminLegacyWatchExperience
      ...WatchMediaCollectionTitles
    }
  `,
  [adminLegacyWatchExperienceFragment, watchMediaCollectionTitlesFragment],
)
