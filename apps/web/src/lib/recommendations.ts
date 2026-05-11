import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/graphql"
import client from "@/lib/client"

export type SceneRecommendation = {
  videoId: string
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  sceneIndex: number
  description: string
  startSeconds: number
  endSeconds: number | null
  similarity: number
  themes: string[]
  demographics: string[]
  spiritualContext: string[]
  playbackId: string
}

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

type SceneRecommendationsResult = AdminResultOf<typeof SCENE_RECOMMENDATIONS>

const GET_VIDEO_BY_SLUG = adminGraphql(`
  query GetVideoBySlug($slug: String!, $locale: String!) {
    videoBySlug(slug: $slug, locale: $locale) {
      id
      slug
      locales(locale: $locale) {
        title
        description
      }
      images {
        url
        thumbnail
        mobileCinematicHigh
      }
    }
  }
`)

type AdminVideoBySlug = NonNullable<
  AdminResultOf<typeof GET_VIDEO_BY_SLUG>["videoBySlug"]
>

export type VideoBySlug = {
  documentId: string | null
  title: string | null
  slug: string | null
  description: string | null
  images: {
    url: string | null
    thumbnail: string | null
    mobileCinematicHigh: string | null
  }[]
}

function toVideoBySlug(video: AdminVideoBySlug): VideoBySlug {
  const locale = video.locales?.[0]

  return {
    documentId: video.id ?? null,
    title: locale?.title ?? null,
    slug: video.slug ?? null,
    description: locale?.description ?? null,
    images: (video.images ?? []).map((image) => ({
      url: image.url ?? null,
      thumbnail: image.thumbnail ?? null,
      mobileCinematicHigh: image.mobileCinematicHigh ?? null,
    })),
  }
}

// --- Data fetching functions ---

const fetchRecommendations = unstable_cache(
  async (
    slug: string,
    locale: string,
    limit: number,
  ): Promise<SceneRecommendation[]> => {
    try {
      const result = await client.query<SceneRecommendationsResult>({
        query: SCENE_RECOMMENDATIONS,
        variables: { slug, locale, limit },
        fetchPolicy: "no-cache",
      })
      return (
        result.data?.sceneRecommendations.map((recommendation) => ({
          ...recommendation,
          imageUrl: recommendation.imageUrl ?? null,
          endSeconds: recommendation.endSeconds ?? null,
        })) ?? []
      )
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
      const video = result.data?.videoBySlug
      return video ? toVideoBySlug(video) : null
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
