import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql } from "@forge/admin-graphql"
import type { AdminResultOf, AdminVariablesOf } from "@forge/admin-graphql"
import {
  adminClaimSemanticRecommendationEpisodeOperation,
  adminIssueWatchPlaybackContextOperation,
  adminIssueWatchSurfaceDeliveryOperation,
  adminRecommendationProfileStatusOperation,
  adminRecordSemanticRecommendationEvidenceOperation,
  adminRecordSemanticRecommendationPlaybackOperation,
  adminRecordRecommendationContentActionOperation,
  adminRecordWatchSurfaceExposureOperation,
  adminSelectSemanticRecommendationOperation,
  adminSelectPrivatePrecomputedRecommendationOperation,
  adminSemanticRecommendationDeliveryOperation,
  adminPrivateSemanticRecommendationFallbackOperation,
  adminPrecomputedWatchPreviewDeliveryOperation,
  adminPrivatePrecomputedWatchVisitDeliveryOperation,
  adminTransitionRecommendationProfileOperation,
} from "@forge/admin-graphql/operations"
import client from "@/lib/admin-client"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"
import {
  RECOMMENDATION_EVIDENCE_UPSTREAM_TIMEOUT_MS,
  RECOMMENDATION_PROFILE_UPSTREAM_TIMEOUT_MS,
} from "@/lib/recommendation-timeouts"

// Keep Admin delivery bounded below the browser's 12-second deadline, leaving
// room for admission, serialization, network transit, and bounded retries.
const DELIVERY_UPSTREAM_TIMEOUT_MS = 3_500
const SELECTION_UPSTREAM_TIMEOUT_MS = 700
const CONTENT_ACTION_UPSTREAM_TIMEOUT_MS = 900

export async function issueWatchSurfaceDelivery(
  variables: AdminVariablesOf<typeof adminIssueWatchSurfaceDeliveryOperation>,
) {
  const result = await client.mutate({
    mutation: adminIssueWatchSurfaceDeliveryOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(RECOMMENDATION_EVIDENCE_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.issueWatchSurfaceDelivery) {
    throw new RecommendationRuntimeError("evidence_unavailable")
  }
  return result.data.issueWatchSurfaceDelivery
}

function upstreamContext(timeoutMs: number) {
  return { fetchOptions: { signal: AbortSignal.timeout(timeoutMs) } }
}

function hasRecommendationGraphqlCode(
  value: unknown,
  expected: string,
  field: "recommendationCode" | "code" = "recommendationCode",
): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as {
    error?: unknown
    errors?: unknown
    graphQLErrors?: unknown
  }
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as { errors?: unknown; graphQLErrors?: unknown })
      : undefined
  const errors = [
    record.errors,
    record.graphQLErrors,
    nested?.errors,
    nested?.graphQLErrors,
  ].flatMap((entries) => (Array.isArray(entries) ? entries : []))
  return errors.some((entry) => {
    if (!entry || typeof entry !== "object" || !("extensions" in entry)) {
      return false
    }
    const extensions = entry.extensions
    return (
      !!extensions &&
      typeof extensions === "object" &&
      field in extensions &&
      (extensions as Record<string, unknown>)[field] === expected
    )
  })
}

// Apollo's default errorPolicy rejects GraphQL errors. Also accept returned
// envelopes for compatible callers without relying on human-readable messages.
async function withRecommendationDomainErrors<T>(
  operation: Promise<T>,
  invalidInputCode: "playback_request_invalid" | "evidence_request_invalid",
): Promise<T> {
  let result: T
  try {
    result = await operation
  } catch (error) {
    if (hasRecommendationGraphqlCode(error, "invalid_binding")) {
      throw new RecommendationRuntimeError("playback_binding_invalid")
    }
    if (hasRecommendationGraphqlCode(error, "BAD_USER_INPUT", "code")) {
      throw new RecommendationRuntimeError(invalidInputCode)
    }
    throw error
  }
  if (hasRecommendationGraphqlCode(result, "invalid_binding")) {
    throw new RecommendationRuntimeError("playback_binding_invalid")
  }
  if (hasRecommendationGraphqlCode(result, "BAD_USER_INPUT", "code")) {
    throw new RecommendationRuntimeError(invalidInputCode)
  }
  return result
}

// Admin's `sceneRecommendations` returns SceneRecommendation rows directly.
// `videoId` is admin's cuid string (ID); web's previous Strapi-backed shape
// carried it as an integer and is updated in this rebuild to match.

