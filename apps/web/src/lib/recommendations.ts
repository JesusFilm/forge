import { cache } from "react"
import { unstable_cache } from "next/cache"
import { gql } from "@apollo/client"
import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"

// --- SceneRecommendation types (custom extension, not in gql.tada introspection) ---

export type SceneRecommendation = {
  videoId: number
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

// Use raw gql tag — sceneRecommendations is a custom GraphQL extension type
// not present in Strapi's auto-generated introspection schema.
const SCENE_RECOMMENDATIONS = gql`
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
`

type SceneRecommendationsResult = {
  sceneRecommendations: SceneRecommendation[]
}

// --- Video lookup (uses gql.tada typed query) ---

const GET_VIDEO_BY_SLUG = graphql(`
  query GetVideoBySlug($slug: String!, $locale: I18NLocaleCode!) {
    videos(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
      title
      slug
      description
      images {
        url
        thumbnail
        mobileCinematicHigh
      }
    }
  }
`)

export type VideoBySlug = NonNullable<
  ResultOf<typeof GET_VIDEO_BY_SLUG>["videos"]
>[number]

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
      return result.data?.videos?.[0] ?? null
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
