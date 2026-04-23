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

export type PublishError = {
  message: string
  code?: string
  reason?: string
  suggestions?: string[]
}

export type PublishResult =
  | {
      success: true
      documentId: string
      slug: string
      warning?: string
    }
  | {
      success: false
      error: PublishError
    }

type StrapiErrorResponse = {
  error?:
    | string
    | {
        message?: string
        code?: string
        reason?: string
        suggestions?: string[]
        details?: {
          errors?: Array<{ path?: (string | number)[]; message?: string }>
        }
      }
}

class StrapiRequestError extends Error {
  status: number
  body?: StrapiErrorResponse

  constructor(status: number, message: string, body?: StrapiErrorResponse) {
    super(message)
    this.name = "StrapiRequestError"
    this.status = status
    this.body = body
  }
}

function getStrapiErrorMessage(
  body: StrapiErrorResponse | undefined,
  fallback: string,
): string {
  if (!body?.error) return fallback
  if (typeof body.error === "string") return body.error

  const detailMessages = body.error.details?.errors
    ?.map((entry) => {
      const path = entry.path?.join(".") ?? ""
      return path ? `${path}: ${entry.message}` : entry.message
    })
    .filter((message): message is string => Boolean(message))

  if (detailMessages && detailMessages.length > 0) {
    return detailMessages.join("\n")
  }

  return body.error.message ?? fallback
}

function normalizePublishError(error: unknown, fallback: string): PublishError {
  if (error instanceof StrapiRequestError) {
    const body = error.body
    const payload = body?.error

    if (payload && typeof payload !== "string") {
      return {
        message: getStrapiErrorMessage(body, error.message),
        code: typeof payload.code === "string" ? payload.code : undefined,
        reason: typeof payload.reason === "string" ? payload.reason : undefined,
        suggestions: Array.isArray(payload.suggestions)
          ? payload.suggestions.filter(
              (suggestion): suggestion is string =>
                typeof suggestion === "string" && suggestion.length > 0,
            )
          : undefined,
      }
    }

    return { message: getStrapiErrorMessage(body, error.message) }
  }

  if (error instanceof Error) {
    return { message: error.message }
  }

  return { message: fallback }
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
    const fallback = `Strapi request failed: ${response.status} ${response.statusText}`
    let body: StrapiErrorResponse | undefined
    try {
      body = (await response.json()) as StrapiErrorResponse
    } catch {
      // Use default message
    }

    throw new StrapiRequestError(
      response.status,
      getStrapiErrorMessage(body, fallback),
      body,
    )
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
    if (!result.created) {
      return {
        success: false,
        error: { message: "Failed to publish experience" },
      }
    }

    return {
      success: true,
      documentId: result.documentId,
      slug: result.slug,
      warning: !result.relationsPatched
        ? "Published but video relations could not be linked. Try re-publishing."
        : undefined,
    }
  } catch (error) {
    return {
      success: false,
      error: normalizePublishError(error, "Failed to publish experience"),
    }
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
