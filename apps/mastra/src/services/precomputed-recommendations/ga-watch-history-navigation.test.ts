import { describe, expect, it, vi } from "vitest"

import {
  createGaWatchHistoryReader,
  readGaWatchReferrerAggregatePage,
} from "./ga-watch-history"
import {
  readHistoricalDefinition,
  readHistoricalSnapshot,
} from "./historical-analytics"

const languages = Array.from(
  { length: 60 },
  (_, index) => `language-${String(index).padStart(2, "0")}`,
)
const source = {
  id: "source",
  coreId: "source-core",
  slug: "film",
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced" as const,
    parentSlugs: [],
    playableAudioLanguageSlugs: languages,
    truncated: false,
  },
}
const target = {
  id: "target",
  coreId: "target-core",
  slug: "next",
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced" as const,
    parentSlugs: [],
    playableAudioLanguageSlugs: ["english"],
    truncated: false,
  },
}

describe("qualified GA Watch navigation snapshot", () => {
  it("reads a 501-row report in two bounded 500-row pages without losing rows", async () => {
    const requested: number[] = []
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          offset: string
          limit: string
        }
        const offset = Number(body.offset)
        const limit = Number(body.limit)
        requested.push(offset)
        const rows = Array.from({ length: 501 }, (_, index) => [
          `https://www.jesusfilm.org/watch/source-${index}.html/english.html`,
          "/watch/target.html/english.html",
          "media-id",
          "1",
        ])
        return new Response(
          JSON.stringify({
            dimensionHeaders: [
              { name: "pageReferrer" },
              { name: "pagePath" },
              { name: "customEvent:mediacomponentid" },
            ],
            metricHeaders: [{ name: "eventCount" }],
            rowCount: rows.length,
            rows: rows.slice(offset, offset + limit).map((row) => ({
              dimensionValues: row.slice(0, -1).map((value) => ({ value })),
              metricValues: [{ value: row.at(-1) }],
            })),
            metadata: { timeZone: "America/New_York" },
          }),
          { status: 200 },
        )
      },
    )
    const common = {
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-08-06",
      rangeEnd: "2022-10-31",
      limit: 500,
      tokenProvider: async () => ({
        ok: true as const,
        accessToken: "test-token",
      }),
      fetchImpl: fetchImpl as typeof fetch,
    }
    const first = await readGaWatchReferrerAggregatePage({
      ...common,
      offset: 0,
    })
    const second = await readGaWatchReferrerAggregatePage({
      ...common,
      offset: 500,
    })
    expect([first.rows.length, second.rows.length]).toEqual([500, 1])
    expect([first.nextOffset, second.nextOffset]).toEqual([500, null])
    expect(requested).toEqual([0, 500])
  })

  it("covers more than 50 language routes with one bounded coarse query and unique local mapping", async () => {
    const requests: {
      dimensions: string[]
      rangeStart: string
      referrerRegex: string | null
      pagePaths: string[] | null
      targetRouteRegex: string | null
    }[] = []
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          dimensions: { name: string }[]
          dateRanges: { startDate: string }[]
          dimensionFilter: {
            andGroup: {
              expressions: {
                filter?: {
                  fieldName: string
                  stringFilter?: { value: string }
                  inListFilter?: { values: string[] }
                }
              }[]
            }
          }
          offset: string
          limit: string
        }
        const dimensions = body.dimensions.map(({ name }) => name)
        const rangeStart = body.dateRanges[0]!.startDate
        const filters = body.dimensionFilter.andGroup.expressions
        const referrerRegex =
          filters.find((item) => item.filter?.fieldName === "pageReferrer")
            ?.filter?.stringFilter?.value ?? null
        const pagePaths =
          filters.find(
            (item) =>
              item.filter?.fieldName === "pagePath" && item.filter.inListFilter,
          )?.filter?.inListFilter?.values ?? null
        const targetRouteRegex =
          filters.find(
            (item) =>
              item.filter?.fieldName === "pagePath" &&
              item.filter.stringFilter?.value !== "^/watch(/.*)?$",
          )?.filter?.stringFilter?.value ?? null
        requests.push({
          dimensions,
          rangeStart,
          referrerRegex,
          pagePaths,
          targetRouteRegex,
        })
        let rows: string[][]
        if (dimensions[0] === "yearMonth") {
          rows = [["202209", "videostarts", "62"]]
        } else if (dimensions[0] === "year") {
          rows = [["2022", "60"]]
        } else if (dimensions[0] === "pageReferrer") {
          rows = languages.map((language) => [
            `https://www.jesusfilm.org/watch/film.html/${language}.html`,
            "/watch/next.html/english.html",
            "media-id",
            "1",
          ])
          rows.push([
            "https://www.jesusfilm.org/watch/film.html/language-unknown.html",
            "/watch/next.html/english.html",
            "media-id",
            "1",
          ])
          if (referrerRegex)
            rows = rows.filter((row) => new RegExp(referrerRegex).test(row[0]!))
          if (pagePaths)
            rows = rows.filter((row) => pagePaths.includes(row[1]!))
          if (targetRouteRegex)
            rows = rows.filter((row) =>
              new RegExp(targetRouteRegex).test(row[1]!),
            )
        } else {
          rows = [["/watch/next.html/english.html", "media-id", "1"]]
          if (pagePaths)
            rows = rows.filter((row) => pagePaths.includes(row[0]!))
          if (targetRouteRegex)
            rows = rows.filter((row) =>
              new RegExp(targetRouteRegex).test(row[0]!),
            )
        }
        const offset = Number(body.offset)
        const limit = Number(body.limit)
        // Low-cardinality counts can be complete while the high-cardinality
        // referrer report exposes the property's unavailable prefix.
        const truncated =
          rangeStart === "2022-06-21" && dimensions[0] === "pageReferrer"
        return new Response(
          JSON.stringify({
            dimensionHeaders: dimensions.map((name) => ({ name })),
            metricHeaders: [{ name: "eventCount" }],
            rowCount: rows.length,
            rows: rows.slice(offset, offset + limit).map((row) => ({
              dimensionValues: row.slice(0, -1).map((value) => ({ value })),
              metricValues: [{ value: row.at(-1) }],
            })),
            metadata: {
              timeZone: "America/New_York",
              ...(truncated
                ? {
                    dataTruncationReasons: [
                      {
                        dataTruncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
                        dataTruncationDate: "2022-08-05",
                      },
                    ],
                  }
                : {}),
            },
          }),
          { status: 200 },
        )
      },
    )
    const reader = createGaWatchHistoryReader({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fetchImpl as typeof fetch,
    })
    const definition = await readHistoricalDefinition(
      reader,
      "2022-11-01T00:00:00.000Z",
    )
    expect(definition).toMatchObject({
      provider: "ga_data_api",
      rangeStart: "2022-08-06",
      qualification: {
        sourceAvailability: {
          coverage: "partial_source_history",
          requestedStart: "2022-06-21",
          truncationDate: "2022-08-05",
          usableStart: "2022-08-06",
        },
      },
    })
    const snapshot = await readHistoricalSnapshot({
      reader,
      definition,
      catalog: [source, target],
      routeCatalog: [source, target],
      sourceVideoId: source.id,
      selectedVideoIds: [target.id],
      includeSourceEngagement: false,
      cutoff: "2022-11-01T00:00:00.000Z",
    })
    expect(snapshot.provenance).toMatchObject({
      provider: "ga_data_api",
      status: "complete",
      rangeStart: "2022-08-06",
      rowCount: 62,
      pageCount: 2,
      queryExecutionCount: 2,
      navigationCoverage: {
        candidateEvents: 61,
        qualifiedEvents: 60,
        homeEvents: 0,
        selfEvents: 0,
        crossHostEvents: 0,
        malformedEvents: 0,
        unmappedEvents: 1,
        ambiguousEvents: 0,
      },
    })
    expect(snapshot.transition(source.id, target.id)).toBeNull()
    expect(snapshot.navigation?.(source.id, target.id)).toBe(60)
    expect(snapshot.signal(target.id)).toEqual({
      videoKey: target.id,
      views: 1,
      engagedViews: null,
      exposures: null,
    })
    const bounded = requests.filter(
      (request) =>
        request.dimensions[0] === "pageReferrer" && request.targetRouteRegex,
    )
    expect(bounded).toHaveLength(1)
    expect(
      bounded.every(
        (request) =>
          request.referrerRegex &&
          request.referrerRegex.length <= 4_096 &&
          request.targetRouteRegex &&
          request.targetRouteRegex.length <= 4_096,
      ),
    ).toBe(true)
    expect(
      bounded.every((request) => request.rangeStart === "2022-08-06"),
    ).toBe(true)
  })
})
