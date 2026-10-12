import { expect } from "vitest"
import { createGaWatchHistoryReader } from "../../../apps/mastra/src/services/precomputed-recommendations/ga-watch-history"

type ReaderOptions = Parameters<typeof createGaWatchHistoryReader>[0]
type FixtureOptions = ReaderOptions &
  Required<Pick<ReaderOptions, "fetchImpl" | "tokenProvider">>

/** Synthetic HTTP at the GA boundary, with real report parsing and mapping. */
export function gaWatchHistoryFixtureOptions({
  sourceSlug,
  targetSlug,
  metadataSlug = "uncatalogued-story",
}: {
  sourceSlug: string
  targetSlug: string
  metadataSlug?: string
}): FixtureOptions {
  return {
    propertyId: "320198532",
    serviceAccountEmail:
      "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
    rangeStart: "2022-06-21",
    rangeEnd: "2026-10-03",
    tokenProvider: async () => ({ ok: true, accessToken: "fixture-token" }),
    fetchImpl: async (url, init) => {
      expect(String(url)).toBe(
        "https://analyticsdata.googleapis.com/v1beta/properties/320198532:runReport",
      )
      expect(init?.method).toBe("POST")
      const body = JSON.parse(String(init?.body)) as {
        dimensions: { name: string }[]
        dateRanges: { startDate: string }[]
        dimensionFilter: {
          andGroup: {
            expressions: {
              filter?: {
                fieldName: string
                stringFilter?: { value: string }
              }
            }[]
          }
        }
        offset: string
        limit: string
      }
      const dimensions = body.dimensions.map((item) => item.name)
      const filters = body.dimensionFilter.andGroup.expressions
      expect(filters).toEqual(
        expect.arrayContaining([
          {
            filter: {
              fieldName: "hostName",
              inListFilter: {
                values: ["jesusfilm.org", "www.jesusfilm.org"],
                caseSensitive: true,
              },
            },
          },
          {
            filter: {
              fieldName: "pagePath",
              stringFilter: {
                matchType: "FULL_REGEXP",
                value: "^/watch(/.*)?$",
                caseSensitive: true,
              },
            },
          },
        ]),
      )
      if (dimensions[0] !== "yearMonth") {
        expect(filters).toContainEqual({
          filter: {
            fieldName: "eventName",
            stringFilter: {
              matchType: "EXACT",
              value: "videostarts",
              caseSensitive: true,
            },
          },
        })
      }
      let rows: string[][]
      if (dimensions[0] === "yearMonth")
        rows = [["202209", "videostarts", "200"]]
      else if (dimensions[0] === "year") rows = [["2022", "200"]]
      else if (dimensions[0] === "pageReferrer")
        rows = [
          [
            `https://www.jesusfilm.org/watch/${sourceSlug}.html/english.html`,
            `/watch/${targetSlug}.html/english.html`,
            "legacy-target",
            "7",
          ],
          [
            `https://www.jesusfilm.org/watch/${sourceSlug}.html/unknown-language.html`,
            `/watch/${targetSlug}.html/english.html`,
            "legacy-target",
            "3",
          ],
        ]
      else
        rows = [
          [`/watch/${sourceSlug}.html/english.html`, "legacy-source", "100"],
          [`/watch/${targetSlug}.html/english.html`, "legacy-target", "80"],
          [`/watch/${metadataSlug}.html/english.html`, "legacy-metadata", "20"],
        ]
      for (const { filter } of body.dimensionFilter.andGroup.expressions) {
        if (!filter?.stringFilter) continue
        const index = dimensions.indexOf(filter.fieldName)
        if (index >= 0) {
          const pattern = new RegExp(filter.stringFilter.value)
          rows = rows.filter((row) => pattern.test(row[index]!))
        }
      }
      const offset = Number(body.offset)
      const limit = Number(body.limit)
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
            ...(body.dateRanges[0]!.startDate === "2022-06-21"
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
  }
}

export function gaWatchHistoryFixture(
  input: Parameters<typeof gaWatchHistoryFixtureOptions>[0],
) {
  return createGaWatchHistoryReader(gaWatchHistoryFixtureOptions(input))
}
