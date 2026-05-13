import { adminGraphql } from "../../admin"
import { adminAdventCountdownFragment } from "./blocks/advent-countdown"
import { adminBibleQuotesCarouselFragment } from "./blocks/bible-quotes-carousel"
import { adminCardFragment } from "./blocks/card"
import { adminContainerFragment } from "./blocks/container"
import { adminCtaFragment } from "./blocks/cta"
import { adminEasterDatesFragment } from "./blocks/easter-dates"
import { adminInfoBlocksFragment } from "./blocks/info-blocks"
import { adminMediaCollectionFragment } from "./blocks/media-collection"
import { adminNavigationCarouselFragment } from "./blocks/navigation-carousel"
import { adminPromoBannerFragment } from "./blocks/promo-banner"
import { adminRelatedQuestionsFragment } from "./blocks/related-questions"
import { adminSectionFragment } from "./blocks/section"
import { adminTextFragment } from "./blocks/text"
import { adminVideoFragment } from "./blocks/video"
import { adminVideoCarouselFragment } from "./blocks/video-carousel"
import { adminVideoHeroFragment } from "./blocks/video-hero"
import { adminVideoRecommendationsFragment } from "./blocks/video-recommendations"

/**
 * Root admin-shape WatchExperience fragment on ExperienceLocale.
 * Mirrors Strapi vocabulary via aliases so consumer renderers stay byte-
 * identical across the cutover. Diffs:
 *   - admin `id` (cuid) ≠ Strapi `documentId` (aliased so renderers work)
 *   - admin `ogImageUrl: String` ≠ Strapi `ogImage { url, width, height, alt }`
 *     (missing dimensions synthesized as null in normalizeAdmin)
 */
export const adminWatchExperienceFragment = adminGraphql(
  `
    fragment AdminWatchExperience on ExperienceLocale @_unmask {
      __typename
      id
      slug
      locale
      isHomepage
      title
      metaDescription
      ogTitle
      ogDescription
      ogImageUrl
      pathSegment
      blocks {
        __typename
        ... on AdventCountdownBlock {
          ...AdminAdventCountdown
        }
        ... on BibleQuotesCarouselBlock {
          ...AdminBibleQuotesCarousel
        }
        ... on CardBlock {
          ...AdminCard
        }
        ... on ContainerBlock {
          ...AdminContainer
        }
        ... on CtaBlock {
          ...AdminCta
        }
        ... on EasterDatesBlock {
          ...AdminEasterDates
        }
        ... on InfoBlocksBlock {
          ...AdminInfoBlocks
        }
        ... on MediaCollectionBlock {
          ...AdminMediaCollection
        }
        ... on NavigationCarouselBlock {
          ...AdminNavigationCarousel
        }
        ... on PromoBannerBlock {
          ...AdminPromoBanner
        }
        ... on RelatedQuestionsBlock {
          ...AdminRelatedQuestions
        }
        ... on SectionBlock {
          ...AdminSection
        }
        ... on TextBlock {
          ...AdminText
        }
        ... on VideoBlock {
          ...AdminVideoSection
        }
        ... on VideoCarouselBlock {
          ...AdminVideoCarousel
        }
        ... on VideoHeroBlock {
          ...AdminVideoHero
        }
        ... on VideoRecommendationsBlock {
          ...AdminVideoRecommendations
        }
      }
    }
  `,
  [
    adminAdventCountdownFragment,
    adminBibleQuotesCarouselFragment,
    adminCardFragment,
    adminContainerFragment,
    adminCtaFragment,
    adminEasterDatesFragment,
    adminInfoBlocksFragment,
    adminMediaCollectionFragment,
    adminNavigationCarouselFragment,
    adminPromoBannerFragment,
    adminRelatedQuestionsFragment,
    adminSectionFragment,
    adminTextFragment,
    adminVideoFragment,
    adminVideoCarouselFragment,
    adminVideoHeroFragment,
    adminVideoRecommendationsFragment,
  ],
)
