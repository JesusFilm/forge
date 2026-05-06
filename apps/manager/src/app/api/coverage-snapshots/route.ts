import { NextResponse } from "next/server"
import { z } from "zod"
import { getCmsGateway } from "@/cms/gateway"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"
import {
  coverageSnapshotRangeDateRegex,
  GET_COVERAGE_SNAPSHOTS,
  latestCoverageSnapshotCache,
} from "./cache"

const rangeSchema = z.object({
  startDate: z
    .string()
    .regex(coverageSnapshotRangeDateRegex, "Must be YYYY-MM-DD format"),
  endDate: z
    .string()
    .regex(coverageSnapshotRangeDateRegex, "Must be YYYY-MM-DD format"),
})

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const isLatest = url.searchParams.get("latest") === "true"

  try {
    const gateway = getCmsGateway()

    if (isLatest) {
      const { snapshot } = await latestCoverageSnapshotCache.get()
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

    if (gateway.mode !== "strapi") {
      const snapshots = (
        await gateway.getCoverageSnapshots({
          startDate,
          endDate,
        })
      ).filter(
        (snapshot) => snapshot.date >= startDate && snapshot.date <= endDate,
      )
      return NextResponse.json({ snapshots })
    }

    const client = getClient()
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
