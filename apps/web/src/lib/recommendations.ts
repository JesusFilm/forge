import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql } from "@forge/admin-graphql"
import { resolveVideoDisplayTitle } from "@forge/content-display"
import client from "@/lib/admin-client"

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
      englishTitleLocales: locales(locale: "en") {
        title
      }
      englishLanguageTitleLocales: locales(languageSlug: "english") {
        title
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
        title:
          resolveVideoDisplayTitle({
            requestedTitles: raw.locales?.map((locale) => locale.title),
            englishTitles: [
              ...(raw.englishTitleLocales?.map((row) => row.title) ?? []),
              ...(raw.englishLanguageTitleLocales?.map((row) => row.title) ??
                []),
            ],
            slug: raw.slug ?? slug,
          }) ?? null,
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
  ["video-by-slug-v2"],
  { revalidate: 60 },
)

export const getVideoBySlug = cache(
  async (slug: string, locale: string): Promise<VideoBySlug | null> => {
    return fetchVideoBySlug(slug, locale)
  },
)
