export { graphql, readFragment } from "./graphql"
export type { FragmentOf, ResultOf, VariablesOf } from "./graphql"

export { adminGraphql } from "./admin"
export type { AdminFragmentOf, AdminResultOf, AdminVariablesOf } from "./admin"

// Admin-shape fragments (per-block-kind + root WatchExperience). The
// dedicated `@forge/graphql/admin/fragments` subpath is the canonical
// import; re-exporting from the package root keeps `import { ... } from
// "@forge/graphql"` ergonomic for the common case.
export {
  adminAdventCountdownFragment,
  adminBibleQuotesCarouselFragment,
  adminCardFragment,
  adminContainerFragment,
  adminContainerSlotFragment,
  adminCtaFragment,
  adminEasterDatesFragment,
  adminInfoBlocksFragment,
  adminMediaCollectionFragment,
  adminNavigationCarouselFragment,
  adminPromoBannerFragment,
  adminQuizButtonFragment,
  adminRelatedQuestionsFragment,
  adminSectionFragment,
  adminTextFragment,
  adminVideoFragment,
  adminVideoCarouselFragment,
  adminVideoHeroFragment,
  adminVideoRecommendationsFragment,
  adminWatchExperienceFragment,
} from "./fragments/admin"
