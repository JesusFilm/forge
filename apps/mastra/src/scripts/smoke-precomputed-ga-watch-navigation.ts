import { readFile } from "node:fs/promises"

import { z } from "zod"

import {
  createGaWatchHistoryReader,
  planGaWatchNavigationFilters,
  readGaWatchReferrerAggregatePage,
  readGaWatchStartAggregatePage,
} from "../services/precomputed-recommendations/ga-watch-history"
import {
  readHistoricalDefinition,
  readHistoricalSnapshot,
} from "../services/precomputed-recommendations/historical-analytics"

/** Read-only QA harness. The file is a labeled local catalog fixture, never an app fallback. */
const snapshotSchema = z.object({
  status: z.literal("ok"),
  basis: z.literal("current_catalog_read_only"),
  cutoff: z.string().datetime(),
  rows: z.array(
    z.object({
      id: z.string(),
      core_id: z.string(),
      slug: z.string(),
      parent_slug: z.string().nullable(),
      deleted_at: z.null(),
      restrict_view_platforms: z.array(z.string()).length(0),
    }),
  ),
  languages: z.array(
    z.object({
      video_id: z.string(),
      language_slug: z.string().nullable(),
    }),
  ),
})

function option(name: string): string {
  const values = process.argv
    .slice(2)
    .filter((argument) => argument.startsWith(`--${name}=`))
  if (values.length !== 1) throw new Error("invalid_configuration")
  return values[0]!.slice(name.length + 3)
}

async function main() {
  const safeFetch: typeof fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      dimensions?: { name: string }[]
      dateRanges?: { startDate: string }[]
      offset?: string
    }
    const stage = `${request.dimensions?.map(({ name }) => name).join(",") ?? "unknown"} start=${request.dateRanges?.[0]?.startDate ?? "unknown"} offset=${request.offset ?? "unknown"}`
    process.stderr.write(`GA smoke request ${stage}\n`)
    try {
      const response = await fetch(url, init)
      process.stderr.write(
        `GA smoke response ${stage} status=${response.status}\n`,
      )
      return response
    } catch {
      process.stderr.write(`GA smoke response ${stage} network_error\n`)
      throw new Error("network_error")
    }
  }
  const snapshot = snapshotSchema.parse(
    JSON.parse(await readFile(option("route-snapshot"), "utf8")),
  )
  const sourceId = option("source-id")
  const targetId = option("target-id")
  const catalog = [...new Set(snapshot.rows.map((row) => row.id))].map((id) => {
    const rows = snapshot.rows.filter((row) => row.id === id)
    const first = rows[0]!
    const languages = [
      ...new Set(
        snapshot.languages
          .filter((row) => row.video_id === id)
          .map((row) => row.language_slug)
          .filter((value): value is string => value !== null),
      ),
    ]
    return {
      id,
      coreId: first.core_id,
      slug: first.slug,
      watchRouteIdentity: {
        basis: "current_catalog_cutoff_fenced" as const,
        parentSlugs: [
          ...new Set(
            rows
              .map((row) => row.parent_slug)
              .filter((value): value is string => value !== null),
          ),
        ],
        playableAudioLanguageSlugs: languages,
        truncated: false,
      },
    }
  })
  if (
    !catalog.some((video) => video.id === sourceId) ||
    !catalog.some((video) => video.id === targetId) ||
    sourceId === targetId
  )
    throw new Error("invalid_configuration")
  const connection = {
    propertyId: option("property-id"),
    serviceAccountEmail: option("service-account-email"),
    rangeStart: option("range-start"),
    rangeEnd: option("range-end"),
    fetchImpl: safeFetch,
  }
  const reader = createGaWatchHistoryReader(connection)
  const definition = await readHistoricalDefinition(reader, snapshot.cutoff)
  if (definition.provider !== "ga_data_api") throw new Error("smoke_failed")
  const source = catalog.find((video) => video.id === sourceId)!
  const target = catalog.find((video) => video.id === targetId)!
  const filters = planGaWatchNavigationFilters(source, target)
  if (filters.length === 0 || filters.length > 10)
    throw new Error("unexpected_query_count")
  const usable = {
    ...connection,
    rangeStart: definition.rangeStart,
    rangeEnd: definition.rangeEnd,
  }
  let estimatedPages = 0
  let referrerRows = 0
  let engagementRows = 0
  for (const filter of filters) {
    const first = await readGaWatchReferrerAggregatePage({
      ...usable,
      ...filter,
      offset: 0,
      limit: 1,
    })
    if (first.status !== "unqualified") throw new Error("incomplete_report")
    referrerRows += first.rowCount
    const pages = Math.max(1, Math.ceil(first.rowCount / 100))
    process.stderr.write(
      `GA smoke preflight kind=navigation rows=${first.rowCount} estimatedPages=${pages}\n`,
    )
    if (pages > 50) throw new Error("unexpected_query_size")
    estimatedPages += pages
  }
  const targetFilters = [
    ...new Set(filters.map((item) => item.targetRouteRegex)),
  ]
  for (const targetRouteRegex of targetFilters) {
    const first = await readGaWatchStartAggregatePage({
      ...usable,
      targetRouteRegex,
      offset: 0,
      limit: 1,
    })
    if (first.status !== "unqualified") throw new Error("incomplete_report")
    const pages = Math.max(1, Math.ceil(first.rowCount / 100))
    process.stderr.write(
      `GA smoke preflight kind=engagement rows=${first.rowCount} estimatedPages=${pages}\n`,
    )
    engagementRows += first.rowCount
    if (pages > 50) throw new Error("unexpected_query_size")
    estimatedPages += pages
  }
  if (estimatedPages > 60) throw new Error("unexpected_query_size")
  const result = await readHistoricalSnapshot({
    reader,
    definition,
    catalog: catalog.filter(
      (video) => video.id === sourceId || video.id === targetId,
    ),
    routeCatalog: catalog,
    sourceVideoId: sourceId,
    selectedVideoIds: [targetId],
    includeSourceEngagement: false,
    cutoff: snapshot.cutoff,
  })
  if (result.provenance.rowCount !== referrerRows + engagementRows)
    throw new Error("row_count_changed")
  process.stdout.write(
    `${JSON.stringify({
      basis: "local_read_only_catalog_fixture",
      provider: result.provenance.provider,
      usableStart: result.provenance.rangeStart,
      usableEnd: result.provenance.rangeEnd,
      sourceId,
      targetId,
      sourceLanguageCount: catalog.find((video) => video.id === sourceId)!
        .watchRouteIdentity.playableAudioLanguageSlugs.length,
      targetLanguageCount: catalog.find((video) => video.id === targetId)!
        .watchRouteIdentity.playableAudioLanguageSlugs.length,
      missingLanguageSlugRows: snapshot.languages.filter(
        (row) => row.language_slug === null,
      ).length,
      navigation: result.navigation?.(sourceId, targetId) ?? null,
      engagement: result.signal(targetId),
      preflightReferrerRows: referrerRows,
      preflightEngagementRows: engagementRows,
      estimatedPages,
      navigationCoverage: result.provenance.navigationCoverage,
      rows: result.provenance.rowCount,
      pages: result.provenance.pageCount,
      queries: result.provenance.queryExecutionCount,
      historicalOwnership: "unverified",
    })}\n`,
  )
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error &&
          [
            "unexpected_query_count",
            "unexpected_query_size",
            "incomplete_report",
            "invalid_configuration",
            "row_count_changed",
          ].includes(error.message)
        ? error.message
        : "smoke_failed"
  process.stderr.write(`GA navigation smoke failed: ${code}\n`)
  process.exitCode = 1
})
