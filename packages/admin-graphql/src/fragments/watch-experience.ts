import { adminGraphql } from "../admin"
import { adminAdventCountdownFragment } from "./blocks/advent-countdown"
import { adminBibleQuotesCarouselFragment } from "./blocks/bible-quotes-carousel"
import { adminCardFragment } from "./blocks/card"
import { adminContainerFragment } from "./blocks/container"
import { adminCtaFragment } from "./blocks/cta"
import { adminEasterDatesFragment } from "./blocks/easter-dates"
import { adminInfoBlocksFragment } from "./blocks/info-blocks"
import { adminLanguageGlobeFragment } from "./blocks/language-globe"
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
import { adminWatchHomeCategoryRailFragment } from "./blocks/watch-home-category-rail"
import { adminWatchHomeHeroFragment } from "./blocks/watch-home-hero"

// Root WatchExperience fragment on ExperienceLocale.
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
        ... on LanguageGlobeBlock {
          ...AdminLanguageGlobe
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
        ... on WatchHomeCategoryRailBlock {
          ...AdminWatchHomeCategoryRail
        }
        ... on WatchHomeHeroBlock {
          ...AdminWatchHomeHero
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
    adminLanguageGlobeFragment,
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
    adminWatchHomeCategoryRailFragment,
    adminWatchHomeHeroFragment,
  ],
)

// Temporary rollout-only projection for Web instances that can reach an Admin
// schema deployed before WatchHomeCategoryRailBlock existed. Keep this document
// identical to AdminWatchExperience except for that one type and dependency;
// once old Admin schemas cannot serve Web traffic, delete this compatibility
// fragment together with Web's retry path.
export const adminLegacyWatchExperienceFragment = adminGraphql(
  `
    fragment AdminLegacyWatchExperience on ExperienceLocale @_unmask {
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
        ... on LanguageGlobeBlock {
          ...AdminLanguageGlobe
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
        ... on WatchHomeHeroBlock {
          ...AdminWatchHomeHero
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
    adminLanguageGlobeFragment,
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
    adminWatchHomeHeroFragment,
  ],
)
