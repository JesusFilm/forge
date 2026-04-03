import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { env } from "@/config/env"
import { createSwrCache } from "@/lib/swr-cache"

// ---------------------------------------------------------------------------
// Types from CMS /api/video-coverage endpoint
// ---------------------------------------------------------------------------

type CmsVideoCoverage = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  imageUrl: string | null
  parentDocumentIds: string[]
  coverage: {
    subtitles: { human: number; ai: number }
    audio: { human: number; ai: number }
  }
}

type CoverageCounts = { human: number; ai: number; none: number }

const LABEL_DISPLAY: Record<string, string> = {
  collection: "Collection",
  episode: "Episode",
  featureFilm: "Feature Film",
  segment: "Segment",
  series: "Series",
  shortFilm: "Short Film",
  trailer: "Trailer",
  behindTheScenes: "Behind the Scenes",
  unknown: "Other",
}

// ---------------------------------------------------------------------------
// Fetch from CMS video-coverage endpoint
// ---------------------------------------------------------------------------

async function fetchVideoCoverage(
  languageIds?: string[],
): Promise<CmsVideoCoverage[]> {
  const params = new URLSearchParams()
  if (languageIds && languageIds.length > 0) {
    params.set("languageIds", languageIds.join(","))
  }
  const qs = params.toString()
  const url = `${env.STRAPI_URL}/api/video-coverage${qs ? `?${qs}` : ""}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(
      `CMS /api/video-coverage returned ${response.status}: ${await response.text()}`,
    )
  }

  const data = (await response.json()) as { videos: CmsVideoCoverage[] }
  return data.videos
}

// ---------------------------------------------------------------------------
// SWR cache — refreshes in <2s (down from 22-47s with GraphQL)
// ---------------------------------------------------------------------------

export const videoCache = createSwrCache({
  fetcher: () => fetchVideoCoverage(),
  ttlMs: 2 * 60_000,
  maxStaleMs: 30 * 60_000,
  label: "video-cache",
})

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const languageIds = url.searchParams.get("languageIds")?.split(",") ?? []
  const selectedLanguages = languageIds.filter(Boolean)

  try {
    // Fetch from CMS — use cached global data for unfiltered requests,
    // direct fetch for language-filtered requests (SQL is fast enough).
    const videos =
      selectedLanguages.length === 0
        ? await videoCache.get()
        : await fetchVideoCoverage(selectedLanguages)

    const numSelected = selectedLanguages.length

    function toCoverageCounts(counts: {
      human: number
      ai: number
    }): CoverageCounts {
      return {
        human: counts.human,
        ai: counts.ai,
        none:
          numSelected > 0
            ? Math.max(0, numSelected - counts.human - counts.ai)
            : 0,
      }
    }

    function toVideoItem(video: CmsVideoCoverage) {
      return {
        id: String(video.coreId ?? video.documentId),
        title:
          video.title ?? video.slug ?? String(video.coreId ?? video.documentId),
        imageUrl: video.imageUrl,
        label: video.label ?? "unknown",
        coverage: {
          subtitles: toCoverageCounts(video.coverage.subtitles),
          audio: toCoverageCounts(video.coverage.audio),
          meta: {
            human: video.aiMetadata === false ? 1 : 0,
            ai: video.aiMetadata === true ? 1 : 0,
            none: video.aiMetadata == null ? 1 : 0,
          } satisfies CoverageCounts,
        },
      }
    }

    // Reconstruct parent-child hierarchy from parentDocumentIds
    const videoMap = new Map(videos.map((v) => [v.documentId, v]))

    const parentChildrenMap = new Map<string, CmsVideoCoverage[]>()
    for (const video of videos) {
      for (const parentDocId of video.parentDocumentIds) {
        let children = parentChildrenMap.get(parentDocId)
        if (!children) {
          children = []
          parentChildrenMap.set(parentDocId, children)
        }
        children.push(video)
      }
    }

    const collections: Array<{
      id: string
      title: string
      label: string
      labelDisplay: string
      coverage: {
        subtitles: CoverageCounts
        audio: CoverageCounts
        meta: CoverageCounts
      }
      videos: ReturnType<typeof toVideoItem>[]
    }> = []

    for (const [parentDocId, children] of parentChildrenMap) {
      const parent = videoMap.get(parentDocId)
      if (!parent) continue

      const parentItem = toVideoItem(parent)

      collections.push({
        id: parentItem.id,
        title: parentItem.title,
        label: parentItem.label,
        labelDisplay:
          LABEL_DISPLAY[parent.label ?? "unknown"] ?? parent.label ?? "unknown",
        coverage: parentItem.coverage,
        videos: children.map(toVideoItem),
      })
    }

    collections.sort((a, b) => a.title.localeCompare(b.title))

    // Videos that aren't children of any parent and have no children themselves
    const standalone = videos
      .filter(
        (v) =>
          v.parentDocumentIds.length === 0 &&
          !parentChildrenMap.has(v.documentId),
      )
      .map(toVideoItem)

    return NextResponse.json({ collections, standalone })
  } catch (error) {
    console.error(
      "[api/videos] Failed to fetch video data:",
      error instanceof Error ? error.message : "Unknown error",
    )
    return NextResponse.json(
      { error: "Failed to fetch video data" },
      { status: 502 },
    )
  }
}
