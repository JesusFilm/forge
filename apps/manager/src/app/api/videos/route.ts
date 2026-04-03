import { NextResponse } from "next/server"
import { graphql } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"
import { hasDownloadableMp4 } from "@/lib/video-sources"
import {
  type PageInfo,
  DEFAULT_PAGE_INFO,
  fetchAllPages,
} from "@/lib/strapi-pagination"
import { createSwrCache } from "@/lib/swr-cache"

// ---------------------------------------------------------------------------
// Typed queries
// ---------------------------------------------------------------------------

// Flat query: fetches ALL videos at the top level with `parents` for hierarchy
// reconstruction. Explicit `pagination: { limit: -1 }` on nested relations to
// avoid Strapi v5's default limit of 10.
// Only fetches fields needed for coverage computation (aiGenerated + language).
const GET_VIDEOS_CONNECTION = graphql(`
  query GetVideosApi($pagination: PaginationArg) {
    videos_connection(pagination: $pagination) {
      nodes {
        documentId
        coreId
        title
        label
        slug
        aiMetadata
        images(pagination: { limit: -1 }) {
          thumbnail
          videoStill
        }
        parents(pagination: { limit: -1 }) {
          documentId
        }
        variants(pagination: { limit: -1 }) {
          aiGenerated
          language {
            coreId
          }
          muxVideo {
            assetId
          }
        }
        subtitles(pagination: { limit: -1 }) {
          aiGenerated
          language {
            coreId
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawMediaItem = {
  aiGenerated: boolean | null
  language: { coreId: string | null } | null
}

type RawVariant = RawMediaItem & {
  muxVideo: { assetId: string | null } | null
  downloads?: Array<{ url: string | null } | null> | null
}

type RawImage = {
  thumbnail: string | null
  videoStill: string | null
}

type RawVideoNode = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  images: RawImage[] | null
  parents: Array<{ documentId: string }> | null
  variants: RawVariant[] | null
  subtitles: RawMediaItem[] | null
}

type DownloadEligibilityNode = {
  documentId: string
  variants: RawVariant[] | null
}

type CoverageStatus = "human" | "ai" | "none"

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
// Coverage helpers
// ---------------------------------------------------------------------------

function determineCoverageForItems(
  items: RawMediaItem[],
  selectedLanguageIds: Set<string>,
): CoverageStatus {
  // When no languages selected, evaluate ALL items to show global coverage
  const matching =
    selectedLanguageIds.size === 0
      ? items.filter((item) => item.language?.coreId)
      : items.filter(
          (item) =>
            item.language?.coreId &&
            selectedLanguageIds.has(item.language.coreId),
        )

  if (matching.length === 0) return "none"

  const allAi = matching.every((item) => item.aiGenerated)
  return allAi ? "ai" : "human"
}

function determineCoverage(
  video: RawVideoNode,
  selectedLanguageIds: Set<string>,
): { subtitles: CoverageStatus; audio: CoverageStatus; meta: CoverageStatus } {
  return {
    subtitles: determineCoverageForItems(
      video.subtitles ?? [],
      selectedLanguageIds,
    ),
    audio: determineCoverageForItems(video.variants ?? [], selectedLanguageIds),
    meta:
      video.aiMetadata === true
        ? "ai"
        : video.aiMetadata === false
          ? "human"
          : "none",
  }
}

// ---------------------------------------------------------------------------
// SWR cache for video nodes (avoids ~4s Strapi query on every request)
// ---------------------------------------------------------------------------

async function fetchVideoNodes(): Promise<RawVideoNode[]> {
  const client = getClient()
  return fetchAllPages(async (page) => {
    const result = await client.query({
      query: GET_VIDEOS_CONNECTION,
      variables: { pagination: { page, pageSize: 5000 } },
      fetchPolicy: "no-cache",
    })
    const conn = result.data?.videos_connection
    return {
      nodes: (conn?.nodes ?? []) as unknown as RawVideoNode[],
      pageInfo: (conn?.pageInfo ?? DEFAULT_PAGE_INFO) as PageInfo,
    }
  })
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
  fetcher: fetchVideoNodes,
  ttlMs: 2 * 60_000, // 2 minutes — actively edited content
  maxStaleMs: 30 * 60_000, // 30 minutes — hard limit
  label: "video-cache",
})

export const downloadableVideoIdsCache = createSwrCache({
  fetcher: fetchDownloadableVideoIds,
  ttlMs: 15 * 60_000,
  maxStaleMs: 60 * 60_000,
  label: "video-download-eligibility-cache",
})
// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const languageIds = url.searchParams.get("languageIds")?.split(",") ?? []
  const selectedSet = new Set(languageIds.filter(Boolean))

  try {
    const [videoNodes, downloadableVideoIds] = await Promise.all([
      videoCache.get(),
      downloadableVideoIdsCache.get(),
    ])

    function toVideoItem(video: RawVideoNode) {
      const variantLanguageIds = (video.variants ?? [])
        .map((v) => v.language?.coreId)
        .filter((id): id is string => id != null)
      const subtitleLanguageIds = (video.subtitles ?? [])
        .map((s) => s.language?.coreId)
        .filter((id): id is string => id != null)

      const firstImage = (video.images ?? []).find(
        (img) => img.thumbnail || img.videoStill,
      )
      const imageUrl = firstImage?.thumbnail ?? firstImage?.videoStill ?? null

      return {
        id: String(video.coreId ?? video.documentId),
        title:
          video.title ?? video.slug ?? String(video.coreId ?? video.documentId),
        imageUrl,
        label: video.label ?? "unknown",
        coverage: determineCoverage(video, selectedSet),
        variantLanguageIds,
        subtitleLanguageIds,
        hasDownloadableMp4: downloadableVideoIds.has(video.documentId),
      }
    }

    // Reconstruct parent-child hierarchy from the flat video list.
    // Each video's `parents` field tells us which videos it belongs to.
    const videoMap = new Map(videoNodes.map((v) => [v.documentId, v]))

    const parentChildrenMap = new Map<string, RawVideoNode[]>()
    for (const video of videoNodes) {
      for (const parent of video.parents ?? []) {
        let children = parentChildrenMap.get(parent.documentId)
        if (!children) {
          children = []
          parentChildrenMap.set(parent.documentId, children)
        }
        children.push(video)
      }
    }

    const collections: Array<{
      id: string
      title: string
      label: string
      labelDisplay: string
      videos: ReturnType<typeof toVideoItem>[]
    }> = []

    for (const [parentDocId, children] of parentChildrenMap) {
      const parent = videoMap.get(parentDocId)
      if (!parent) continue

      collections.push({
        id: String(parent.coreId ?? parent.documentId),
        title:
          parent.title ??
          parent.slug ??
          String(parent.coreId ?? parent.documentId),
        label: parent.label ?? "unknown",
        labelDisplay:
          LABEL_DISPLAY[parent.label ?? "unknown"] ?? parent.label ?? "unknown",
        videos: children.map(toVideoItem),
      })
    }

    // Videos that aren't children of any parent and have no children themselves
    const standalone = videoNodes.filter(
      (v) =>
        (v.parents ?? []).length === 0 && !parentChildrenMap.has(v.documentId),
    )
    if (standalone.length > 0) {
      collections.push({
        id: "standalone",
        title: "Standalone Videos",
        label: "standalone",
        labelDisplay: "Standalone",
        videos: standalone.map(toVideoItem),
      })
    }

    return NextResponse.json({ collections })
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
