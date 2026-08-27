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

// Rollout-only equivalent for Web revisions that can still reach an Admin
// schema from before WatchHomeCategoryRailBlock existed. Keep this selection
// identical to EXPERIENCE_PREVIEW except for that one inline fragment and
// dependency.
const LEGACY_EXPERIENCE_PREVIEW = adminGraphql(
  `
    query LegacyExperiencePreview($token: String!) {
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
    adminWatchHomeHeroFragment,
  ],
)

type ExperiencePreviewData = AdminResultOf<typeof EXPERIENCE_PREVIEW>
export type ExperiencePreview = NonNullable<
  ExperiencePreviewData["experiencePreview"]
>

type GraphqlErrorCandidate = {
  readonly message?: unknown
  readonly path?: unknown
  readonly extensions?: unknown
}

function graphqlErrorsFrom(value: unknown): GraphqlErrorCandidate[] {
  if (typeof value !== "object" || value === null) return []
  const record = value as { error?: unknown; errors?: unknown }
  const direct = Array.isArray(record.errors) ? record.errors : []
  const nested =
    typeof record.error === "object" &&
    record.error !== null &&
    "errors" in record.error &&
    Array.isArray(record.error.errors)
      ? record.error.errors
      : []

  return [...direct, ...nested].filter(
    (entry): entry is GraphqlErrorCandidate =>
      typeof entry === "object" && entry !== null,
  )
}

function isUnknownCategoryRailTypenameValidation(value: unknown): boolean {
  return graphqlErrorsFrom(value).some((entry) => {
    if (
      typeof entry.message !== "string" ||
      !/^Unknown type "WatchHomeCategoryRailBlock"\./.test(entry.message) ||
      entry.path != null
    ) {
      return false
    }

    const code =
      typeof entry.extensions === "object" &&
      entry.extensions !== null &&
      "code" in entry.extensions
        ? entry.extensions.code
        : undefined
    return code === undefined || code === "GRAPHQL_VALIDATION_FAILED"
  })
}

async function getLegacyExperiencePreview(
  token: string,
): Promise<ExperiencePreview | null> {
  const result = await client.query({
    query: LEGACY_EXPERIENCE_PREVIEW,
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
  return (result.data?.experiencePreview ?? null) as ExperiencePreview | null
}

/**
 * Capability-only preview fetch. The token stays server-side, the response is
 * never written to Apollo's cache, and failures do not include the token.
 */
export async function getExperiencePreview(
  token: string,
): Promise<ExperiencePreview | null> {
  const queryCurrentSchema = () =>
    client.query({
      query: EXPERIENCE_PREVIEW,
      variables: { token },
      fetchPolicy: "no-cache",
      context: {
        fetchOptions: { cache: "no-store" },
      },
    })
  let result: Awaited<ReturnType<typeof queryCurrentSchema>>
  try {
    result = await queryCurrentSchema()
  } catch (error) {
    if (isUnknownCategoryRailTypenameValidation(error)) {
      try {
        return await getLegacyExperiencePreview(token)
      } catch {
        // Preserve the capability-redacting public error below.
      }
    }
    throw new Error("Experience preview query failed")
  }

  const response = result as typeof result & {
    error?: ErrorLike
    errors?: readonly unknown[]
  }
  if (isUnknownCategoryRailTypenameValidation(response)) {
    try {
      return await getLegacyExperiencePreview(token)
    } catch {
      throw new Error("Experience preview query failed")
    }
  }
  if (response.error || response.errors?.length) {
    throw new Error("Experience preview query failed")
  }
  return result.data?.experiencePreview ?? null
}
