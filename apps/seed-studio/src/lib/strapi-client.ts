import type { GeneratedExperience } from "@/lib/ai/experience-schema"

const STRAPI_URL = process.env.STRAPI_URL ?? "http://localhost:1337"
const TOKEN = process.env.STRAPI_SEED_STUDIO_TOKEN ?? ""

type VideoSearchResult = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string
  thumbnailUrl?: string
  tags?: string[]
}

type VideoCatalogStats = {
  totalVideos: number
  labels: string[]
}

type PublishResult = {
  success: boolean
  documentId?: string
  error?: string
}

type StrapiError = {
  status: number
  message: string
}

async function strapiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${STRAPI_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Seed-Studio-Token": TOKEN,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error: StrapiError = {
      status: response.status,
      message: `Strapi request failed: ${response.status} ${response.statusText}`,
    }
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      if (body.error?.message) {
        error.message = body.error.message
      }
    } catch {
      // Use default message
    }
    throw new Error(error.message)
  }

  return response.json() as Promise<T>
}

export async function searchVideos(
  query: string,
  tags?: string[],
  locale?: string,
): Promise<VideoSearchResult[]> {
  try {
    const result = await strapiRequest<{ videos: VideoSearchResult[] }>(
      "/api/seed-studio/search-videos",
      {
        method: "POST",
        body: JSON.stringify({ query, tags, locale }),
      },
    )
    return result.videos
  } catch (error) {
    console.error("Failed to search videos:", error)
    return []
  }
}

export async function publishExperience(
  experience: GeneratedExperience,
): Promise<PublishResult> {
  try {
    const result = await strapiRequest<{
      created: boolean
      relationsPatched: boolean
      documentId: string
      slug: string
    }>("/api/seed-studio/publish-experience", {
      method: "POST",
      body: JSON.stringify(experience),
    })
    return {
      success: result.created,
      documentId: result.documentId,
      error:
        result.created && !result.relationsPatched
          ? "Published but video relations could not be linked. Try re-publishing."
          : undefined,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to publish experience"
    return { success: false, error: message }
  }
}

export async function getVideoCatalogStats(): Promise<VideoCatalogStats> {
  try {
    return await strapiRequest<VideoCatalogStats>(
      "/api/seed-studio/video-catalog-stats",
    )
  } catch (error) {
    console.error("Failed to get video catalog stats:", error)
    return { totalVideos: 0, labels: [] }
  }
}
