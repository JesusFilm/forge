import { NextResponse } from "next/server"
import { graphql } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"

// ---------------------------------------------------------------------------
// Typed queries
// ---------------------------------------------------------------------------

const GET_VIDEOS_CONNECTION = graphql(`
  query GetVideosApi($pagination: PaginationArg) {
    videos_connection(pagination: $pagination) {
      nodes {
        documentId
        gatewayId
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
          gatewayId
          title
          label
          slug
          aiMetadata
          images {
            thumbnail
            videoStill
          }
          variants {
            gatewayId
            source
            aiGenerated
            language {
              gatewayId
            }
          }
          subtitles {
            gatewayId
            source
            aiGenerated
            language {
              gatewayId
            }
          }
        }
        variants {
          gatewayId
          source
          aiGenerated
          language {
            gatewayId
          }
        }
        subtitles {
          gatewayId
          source
          aiGenerated
          language {
            gatewayId
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
// Pagination helper
// ---------------------------------------------------------------------------

type PageInfo = {
  page: number
  pageCount: number
  pageSize: number
  total: number
}

const DEFAULT_PAGE_INFO: PageInfo = {
  page: 1,
  pageCount: 1,
  pageSize: 5000,
  total: 0,
}

async function fetchAllPages<T>(
  fetcher: (page: number) => Promise<{ nodes: T[]; pageInfo: PageInfo }>,
): Promise<T[]> {
  const allNodes: T[] = []
  let currentPage = 1

  while (true) {
    const result = await fetcher(currentPage)
    allNodes.push(...result.nodes)
    if (currentPage >= result.pageInfo.pageCount) break
    currentPage += 1
  }

  return allNodes
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawVariant = {
  gatewayId: string | null
  source: string | null
  aiGenerated: boolean | null
  language: { gatewayId: string | null } | null
}

type RawSubtitle = {
  gatewayId: string | null
  source: string | null
  aiGenerated: boolean | null
  language: { gatewayId: string | null } | null
}

type RawImage = {
  thumbnail: string | null
  videoStill: string | null
}

type RawVideoNode = {
  documentId: string
  gatewayId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  images: RawImage[] | null
  variants: RawVariant[] | null
  subtitles: RawSubtitle[] | null
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
// Route handler
// ---------------------------------------------------------------------------

function determineCoverage(
  video: RawVideoNode,
  selectedLanguageIds: Set<string>,
  reportType: string,
): CoverageStatus {
  if (selectedLanguageIds.size === 0) return "none"

  if (reportType === "meta") {
    return video.aiMetadata ? "ai" : "none"
  }

  const items =
    reportType === "audio" ? (video.variants ?? []) : (video.subtitles ?? [])

  const matching = items.filter(
    (item) =>
      item.language?.gatewayId &&
      selectedLanguageIds.has(item.language.gatewayId),
  )

  if (matching.length === 0) return "none"

  // All items are AI-generated → "ai", otherwise at least one is verified → "human"
  const allAi = matching.every((item) => item.aiGenerated)
  return allAi ? "ai" : "human"
}

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const languageIds = url.searchParams.get("languageIds")?.split(",") ?? []
  const selectedSet = new Set(languageIds.filter(Boolean))
  const reportType = url.searchParams.get("reportType") ?? "subtitles"

  const client = getClient()

  try {
    const videoNodes = await fetchAllPages(async (page) => {
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

    function toVideoItem(video: RawVideoNode) {
      const variantLanguageIds = (video.variants ?? [])
        .map((v) => v.language?.gatewayId)
        .filter((id): id is string => id != null)
      const subtitleLanguageIds = (video.subtitles ?? [])
        .map((s) => s.language?.gatewayId)
        .filter((id): id is string => id != null)

      const firstImage = (video.images ?? [])[0]
      const imageUrl = firstImage?.thumbnail ?? firstImage?.videoStill ?? null

      return {
        id: String(video.gatewayId ?? video.documentId),
        title:
          video.title ??
          video.slug ??
          String(video.gatewayId ?? video.documentId),
        imageUrl,
        label: video.label ?? "unknown",
        coverageStatus: determineCoverage(video, selectedSet, reportType),
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
        id: String(video.gatewayId ?? video.documentId),
        title:
          video.title ??
          video.slug ??
          String(video.gatewayId ?? video.documentId),
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
