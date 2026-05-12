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
 * Root admin-shape `WatchExperience` fragment on `ExperienceLocale`.
 *
 * Mirrors the Strapi `WatchExperience` fragment vocabulary so consumer
 * apps can switch between Strapi and admin sources without rewriting
 * downstream rendering. Field-level diffs:
 *
 *   - Strapi: `documentId`. Admin: `id` (cuid string). Aliased to
 *     `documentId` so renderers consuming `exp.documentId` keep
 *     working unmodified.
 *   - Strapi: `ogImage { url, width, height, alternativeText }`.
 *     Admin: `ogImageUrl: String` (single scalar). The admin shape
 *     synthesizes the missing `width / height / alternativeText` as
 *     `null` at the consumer boundary (see normalizeAdmin); renderers
 *     reading `exp.ogImage?.url` get the URL from `ogImageUrl`
 *     aliased to `ogImage_url` — but we keep two parallel selections
 *     here (`ogImageUrl` + the aliased `ogImage` shape) so consumers
 *     can pick the form that matches their existing accessor.
 *   - Strapi: `isTemplate` lives on the Experience parent. Admin: on
 *     the parent Experience too, but ExperienceLocale carries
 *     `isHomepage` for homepage-routing affordance.
 *
 * The 17-member `ExperienceBlock` union covers every top-level block
 * kind admin's editor can store (see apps/admin/src/graphql/types/blocks.ts).
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
