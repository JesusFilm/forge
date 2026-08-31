import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql } from "@forge/admin-graphql"
import type { AdminResultOf, AdminVariablesOf } from "@forge/admin-graphql"
import {
  adminClaimSemanticRecommendationEpisodeOperation,
  adminRecommendationProfileStatusOperation,
  adminRecordSemanticRecommendationEvidenceOperation,
  adminRecordSemanticRecommendationPlaybackOperation,
  adminRecordRecommendationContentActionOperation,
  adminSelectSemanticRecommendationOperation,
  adminSemanticRecommendationDeliveryOperation,
  adminTransitionRecommendationProfileOperation,
} from "@forge/admin-graphql/operations"
import client from "@/lib/admin-client"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"
import { RECOMMENDATION_PROFILE_UPSTREAM_TIMEOUT_MS } from "@/lib/recommendation-timeouts"

const DELIVERY_UPSTREAM_TIMEOUT_MS = 1_900
const SELECTION_UPSTREAM_TIMEOUT_MS = 700
const EVIDENCE_UPSTREAM_TIMEOUT_MS = 900

function upstreamContext(timeoutMs: number) {
  return { fetchOptions: { signal: AbortSignal.timeout(timeoutMs) } }
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
): Promise<SemanticRecommendationDelivery> {
  const result = await client.query({
    query: adminSemanticRecommendationDeliveryOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(DELIVERY_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.semanticRecommendationDelivery) {
    throw new RecommendationRuntimeError("delivery_unavailable")
  }
  return result.data.semanticRecommendationDelivery
}

export async function recordSemanticRecommendationEvidence(
  variables: AdminVariablesOf<
    typeof adminRecordSemanticRecommendationEvidenceOperation
  >,
) {
  const result = await client.mutate({
    mutation: adminRecordSemanticRecommendationEvidenceOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(EVIDENCE_UPSTREAM_TIMEOUT_MS),
  })
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
  const result = await client.mutate({
    mutation: adminSelectSemanticRecommendationOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(SELECTION_UPSTREAM_TIMEOUT_MS),
  })
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
  const result = await client.mutate({
    mutation: adminClaimSemanticRecommendationEpisodeOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(EVIDENCE_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.claimSemanticRecommendationEpisode) {
    throw new RecommendationRuntimeError("episode_unavailable")
  }
  return result.data.claimSemanticRecommendationEpisode
}

export async function recordSemanticRecommendationPlayback(
  variables: AdminVariablesOf<
    typeof adminRecordSemanticRecommendationPlaybackOperation
  >,
) {
  const result = await client.mutate({
    mutation: adminRecordSemanticRecommendationPlaybackOperation,
    variables,
    fetchPolicy: "no-cache",
    context: upstreamContext(EVIDENCE_UPSTREAM_TIMEOUT_MS),
  })
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
    context: upstreamContext(EVIDENCE_UPSTREAM_TIMEOUT_MS),
  })
  if (result.error || !result.data?.recordRecommendationContentAction) {
    throw new RecommendationRuntimeError("content_action_unavailable")
  }
  return result.data.recordRecommendationContentAction
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
