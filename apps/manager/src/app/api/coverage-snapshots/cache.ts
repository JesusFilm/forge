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

async function fetchLatestSnapshot() {
  const gateway = getCmsGateway()
  if (gateway.mode === "mock") {
    const snapshots = await gateway.getCoverageSnapshots()
    return (
      snapshots
        .slice()
        .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null
    )
  }

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
