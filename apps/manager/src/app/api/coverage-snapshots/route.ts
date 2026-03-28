import { NextResponse } from "next/server"
import { z } from "zod"
import { gql } from "@apollo/client"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"

// Using untyped gql until codegen runs with the new CoverageSnapshot type.
// After codegen: replace with graphql() from @forge/graphql for typed operations.

const GET_COVERAGE_SNAPSHOTS = gql`
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
      languageCoverage
    }
  }
`

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const rangeSchema = z.object({
  startDate: z.string().regex(dateRegex, "Must be YYYY-MM-DD format"),
  endDate: z.string().regex(dateRegex, "Must be YYYY-MM-DD format"),
})

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const isLatest = url.searchParams.get("latest") === "true"

  try {
    const client = getClient()

    if (isLatest) {
      // Return the most recent snapshot (no date range needed)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await client.query<any>({
        query: GET_COVERAGE_SNAPSHOTS,
        variables: {
          sort: ["date:desc"],
          pagination: { limit: 1 },
        },
        fetchPolicy: "no-cache",
      })

      const snapshot = result.data?.coverageSnapshots?.[0] ?? null
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await client.query<any>({
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