const SCENE_RECOMMENDATIONS = adminGraphql(`
  query SceneRecommendations($slug: String!, $locale: String!, $limit: Int) {
    sceneRecommendations(slug: $slug, locale: $locale, limit: $limit) {
      videoId
      videoSlug
      videoTitle
      imageUrl
      sceneIndex
      description
      startSeconds
      endSeconds
      similarity
      themes
      demographics
      spiritualContext
      playbackId
    }
  }
`)

export type SceneRecommendation = {
  videoId: string
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  sceneIndex: number
  description: string
  startSeconds: number
  endSeconds: number | null
  durationSeconds?: number | null
  similarity: number
  themes: string[]
  demographics: string[]
  spiritualContext: string[]
  playbackId: string
}

// Demo-recommendations page video lookup. Admin's `videoBySlug` keeps
// locale-varying fields on `VideoLocale`; the locale-narrowed
// `locales(locale: $locale)` arg keeps the projection to one row per
// request. The shape mirrors content.ts's normalizeAdminVideo convention
// of hoisting the active locale's title/description onto a flat record.
const GET_VIDEO_BY_SLUG = adminGraphql(`
  query GetVideoBySlug($slug: String!, $locale: String!) {
    videoBySlug(slug: $slug) {
      documentId: id
      slug
      images {
        url
        thumbnail
        mobileCinematicHigh
      }
      primaryLanguage {
        coreId
      }
      locales(locale: $locale) {
        title
        description
      }
    }
  }
`)

export type VideoBySlug = {
  documentId: string
  slug: string | null
  title: string | null
  description: string | null
  images: {
    url: string | null
    thumbnail: string | null
    mobileCinematicHigh: string | null
  }[]
  primaryLanguage: { coreId: string | null } | null
}

const fetchRecommendations = unstable_cache(
  async (
    slug: string,
    locale: string,
    limit: number,
  ): Promise<SceneRecommendation[]> => {
    try {
      const result = await client.query({
        query: SCENE_RECOMMENDATIONS,
        variables: { slug, locale, limit },
        fetchPolicy: "no-cache",
      })
      return result.data?.sceneRecommendations ?? []
    } catch {
      return []
    }
  },
  ["scene-recommendations"],
  { revalidate: 60 },
)

export const getSceneRecommendations = cache(
  async (
    slug: string,
    locale: string,
    limit = 10,
  ): Promise<SceneRecommendation[]> => {
    return fetchRecommendations(slug, locale, limit)
  },
)

const fetchVideoBySlug = unstable_cache(
  async (slug: string, locale: string): Promise<VideoBySlug | null> => {
    try {
      const result = await client.query({
        query: GET_VIDEO_BY_SLUG,
        variables: { slug, locale },
        fetchPolicy: "no-cache",
      })
      const raw = result.data?.videoBySlug
      if (!raw || !raw.documentId) return null
      const localeRow = raw.locales?.[0] ?? null
      return {
        documentId: raw.documentId,
        slug: raw.slug ?? null,
        title: localeRow?.title ?? null,
        description: localeRow?.description ?? null,
        images: (raw.images ?? []).map((img) => ({
          url: img.url ?? null,
          thumbnail: img.thumbnail ?? null,
          mobileCinematicHigh: img.mobileCinematicHigh ?? null,
        })),
        primaryLanguage: raw.primaryLanguage
          ? { coreId: raw.primaryLanguage.coreId ?? null }
          : null,
      }
    } catch {
      return null
    }
  },
  ["video-by-slug"],
  { revalidate: 60 },
)

export const getVideoBySlug = cache(
  async (slug: string, locale: string): Promise<VideoBySlug | null> => {
    return fetchVideoBySlug(slug, locale)
  },
)

export type SemanticRecommendationDelivery = NonNullable<
  AdminResultOf<
    typeof adminSemanticRecommendationDeliveryOperation
  >["semanticRecommendationDelivery"]
>

export type SemanticRecommendationSelection = NonNullable<
  AdminResultOf<
    typeof adminSelectSemanticRecommendationOperation
  >["selectSemanticRecommendation"]
>

export type SemanticRecommendationEpisodeClaim = NonNullable<
  AdminResultOf<
    typeof adminClaimSemanticRecommendationEpisodeOperation
  >["claimSemanticRecommendationEpisode"]
>

export async function getSemanticRecommendationDelivery(
  variables: AdminVariablesOf<
    typeof adminSemanticRecommendationDeliveryOperation
  >,
  timeoutMs = DELIVERY_UPSTREAM_TIMEOUT_MS,
): Promise<SemanticRecommendationDelivery> {
  const result = await client.query({
    query: adminSemanticRecommendationDeliveryOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(timeoutMs),
  })
  if (result.error || !result.data?.semanticRecommendationDelivery) {
    throw new RecommendationRuntimeError("delivery_unavailable")
  }
  return result.data.semanticRecommendationDelivery
}

