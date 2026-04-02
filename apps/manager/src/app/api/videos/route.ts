import { NextResponse } from "next/server"
import { graphql } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"
import {
  type PageInfo,
  DEFAULT_PAGE_INFO,
  fetchAllPages,
} from "@/lib/strapi-pagination"
import { createSwrCache } from "@/lib/swr-cache"
import {
  buildVideoCollections,
  type RawVideoNode,
} from "@/lib/video-collections"

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

export const videoCache = createSwrCache({
  fetcher: fetchVideoNodes,
  ttlMs: 2 * 60_000, // 2 minutes — actively edited content
  maxStaleMs: 30 * 60_000, // 30 minutes — hard limit
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
  const selectedSet = new Set(languageIds.filter(Boolean))

  try {
    const videoNodes = await videoCache.get()
    const collections = buildVideoCollections(videoNodes, selectedSet)
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
