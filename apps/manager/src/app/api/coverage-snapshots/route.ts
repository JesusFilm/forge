import { NextResponse } from "next/server"
import { z } from "zod"
import { graphql } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"
import { createSwrCache } from "@/lib/swr-cache"

const GET_COVERAGE_SNAPSHOTS = graphql(`
  query GetCoverageSnapshots(
    $filters: CoverageSnapshotFiltersInput
    $sort: [String]
    $pagination: PaginationArg
  ) {
    coverageSnapshots(filters: $filters, sort: $sort, pagination: $pagination) {
      documentId
      date
      computedAt
      totalVideos
      videosWithAiMetadata
      videosWithHumanMetadata
      subtitlesHumanTotal
      subtitlesAiTotal
      audioHumanTotal
      audioAiTotal
      languageCoverage
    }
  }
`)

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const rangeSchema = z.object({
  startDate: z.string().regex(dateRegex, "Must be YYYY-MM-DD format"),
  endDate: z.string().regex(dateRegex, "Must be YYYY-MM-DD format"),
})

async function fetchLatestSnapshot() {
  const client = getClient()
  const result = await client.query({
    query: GET_COVERAGE_SNAPSHOTS,
    variables: {
      sort: ["date:desc"],
      pagination: { limit: 1 },
    },
    fetchPolicy: "no-cache",
  })

  return result.data?.coverageSnapshots?.[0] ?? null
}

export const latestCoverageSnapshotCache = createSwrCache({
  fetcher: fetchLatestSnapshot,
  ttlMs: 5 * 60_000,
  maxStaleMs: 24 * 60 * 60_000,
  label: "coverage-snapshot-cache",
})

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const isLatest = url.searchParams.get("latest") === "true"

  try {
    const client = getClient()

    if (isLatest) {
      const snapshot = await latestCoverageSnapshotCache.get()
      return NextResponse.json({ snapshot })
    }

    // Date range query for historical data (leadership animation)
    const query = rangeSchema.safeParse({
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate"),
    })

    if (!query.success) {
      return NextResponse.json(
        {
          error:
            "startDate and endDate query params required (YYYY-MM-DD), or use latest=true",
          details: query.error.flatten(),
        },
        { status: 400 },
      )
    }

    const { startDate, endDate } = query.data

    const result = await client.query({
      query: GET_COVERAGE_SNAPSHOTS,
      variables: {
        filters: { date: { gte: startDate, lte: endDate } },
        sort: ["date:asc"],
        pagination: { limit: -1 },
      },
      fetchPolicy: "no-cache",
    })

    const snapshots = result.data?.coverageSnapshots ?? []
    return NextResponse.json({ snapshots })
  } catch (error) {
    console.error(
      "[api/coverage-snapshots] Failed to fetch:",
      error instanceof Error ? error.message : "Unknown error",
    )
    return NextResponse.json(
      { error: "Failed to fetch coverage snapshots" },
      { status: 502 },
    )
  }
}
