import { afterEach, describe, expect, it, vi } from "vitest"

import type { StructuredModel } from "./astra-provider"
import { createGaWatchHistoryReader } from "./ga-watch-history"
import { runPrecomputedSource } from "./source-generation"

vi.mock("../../config/env", () => ({
  env: {
    ADMIN_MASTRA_RECOMMENDATION_API_KEY: "test-service-key",
    ADMIN_RECOMMENDATION_CATALOG_URL: "http://localhost/catalog",
    ADMIN_RECOMMENDATION_INGEST_URL: "http://localhost/ingest",
    PRECOMPUTED_GA4_PROPERTY_ID: "320198532",
    PRECOMPUTED_GA4_SERVICE_ACCOUNT_EMAIL:
      "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
  },
}))

vi.mock("./ga-watch-history", async () => {
  const { HistoricalAnalyticsError } = await vi.importActual<
    typeof import("./historical-analytics")
  >("./historical-analytics")
  return {
    createGaWatchHistoryReader: vi.fn(() => ({
      describe: async () => {
        throw new HistoricalAnalyticsError("analytics_incomplete")
      },
      readPage: async () => {
        throw new Error("history pages must not be read")
      },
    })),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("default source-generation history wiring", () => {
  it.each([
    [
      "EDT evening before UTC midnight",
      "2026-10-04T01:00:00.000Z",
      "2026-10-02",
    ],
    [
      "EST evening before UTC midnight",
      "2026-12-04T04:00:00.000Z",
      "2026-12-02",
    ],
    ["UTC midnight during EDT", "2026-10-05T00:00:00.000Z", "2026-10-03"],
  ])(
    "uses the GA reader and stops before the model at %s",
    async (_caseName, inputCutoff, rangeEnd) => {
      const writes: string[] = []
      const video = {
        id: "source-video",
        coreId: "source-core",
        slug: "source-film",
        locale: "en",
        title: "Source film",
        description: "A source film",
        descriptionTruncated: false,
        keywords: [],
        keywordsTruncated: false,
        bibleCitations: [],
        bibleCitationsTruncated: false,
        parentVideoIds: [],
        childVideoIds: [],
        transcriptLanguages: [],
      }
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { action: string }
        writes.push(body.action)
        if (body.action === "status")
          return new Response(JSON.stringify({ reason: "not_found" }), {
            status: 404,
          })
        const result =
          body.action === "video"
            ? { action: "video", video }
            : body.action === "catalog"
              ? { action: "catalog", videos: [video], nextCursor: null }
              : body.action === "chunks"
                ? { action: "chunks", chunks: [], nextCursor: null }
                : { state: "incomplete", replay: false }
        return new Response(JSON.stringify({ result }), { status: 200 })
      })
      vi.stubGlobal("fetch", fetchImpl)
      const generate = vi.fn()
      const model: StructuredModel = { generate }

      const result = await runPrecomputedSource(
        {
          generationId: "ga-source-test",
          sourceVideoId: "source-video",
          inputCutoff,
          historyRequired: true,
        },
        { model },
      )

      expect(result).toMatchObject({
        state: "failed",
        failureCode: "analytics_incomplete",
      })
      expect(createGaWatchHistoryReader).toHaveBeenCalledWith({
        propertyId: "320198532",
        serviceAccountEmail:
          "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
        rangeStart: "2022-06-21",
        rangeEnd,
      })
      expect(generate).not.toHaveBeenCalled()
      expect(writes).toEqual([
        "status",
        "video",
        "chunks",
        "catalog",
        "start",
        "fail",
      ])
    },
  )
})
