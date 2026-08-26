import type { ErrorLike } from "@apollo/client"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import {
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
  adminVideoCarouselFragment,
  adminVideoFragment,
  adminVideoHeroFragment,
  adminVideoRecommendationsFragment,
  adminWatchHomeCategoryRailFragment,
  adminWatchHomeHeroFragment,
} from "@forge/admin-graphql/fragments"

import client from "@/lib/admin-client"

const EXPERIENCE_PREVIEW = adminGraphql(
  `
    query ExperiencePreview($token: String!) {
      experiencePreview(token: $token) {
        experienceId
        localeId
        locale
        slug
        isHomepage
        title
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

type ExperiencePreviewData = AdminResultOf<typeof EXPERIENCE_PREVIEW>
export type ExperiencePreview = NonNullable<
  ExperiencePreviewData["experiencePreview"]
>

/**
 * Capability-only preview fetch. The token stays server-side, the response is
 * never written to Apollo's cache, and failures do not include the token.
 */
export async function getExperiencePreview(
  token: string,
): Promise<ExperiencePreview | null> {
  try {
    const result = await client.query({
      query: EXPERIENCE_PREVIEW,
      variables: { token },
      fetchPolicy: "no-cache",
      context: {
        fetchOptions: { cache: "no-store" },
      },
    })
    const response = result as typeof result & {
      error?: ErrorLike
      errors?: readonly unknown[]
    }
    if (response.error || response.errors?.length) {
      throw new Error("Experience preview query failed")
    }
    return result.data?.experiencePreview ?? null
  } catch {
    throw new Error("Experience preview query failed")
  }
}
