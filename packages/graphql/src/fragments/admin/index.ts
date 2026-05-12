// Admin-shape fragments for the web/mobile/tv `WatchExperience` route.
// Authored against admin's regenerated SDL (apps/admin/schema.graphql)
// via the `adminGraphql()` factory. Field aliases on shared fragment
// selections preserve the Strapi fragment vocabulary so downstream
// renderers in `apps/web/src/components/sections/` stay byte-identical
// across the cutover.
//
// Used by `apps/web/src/lib/content.ts` once U6 wires admin-mode
// fetching, AND available for future apps/mobile + apps/tv reuse.

export { adminAdventCountdownFragment } from "./blocks/advent-countdown"
export { adminBibleQuotesCarouselFragment } from "./blocks/bible-quotes-carousel"
export { adminCardFragment } from "./blocks/card"
export { adminContainerFragment } from "./blocks/container"
export { adminContainerSlotFragment } from "./blocks/container-slot"
export { adminCtaFragment } from "./blocks/cta"
export { adminEasterDatesFragment } from "./blocks/easter-dates"
export { adminInfoBlocksFragment } from "./blocks/info-blocks"
export { adminMediaCollectionFragment } from "./blocks/media-collection"
export { adminNavigationCarouselFragment } from "./blocks/navigation-carousel"
export { adminPromoBannerFragment } from "./blocks/promo-banner"
export { adminQuizButtonFragment } from "./blocks/quiz-button"
export { adminRelatedQuestionsFragment } from "./blocks/related-questions"
export { adminSectionFragment } from "./blocks/section"
export { adminTextFragment } from "./blocks/text"
export { adminVideoFragment } from "./blocks/video"
export { adminVideoCarouselFragment } from "./blocks/video-carousel"
export { adminVideoHeroFragment } from "./blocks/video-hero"
export { adminVideoRecommendationsFragment } from "./blocks/video-recommendations"
export { adminWatchExperienceFragment } from "./watch-experience"
