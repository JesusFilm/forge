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

// Keep semantic plus contextual recovery under the browser's 12-second
// delivery deadline. Admission, serialization, and network transit retain
// about 1.75 seconds of margin at the worst-case upstream budgets.
const DELIVERY_UPSTREAM_TIMEOUT_MS = 3_500
const CONTEXTUAL_RECOMMENDATION_UPSTREAM_TIMEOUT_MS = 6_500
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

const CONTEXTUAL_SCENE_RECOMMENDATIONS = adminGraphql(`
  query ContextualSceneRecommendations(
    $videoId: ID!
    $locale: String!
    $limit: Int
  ) {
    sceneRecommendations(videoId: $videoId, locale: $locale, limit: $limit) {
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

const CONTEXTUAL_COLLECTION_RECOMMENDATIONS = adminGraphql(`
  query ContextualCollectionRecommendations(
    $videoSlug: String!
    $locale: String!
    $languageSlug: String
  ) {
    watchVideoRouteSnapshotBySlug(
      slug: $videoSlug
      locale: $locale
      languageSlug: $languageSlug
    ) {
      documentId
      slug
      parents {
        parent {
          slug
          children {
            order
            child {
              documentId
              slug
              muxPlaybackId
              durationSeconds
              images {
                thumbnail
                mobileCinematicHigh
              }
              exactLocales {
                title
              }
              broadLocales {
                title
              }
              englishLocales {
                title
              }
            }
          }
        }
      }
      children {
        order
        child {
          documentId
          slug
          muxPlaybackId
          durationSeconds
          images {
            thumbnail
            mobileCinematicHigh
          }
          exactLocales {
            title
          }
          broadLocales {
            title
          }
          englishLocales {
            title
          }
        }
      }
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
  collectionSlug?: string | null
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

const CONTEXTUAL_RECOMMENDATION_CACHE_MS = 5 * 60 * 1000
const CONTEXTUAL_RECOMMENDATION_CACHE_MAX = 200
const contextualRecommendationCache = new Map<
  string,
  { expiresAt: number; value: Promise<SceneRecommendation[]> }
>()

function fetchContextualSceneRecommendations(
  videoId: string,
  locale: string,
  limit: number,
): Promise<SceneRecommendation[]> {
  const key = `${videoId}\0${locale}\0${limit}`
  const now = Date.now()
  const cached = contextualRecommendationCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value
  contextualRecommendationCache.delete(key)
  const value = (async () => {
    const result = await client.query({
      query: CONTEXTUAL_SCENE_RECOMMENDATIONS,
      variables: { videoId, locale, limit },
      fetchPolicy: "no-cache",
      context: upstreamContext(CONTEXTUAL_RECOMMENDATION_UPSTREAM_TIMEOUT_MS),
    })
    if (result.error || !result.data?.sceneRecommendations) {
      throw new RecommendationRuntimeError("delivery_unavailable")
    }
    return result.data.sceneRecommendations
  })().catch((error) => {
    contextualRecommendationCache.delete(key)
    throw error
  })
  contextualRecommendationCache.set(key, {
    expiresAt: now + CONTEXTUAL_RECOMMENDATION_CACHE_MS,
    value,
  })
  while (
    contextualRecommendationCache.size > CONTEXTUAL_RECOMMENDATION_CACHE_MAX
  ) {
    const oldestKey = contextualRecommendationCache.keys().next().value
    if (oldestKey == null) break
    contextualRecommendationCache.delete(oldestKey)
  }
  return value
}

export async function getContextualSceneRecommendations(
  videoId: string,
  locale: string,
  limit: number,
): Promise<SceneRecommendation[]> {
  return fetchContextualSceneRecommendations(videoId, locale, limit)
}

async function loadContextualCollectionRecommendations(
  videoSlug: string,
  locale: string,
  languageSlug: string,
  limit: number,
): Promise<SceneRecommendation[]> {
  const result = await client.query({
    query: CONTEXTUAL_COLLECTION_RECOMMENDATIONS,
    variables: { videoSlug, locale, languageSlug },
    fetchPolicy: "no-cache",
    context: upstreamContext(CONTEXTUAL_RECOMMENDATION_UPSTREAM_TIMEOUT_MS),
  })
  const snapshot = result.data?.watchVideoRouteSnapshotBySlug
  if (result.error || !snapshot) {
    throw new RecommendationRuntimeError("delivery_unavailable")
  }

  type Relation = NonNullable<(typeof snapshot.parents)[number]>
  type ChildRelation = NonNullable<
    NonNullable<Relation["parent"]>["children"][number]
  >
  type Child = NonNullable<ChildRelation["child"]>
  const orderedChildren = (
    children: readonly (ChildRelation | null)[],
  ): ChildRelation[] =>
    children
      .filter((relation): relation is ChildRelation => relation?.child != null)
      .sort(
        (left, right) =>
          (left.order ?? Number.MAX_SAFE_INTEGER) -
          (right.order ?? Number.MAX_SAFE_INTEGER),
      )

  const candidateGroups = (snapshot.parents ?? []).flatMap((relation) => {
    const parent = relation?.parent
    if (!parent?.slug) return []
    return [{ collectionSlug: parent.slug, children: parent.children ?? [] }]
  })
  if (snapshot.slug && (snapshot.children?.length ?? 0) > 0) {
    candidateGroups.push({
      collectionSlug: snapshot.slug,
      children: snapshot.children ?? [],
    })
  }

  const seen = new Set<string>([snapshot.documentId])
  const candidates: Array<{ child: Child; collectionSlug: string }> = []
  for (const group of candidateGroups) {
    const children = orderedChildren(group.children)
    const currentIndex = children.findIndex(
      (relation) => relation.child?.documentId === snapshot.documentId,
    )
    const rotated =
      currentIndex >= 0
        ? [
            ...children.slice(currentIndex + 1),
            ...children.slice(0, currentIndex),
          ]
        : children
    for (const relation of rotated) {
      const child = relation.child
      if (
        !child?.documentId ||
        !child.slug ||
        !child.muxPlaybackId ||
        seen.has(child.documentId)
      ) {
        continue
      }
      seen.add(child.documentId)
      candidates.push({ child, collectionSlug: group.collectionSlug })
      if (candidates.length >= limit) break
    }
    if (candidates.length >= limit) break
  }

  return candidates.map(({ child, collectionSlug }, index) => ({
    videoId: child.documentId,
    videoSlug: child.slug!,
    videoTitle:
      child.exactLocales?.[0]?.title ??
      child.broadLocales?.[0]?.title ??
      child.englishLocales?.[0]?.title ??
      child.slug!,
    imageUrl:
      child.images
        ?.map((image) => image?.thumbnail ?? image?.mobileCinematicHigh)
        .find((image): image is string => Boolean(image)) ?? null,
    sceneIndex: index,
    description: "",
    startSeconds: 0,
    endSeconds: child.durationSeconds ?? null,
    durationSeconds: child.durationSeconds ?? null,
    similarity: 0,
    themes: [],
    demographics: [],
    spiritualContext: [],
    playbackId: child.muxPlaybackId!,
    collectionSlug,
  }))
}

const contextualCollectionRecommendationCache = new Map<
  string,
  { expiresAt: number; value: Promise<SceneRecommendation[]> }
>()

export function getContextualCollectionRecommendations(
  videoSlug: string,
  locale: string,
  languageSlug: string,
  limit: number,
): Promise<SceneRecommendation[]> {
  const key = `${videoSlug}\0${locale}\0${languageSlug}\0${limit}`
  const now = Date.now()
  const cached = contextualCollectionRecommendationCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value
  contextualCollectionRecommendationCache.delete(key)
  const value = loadContextualCollectionRecommendations(
    videoSlug,
    locale,
    languageSlug,
    limit,
  ).catch((error) => {
    contextualCollectionRecommendationCache.delete(key)
    throw error
  })
  contextualCollectionRecommendationCache.set(key, {
    expiresAt: now + CONTEXTUAL_RECOMMENDATION_CACHE_MS,
    value,
  })
  while (
    contextualCollectionRecommendationCache.size >
    CONTEXTUAL_RECOMMENDATION_CACHE_MAX
  ) {
    const oldestKey = contextualCollectionRecommendationCache
      .keys()
      .next().value
    if (oldestKey == null) break
    contextualCollectionRecommendationCache.delete(oldestKey)
  }
  return value
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
