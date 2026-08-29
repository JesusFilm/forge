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

import { previewMediaCollectionTitlesFragment } from "@/lib/fragments/preview-media-collection-titles"

import client from "@/lib/admin-client"

const EXPERIENCE_PREVIEW_SHAPE = adminGraphql(
  `
    fragment ExperiencePreviewShape on ExperiencePreview @_unmask {
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

// Tier 2 of the fallback ladder in `getExperiencePreview`: the exact selection
// Web shipped before preview titles existed. An Admin that predates
// `previewResolvedTitle` can still serve this, so a title-only schema lag
// degrades to today's titleless render instead of failing the page.
const EXPERIENCE_PREVIEW = adminGraphql(
  `
    query ExperiencePreview($token: String!) {
      experiencePreview(token: $token) {
        ...ExperiencePreviewShape
      }
    }
  `,
  [EXPERIENCE_PREVIEW_SHAPE],
)

// Tier 1: the same shape plus the preview title overlay. This is the operation
// every current deploy runs.
const EXPERIENCE_PREVIEW_WITH_TITLES = adminGraphql(
  `
    query ExperiencePreviewWithTitles($token: String!) {
      experiencePreview(token: $token) {
        ...ExperiencePreviewShape
        ...PreviewMediaCollectionTitles
      }
    }
  `,
  [EXPERIENCE_PREVIEW_SHAPE, previewMediaCollectionTitlesFragment],
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

// Two distinct pre-feature Admin schemas produce two distinct validation
// errors on the SAME selection, and both mean "fall back to the legacy
// query": an Admin without the block type at all ("Unknown type"), and an
// Admin that has the block but predates authored tiles ("Cannot query
// field"). Matching only the first would have made the tiles selection a
// hard failure during the deploy window rather than a graceful degrade.
const CATEGORY_RAIL_SCHEMA_LAG_MESSAGES = [
  /^Unknown type "WatchHomeCategoryRailBlock"\./,
  /^Cannot query field "tiles" on type "WatchHomeCategoryRailBlock"\./,
]

// An Admin that predates the preview title field rejects the tier-1 overlay
// with one unknown-field error PER nesting path, so this arrives four at a
// time. Match the prefix only: graphql-js appends a `Did you mean ...?`
// suggestion whose contents depend on the other field names on the type.
const PREVIEW_TITLE_SCHEMA_LAG_MESSAGE =
  /^Cannot query field "previewResolvedTitle" on type "MediaCollectionItem"\./

type PreviewSchemaLag = "none" | "titles" | "category-rail"

// A validation error carries no `path` (nothing resolved) and is either
// explicitly coded as a validation failure or carries no code at all.
function isValidationShaped(entry: GraphqlErrorCandidate): boolean {
  if (entry.path != null) return false

  const code =
    typeof entry.extensions === "object" &&
    entry.extensions !== null &&
    "code" in entry.extensions
      ? entry.extensions.code
      : undefined
  return code === undefined || code === "GRAPHQL_VALIDATION_FAILED"
}

function matches(
  entry: GraphqlErrorCandidate,
  patterns: readonly RegExp[],
): boolean {
  if (typeof entry.message !== "string" || !isValidationShaped(entry)) {
    return false
  }
  return patterns.some((pattern) => pattern.test(entry.message as string))
}

/**
 * Classify a failed preview response over its COMPLETE error array.
 *
 * First-match classification is wrong here for two reasons. The tier-1
 * operation selects the title at four nesting paths, so a title lag produces
 * four errors rather than one; and an Admin lagging on both axes returns rail
 * and title errors together, where only the legacy tier can serve the request.
 *
 * A set that mixes title-lag errors with anything else returns "none" — that
 * routes to the ordinary throw, so an unrelated Admin failure is never
 * swallowed by a silent degrade to the titleless render.
 */
function classifyPreviewSchemaLag(value: unknown): PreviewSchemaLag {
  const errors = graphqlErrorsFrom(value)
  if (errors.length === 0) return "none"

  if (
    errors.some((entry) => matches(entry, CATEGORY_RAIL_SCHEMA_LAG_MESSAGES))
  ) {
    return "category-rail"
  }

  const titleLag = errors.filter((entry) =>
    matches(entry, [PREVIEW_TITLE_SCHEMA_LAG_MESSAGE]),
  )
  if (titleLag.length > 0 && titleLag.length === errors.length) return "titles"

  return "none"
}

type PreviewQueryDocument =
  | typeof EXPERIENCE_PREVIEW_WITH_TITLES
  | typeof EXPERIENCE_PREVIEW
  | typeof LEGACY_EXPERIENCE_PREVIEW

/**
 * One tier of the fallback ladder. Returns the preview on success, or the
 * schema-lag classification of its failure so the caller can pick the next
 * tier. Every non-lag failure raises the capability-redacting public error.
 */
async function runPreviewTier(
  document: PreviewQueryDocument,
  token: string,
): Promise<
  | { ok: true; preview: ExperiencePreview | null }
  | { ok: false; lag: PreviewSchemaLag }
> {
  let result
  try {
    result = await client.query({
      query: document,
      variables: { token },
      fetchPolicy: "no-cache",
      context: {
        fetchOptions: { cache: "no-store" },
      },
    })
  } catch (error) {
    const lag = classifyPreviewSchemaLag(error)
    if (lag === "none") throw new Error("Experience preview query failed")
    return { ok: false, lag }
  }

  const response = result as typeof result & {
    error?: ErrorLike
    errors?: readonly unknown[]
  }
  const lag = classifyPreviewSchemaLag(response)
  if (lag !== "none") return { ok: false, lag }

  if (response.error || response.errors?.length) {
    throw new Error("Experience preview query failed")
  }
  return {
    ok: true,
    preview: (result.data?.experiencePreview ??
      null) as ExperiencePreview | null,
  }
}

/**
 * Capability-only preview fetch. The token stays server-side, the response is
 * never written to Apollo's cache, and failures do not include the token.
 *
 * Three tiers, one retry per independent schema-lag axis:
 *
 *   1. shape + preview titles  — every current deploy
 *   2. shape only              — Admin predates `previewResolvedTitle`
 *   3. legacy selection        — Admin predates WatchHomeCategoryRailBlock
 *
 * Both tier-2 and tier-3 render exactly what Web rendered before their
 * respective features shipped, so a deploy window degrades rather than
 * serving an error page.
 */
export async function getExperiencePreview(
  token: string,
): Promise<ExperiencePreview | null> {
  const withTitles = await runPreviewTier(EXPERIENCE_PREVIEW_WITH_TITLES, token)
  if (withTitles.ok) return withTitles.preview

  if (withTitles.lag === "titles") {
    const shapeOnly = await runPreviewTier(EXPERIENCE_PREVIEW, token)
    if (shapeOnly.ok) return shapeOnly.preview
    if (shapeOnly.lag !== "category-rail") {
      throw new Error("Experience preview query failed")
    }
  }

  const legacy = await runPreviewTier(LEGACY_EXPERIENCE_PREVIEW, token)
  if (!legacy.ok) throw new Error("Experience preview query failed")
  return legacy.preview
}