export async function getPrivateSemanticRecommendationFallback(
  variables: AdminVariablesOf<
    typeof adminPrivateSemanticRecommendationFallbackOperation
  >,
  timeoutMs = DELIVERY_UPSTREAM_TIMEOUT_MS,
): Promise<SemanticRecommendationDelivery> {
  const result = await client.query({
    query: adminPrivateSemanticRecommendationFallbackOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(timeoutMs),
  })
  if (result.error || !result.data?.semanticRecommendationDelivery) {
    throw new RecommendationRuntimeError("delivery_unavailable")
  }
  return result.data.semanticRecommendationDelivery
}

export async function getPrecomputedWatchPreviewDelivery(
  variables: AdminVariablesOf<
    typeof adminPrecomputedWatchPreviewDeliveryOperation
  >,
  timeoutMs = DELIVERY_UPSTREAM_TIMEOUT_MS,
) {
  const query = () =>
    client.query({
      query: adminPrecomputedWatchPreviewDeliveryOperation,
      variables,
      fetchPolicy: "no-cache",
      context: upstreamContext(timeoutMs),
    })
  let result: Awaited<ReturnType<typeof query>>
  try {
    result = await query()
  } catch (error) {
    if (isPreviewAuthorizationDenial(error))
      throw new RecommendationPreviewAuthorizationError()
    throw new RecommendationRuntimeError("delivery_unavailable")
  }
  if (result.error) {
    if (isPreviewAuthorizationDenial(result.error))
      throw new RecommendationPreviewAuthorizationError()
    throw new RecommendationRuntimeError("delivery_unavailable")
  }
  if (!result.data?.precomputedWatchPreviewDelivery) {
    throw new RecommendationRuntimeError("delivery_unavailable")
  }
  return result.data.precomputedWatchPreviewDelivery
}

export async function getPrivatePrecomputedWatchVisitDelivery(
  variables: AdminVariablesOf<
    typeof adminPrivatePrecomputedWatchVisitDeliveryOperation
  >,
  timeoutMs = DELIVERY_UPSTREAM_TIMEOUT_MS,
) {
  const result = await client.query({
    query: adminPrivatePrecomputedWatchVisitDeliveryOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(timeoutMs),
  })
  if (result.error || !result.data?.privatePrecomputedWatchVisitDelivery)
    throw new RecommendationRuntimeError("delivery_unavailable")
  return result.data.privatePrecomputedWatchVisitDelivery
}

function isPreviewAuthorizationDenial(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as {
    errors?: Array<{ extensions?: { code?: string } }>
    graphQLErrors?: Array<{ extensions?: { code?: string } }>
    statusCode?: number
    status?: number
  }
  if (
    value.statusCode === 401 ||
    value.statusCode === 403 ||
    value.status === 401 ||
    value.status === 403
  )
    return true
  return [...(value.errors ?? []), ...(value.graphQLErrors ?? [])].some(
    (reported) =>
      reported.extensions?.code === "UNAUTHENTICATED" ||
      reported.extensions?.code === "FORBIDDEN",
  )
}

export class RecommendationPreviewAuthorizationError extends Error {
  constructor() {
    super("Private recommendation preview authorization denied")
    this.name = "RecommendationPreviewAuthorizationError"
  }
}

export async function recordSemanticRecommendationEvidence(
  variables: AdminVariablesOf<
    typeof adminRecordSemanticRecommendationEvidenceOperation
  >,
) {
  const result = await withRecommendationDomainErrors(
    client.mutate({
      mutation: adminRecordSemanticRecommendationEvidenceOperation,
      variables,
      fetchPolicy: "no-cache",
      context: upstreamContext(RECOMMENDATION_EVIDENCE_UPSTREAM_TIMEOUT_MS),
    }),
    "evidence_request_invalid",
  )
  if (result.error || !result.data?.recordSemanticRecommendationEvidence) {
    throw new RecommendationRuntimeError("evidence_unavailable")
  }
  return result.data.recordSemanticRecommendationEvidence
}

export async function selectSemanticRecommendation(
  variables: AdminVariablesOf<
    typeof adminSelectSemanticRecommendationOperation
  >,
): Promise<SemanticRecommendationSelection> {
  const result = await withRecommendationDomainErrors(
    client.mutate({
      mutation: adminSelectSemanticRecommendationOperation,
      variables,
      fetchPolicy: "no-cache",
      context: upstreamContext(SELECTION_UPSTREAM_TIMEOUT_MS),
    }),
    "evidence_request_invalid",
  )
  if (result.error || !result.data?.selectSemanticRecommendation) {
    throw new RecommendationRuntimeError("selection_unavailable")
  }
  return result.data.selectSemanticRecommendation
}

