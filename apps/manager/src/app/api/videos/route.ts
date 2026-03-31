import { NextResponse } from "next/server"
import { graphql } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"
import {
  type PageInfo,
  DEFAULT_PAGE_INFO,
  fetchAllPages,
} from "@/lib/strapi-pagination"

// ---------------------------------------------------------------------------
// Typed queries
// ---------------------------------------------------------------------------

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
        images {
          thumbnail
          videoStill
        }
        children {
          documentId
          coreId
          title
          label
          slug
          aiMetadata
          images {
            thumbnail
            videoStill
          }
          variants {
            coreId
            source
            aiGenerated
            language {
              coreId
            }
          }
          subtitles {
            coreId
            source
            aiGenerated
            language {
              coreId
            }
          }
        }
        variants {
          coreId
          source
          aiGenerated
          language {
            coreId
          }
        }
        subtitles {
          coreId
          source
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawMediaItem = {
  coreId: string | null
  source: string | null
  aiGenerated: boolean | null
  language: { coreId: string | null } | null
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
  variants: RawMediaItem[] | null
  subtitles: RawMediaItem[] | null
  children?: RawVideoNode[] | null
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
      selectedLanguageIds.size === 0
        ? "none"
        : video.aiMetadata === true
          ? "ai"
          : video.aiMetadata === false
            ? "human"
            : "none",
  }
}

// ---------------------------------------------------------------------------
// In-memory cache for video nodes (avoids ~4s Strapi query on every request)
// ---------------------------------------------------------------------------

let cachedVideoNodes: RawVideoNode[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000 // 1 minute

async function getVideoNodes(): Promise<RawVideoNode[]> {
  const now = Date.now()
  if (cachedVideoNodes && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVideoNodes
  }

  const client = getClient()
  const nodes = await fetchAllPages(async (page) => {
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

  cachedVideoNodes = nodes
  cacheTimestamp = now
  return nodes
}

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
    const videoNodes = await getVideoNodes()

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
      }
    }

    // Parents = videos that have children (via the relation)
    // Each parent becomes a collection, its children become the videos inside
    const childDocIds = new Set<string>()
    const collections: Array<{
      id: string
      title: string
      label: string
      labelDisplay: string
      videos: ReturnType<typeof toVideoItem>[]
    }> = []

    for (const video of videoNodes) {
      const children = video.children ?? []
      if (children.length === 0) continue

      for (const child of children) {
        childDocIds.add(child.documentId)
      }

      collections.push({
        id: String(video.coreId ?? video.documentId),
        title:
          video.title ?? video.slug ?? String(video.coreId ?? video.documentId),
        label: video.label ?? "unknown",
        labelDisplay:
          LABEL_DISPLAY[video.label ?? "unknown"] ?? video.label ?? "unknown",
        videos: children.map(toVideoItem),
      })
    }

    // Videos that aren't children of any parent and have no children themselves
    const standalone = videoNodes.filter(
      (v) => !childDocIds.has(v.documentId) && (v.children ?? []).length === 0,
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
    console.error("[api/videos] Failed to fetch video data:", error)
    return NextResponse.json(
      { error: "Failed to fetch video data" },
      { status: 502 },
    )
  }
}
