import { graphql } from "@forge/graphql"
import { getCmsGateway } from "@/cms/gateway"
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

export const coverageSnapshotRangeDateRegex = /^\d{4}-\d{2}-\d{2}$/

type LatestCoverageSnapshotResult = {
  snapshot: Awaited<ReturnType<typeof fetchLatestSnapshotFromCms>>
}

async function fetchLatestSnapshotFromCms() {
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

async function fetchLatestSnapshot(): Promise<LatestCoverageSnapshotResult> {
  try {
    const gateway = getCmsGateway()
    if (gateway.mode === "mock" || gateway.mode === "admin") {
      const snapshot =
        (await gateway.getCoverageSnapshots({ latest: true }))[0] ?? null
      return { snapshot }
    }

    const snapshot = await fetchLatestSnapshotFromCms()
    return { snapshot }
  } catch (error) {
    console.warn(
      "[coverage-snapshot-cache] Falling back to empty latest snapshot:",
      error instanceof Error ? error.message : "Unknown error",
    )
    return { snapshot: null }
  }
}

export const latestCoverageSnapshotCache = createSwrCache({
  fetcher: fetchLatestSnapshot,
  ttlMs: 5 * 60_000,
  maxStaleMs: 24 * 60 * 60_000,
  label: "coverage-snapshot-cache",
})

export { GET_COVERAGE_SNAPSHOTS }