export async function selectPrivatePrecomputedRecommendation(
  variables: AdminVariablesOf<
    typeof adminSelectPrivatePrecomputedRecommendationOperation
  >,
): Promise<SemanticRecommendationSelection> {
  const result = await withRecommendationDomainErrors(
    client.mutate({
      mutation: adminSelectPrivatePrecomputedRecommendationOperation,
      variables,
      fetchPolicy: "no-cache",
      context: upstreamContext(SELECTION_UPSTREAM_TIMEOUT_MS),
    }),
    "evidence_request_invalid",
  )
  if (result.error || !result.data?.selectSemanticRecommendation) {
    throw new RecommendationRuntimeError("selection_unavailable")
  }
  return result.data.selectSemanticRecommendation
}

export async function claimSemanticRecommendationEpisode(
  variables: AdminVariablesOf<
    typeof adminClaimSemanticRecommendationEpisodeOperation
  >,
): Promise<SemanticRecommendationEpisodeClaim> {
  const result = await withRecommendationDomainErrors(
    client.mutate({
      mutation: adminClaimSemanticRecommendationEpisodeOperation,
      variables,
      fetchPolicy: "no-cache",
      context: upstreamContext(RECOMMENDATION_EVIDENCE_UPSTREAM_TIMEOUT_MS),
    }),
    "playback_request_invalid",
  )
  if (result.error || !result.data?.claimSemanticRecommendationEpisode) {
    throw new RecommendationRuntimeError("episode_unavailable")
  }
  return result.data.claimSemanticRecommendationEpisode
}

export async function issueWatchPlaybackContext(
  variables: AdminVariablesOf<typeof adminIssueWatchPlaybackContextOperation>,
) {
  const result = await client.mutate({
    mutation: adminIssueWatchPlaybackContextOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(RECOMMENDATION_EVIDENCE_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.issueWatchPlaybackContext) {
    throw new RecommendationRuntimeError("episode_unavailable")
  }
  return result.data.issueWatchPlaybackContext
}

export async function recordSemanticRecommendationPlayback(
  variables: AdminVariablesOf<
    typeof adminRecordSemanticRecommendationPlaybackOperation
  >,
) {
  const result = await withRecommendationDomainErrors(
    client.mutate({
      mutation: adminRecordSemanticRecommendationPlaybackOperation,
      variables,
      fetchPolicy: "no-cache",
      context: upstreamContext(RECOMMENDATION_EVIDENCE_UPSTREAM_TIMEOUT_MS),
    }),
    "playback_request_invalid",
  )
  if (result.error || !result.data?.recordSemanticRecommendationPlayback) {
    throw new RecommendationRuntimeError("playback_unavailable")
  }
  return result.data.recordSemanticRecommendationPlayback
}

export async function recordRecommendationContentAction(
  variables: AdminVariablesOf<
    typeof adminRecordRecommendationContentActionOperation
  >,
) {
  const result = await client.mutate({
    mutation: adminRecordRecommendationContentActionOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(CONTENT_ACTION_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.recordRecommendationContentAction) {
    throw new RecommendationRuntimeError("content_action_unavailable")
  }
  return result.data.recordRecommendationContentAction
}

export async function recordWatchSurfaceExposure(
  events: Record<string, unknown>[],
) {
  const result = await client.mutate({
    mutation: adminRecordWatchSurfaceExposureOperation,
    variables: { events },
    fetchPolicy: "no-cache",
    context: upstreamContext(CONTENT_ACTION_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.recordWatchSurfaceExposure) {
    throw new RecommendationRuntimeError("evidence_failed")
  }
  return result.data.recordWatchSurfaceExposure
}

export async function getRecommendationProfileStatus(
  variables: AdminVariablesOf<typeof adminRecommendationProfileStatusOperation>,
) {
  const result = await client.mutate({
    mutation: adminRecommendationProfileStatusOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(RECOMMENDATION_PROFILE_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.recommendationProfileStatus) {
    throw new RecommendationRuntimeError("profile_unavailable")
  }
  return result.data.recommendationProfileStatus
}

export async function transitionRecommendationProfile(
  variables: AdminVariablesOf<
    typeof adminTransitionRecommendationProfileOperation
  >,
) {
  const result = await client.mutate({
    mutation: adminTransitionRecommendationProfileOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(RECOMMENDATION_PROFILE_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.transitionRecommendationProfile) {
    throw new RecommendationRuntimeError("profile_unavailable")
  }
  return result.data.transitionRecommendationProfile
}
