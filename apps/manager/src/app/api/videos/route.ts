import { NextResponse } from "next/server"
import { graphql } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"
import { env } from "@/config/env"
import { hasDownloadableMp4 } from "@/lib/video-sources"
import {
  type PageInfo,
  DEFAULT_PAGE_INFO,
  fetchAllPages,
} from "@/lib/strapi-pagination"
import { createSwrCache } from "@/lib/swr-cache"

type CmsVideoCoverage = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  thumbnailUrl: string | null
  videoStillUrl: string | null
  parentDocumentIds: string[]
  coverage: {
    subtitles: { human: number; ai: number }
    audio: { human: number; ai: number }
  }
}

type CoverageCounts = { human: number; ai: number; none: number }

type DownloadEligibilityNode = {
  documentId: string
  variants: Array<{
    downloads?: Array<{ url: string | null } | null> | null
  } | null> | null
}

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

const GET_VIDEO_DOWNLOAD_ELIGIBILITY = graphql(`
  query GetVideoDownloadEligibility($pagination: PaginationArg) {
    videos_connection(pagination: $pagination) {
      nodes {
        documentId
        variants(pagination: { limit: -1 }) {
          downloads(pagination: { limit: -1 }) {
            url
          }
        }
      }
      pageInfo {
        page
        pageCount
        pageSize
        total
      }
    }
  }
`)

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

async function fetchDownloadableVideoIds(): Promise<Set<string>> {
  const client = getClient()

  const nodes = await fetchAllPages(async (page) => {
    const result = await client.query({
      query: GET_VIDEO_DOWNLOAD_ELIGIBILITY,
      variables: { pagination: { page, pageSize: 5000 } },
      fetchPolicy: "no-cache",
    })

    const conn = result.data?.videos_connection
    return {
      nodes: (conn?.nodes ?? []) as unknown as DownloadEligibilityNode[],
      pageInfo: (conn?.pageInfo ?? DEFAULT_PAGE_INFO) as PageInfo,
    }
  })

  return new Set(
    nodes
      .filter((node) => hasDownloadableMp4(node.variants))
      .map((node) => node.documentId),
  )
}

export const videoCache = createSwrCache({
  fetcher: () => fetchVideoCoverage(),
  ttlMs: 2 * 60_000,
  maxStaleMs: 30 * 60_000,
  label: "video-cache",
})

export const downloadableVideoIdsCache = createSwrCache({
  fetcher: fetchDownloadableVideoIds,
  ttlMs: 15 * 60_000,
  maxStaleMs: 60 * 60_000,
  label: "video-download-eligibility-cache",
})

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const languageIds = url.searchParams.get("languageIds")?.split(",") ?? []
  const selectedLanguages = languageIds.filter(Boolean)

  try {
    const [videos, downloadableVideoIds] = await Promise.all([
      selectedLanguages.length === 0
        ? videoCache.get()
        : fetchVideoCoverage(selectedLanguages),
      downloadableVideoIdsCache.get(),
    ])

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
      const imageUrl = video.thumbnailUrl ?? video.videoStillUrl ?? null

      return {
        id: String(video.coreId ?? video.documentId),
        title:
          video.title ?? video.slug ?? String(video.coreId ?? video.documentId),
        imageUrl,
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
        hasDownloadableMp4: downloadableVideoIds.has(video.documentId),
      }
    }

    const videoMap = new Map(videos.map((video) => [video.documentId, video]))

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

    collections.sort((left, right) => left.title.localeCompare(right.title))

    const standalone = videos
      .filter(
        (video) =>
          video.parentDocumentIds.length === 0 &&
          !parentChildrenMap.has(video.documentId),
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
