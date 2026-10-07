import { mkdtemp, readFile, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { captureGaWatchAggregates } from "./ga-watch-capture"
import { createGaWatchHistoryReader } from "./ga-watch-history"

const source = {
  id: "source",
  coreId: "source-core",
  slug: "source",
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced" as const,
    parentSlugs: [],
    playableAudioLanguageSlugs: ["english"],
    truncated: false,
  },
}
const target = {
  id: "target",
  coreId: "target-core",
  slug: "target",
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced" as const,
    parentSlugs: [],
    playableAudioLanguageSlugs: ["english"],
    truncated: false,
  },
}

function gaFixtureFetch(
  mode?:
    | "drift"
    | "threshold"
    | "many_starts"
    | "missing_media"
    | "total_mismatch"
    | "identified_mismatch"
    | "referrer_exceeds",
) {
  let capturedReferrerPages = 0
  return vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      dateRanges: { startDate: string }[]
      dimensions: { name: string }[]
      offset: string
      limit: string
    }
    const dimensions = body.dimensions.map(({ name }) => name)
    const kind = dimensions[0]
    const usableReferrerCapture =
      kind === "pageReferrer" &&
      body.dateRanges[0]?.startDate === "2022-08-06" &&
      Number(body.limit) === 500
    if (usableReferrerCapture) capturedReferrerPages += 1
    const metric =
      (mode === "drift" && capturedReferrerPages === 2) ||
      mode === "referrer_exceeds"
        ? "4"
        : "3"
    const rows =
      kind === "yearMonth"
        ? [["202208", "videostarts", mode === "missing_media" ? "5" : "3"]]
        : kind === "year"
          ? [["2022", mode === "identified_mismatch" ? "2" : "3"]]
          : kind === "pagePath"
            ? mode === "many_starts"
              ? Array.from({ length: 501 }, (_, index) => [
                  `/watch/target-${index}.html/english.html`,
                  `media-${index}`,
                  "3",
                ])
              : mode === "missing_media"
                ? [
                    ["/watch/target.html/english.html", "media", "3"],
                    ["/watch/target.html/english.html", "(not set)", "2"],
                  ]
                : [
                    [
                      "/watch/target.html/english.html",
                      "media",
                      mode === "total_mismatch" ? "4" : "3",
                    ],
                  ]
            : [
                [
                  "https://www.jesusfilm.org/watch/source.html/english.html?secret=viewer",
                  "/watch/target.html/english.html",
                  "media",
                  metric,
                ],
              ]
    const offset = Number(body.offset)
    const limit = Number(body.limit)
    const requestedReferrer =
      kind === "pageReferrer" && body.dateRanges[0]?.startDate === "2022-06-21"
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
          ...(requestedReferrer
            ? {
                dataTruncationReasons: [
                  {
                    dataTruncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
                    dataTruncationDate: "2022-08-05",
                  },
                ],
              }
            : {}),
          ...(mode === "threshold" && usableReferrerCapture
            ? { subjectToThresholding: true }
            : {}),
        },
      }),
      { status: 200 },
    )
  })
}

function captureInput(
  directory: string,
  fetchImpl: ReturnType<typeof gaFixtureFetch>,
) {
  const createReader = (rangeStart: string, rangeEnd: string) =>
    createGaWatchHistoryReader({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart,
      rangeEnd,
      tokenProvider: async () => ({ ok: true as const, accessToken: "test" }),
      fetchImpl: fetchImpl as typeof fetch,
    })
  return {
    directory,
    binding: {
      generationId: "generation-one",
      generationInputDigest: "1".repeat(64),
      sourceSetDigest: "2".repeat(64),
      inputCutoff: "2022-11-01T00:00:00.000Z",
      selectedCorpusDigest: "3".repeat(64),
      candidatePoolDigest: "4".repeat(64),
      routeCatalog: [source, target],
      propertyId: "320198532",
      requestedStart: "2022-06-21",
      requestedEnd: "2022-10-31",
    },
    createReader,
    historyCallCounts: async () => ({
      pending: 0,
      succeeded: fetchImpl.mock.calls.length,
      failed: 0,
    }),
  }
}

describe("GA Watch aggregate capture", () => {
  it("seals two matching complete reports and resumes without any GA read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-run-"))
    const fetchImpl = gaFixtureFetch()
    const input = captureInput(directory, fetchImpl)
    try {
      const sealed = await captureGaWatchAggregates(input)
      expect(sealed.header).toMatchObject({
        verification: "two_matching_passes",
        usableStart: "2022-08-06",
        startRows: 1,
        referrerRows: 1,
        sourceAvailability: { truncationDate: "2022-08-05" },
      })
      expect(
        (await readFile(sealed.path)).includes(Buffer.from("secret=viewer")),
      ).toBe(false)
      const capturedCalls = fetchImpl.mock.calls.length
      fetchImpl.mockImplementation(async () => {
        throw new Error("GA was read after seal")
      })
      const replay = await captureGaWatchAggregates(input)
      expect(replay.artifactSha256).toBe(sealed.artifactSha256)
      expect(fetchImpl).toHaveBeenCalledTimes(capturedCalls)
      await unlink(sealed.path)
      await expect(captureGaWatchAggregates(input)).rejects.toThrow()
      expect(fetchImpl).toHaveBeenCalledTimes(capturedCalls)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(["drift", "threshold"] as const)(
    "refuses a %s report before sealing",
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), "ga-capture-refuse-"))
      try {
        await expect(
          captureGaWatchAggregates(
            captureInput(directory, gaFixtureFetch(mode)),
          ),
        ).rejects.toMatchObject({ code: "analytics_incomplete" })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it("reconciles total and identified starts when media ID is not set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-missing-media-"))
    try {
      const sealed = await captureGaWatchAggregates(
        captureInput(directory, gaFixtureFetch("missing_media")),
      )
      expect(sealed.header.startRows).toBe(2)
      expect(sealed.header.referrerRows).toBe(1)
      expect(sealed.header.baseQualification).toMatchObject({
        watchScope: { includedEvents: 5 },
        mediaComponentIdCoverage: {
          inScopeEvents: 5,
          withMediaComponentIdEvents: 3,
        },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    "total_mismatch",
    "identified_mismatch",
    "referrer_exceeds",
  ] as const)(
    "refuses a stable but contradictory %s report before sealing",
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), "ga-capture-totals-"))
      try {
        await expect(
          captureGaWatchAggregates(
            captureInput(directory, gaFixtureFetch(mode)),
          ),
        ).rejects.toMatchObject({ code: "analytics_incomplete" })
        await expect(
          readFile(join(directory, "artifact.bin")),
        ).rejects.toMatchObject({
          code: "ENOENT",
        })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it("resumes committed pages after an interruption and rechecks the full pass", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-interrupted-"))
    const fetchImpl = gaFixtureFetch()
    const input = captureInput(directory, fetchImpl)
    let interrupted = false
    try {
      await expect(
        captureGaWatchAggregates({
          ...input,
          createReader: (start, end) => {
            const reader = input.createReader(start, end)
            return {
              ...reader,
              readWatchReferrerPage: async (
                page: Parameters<typeof reader.readWatchReferrerPage>[0],
              ) => {
                if (page.captureSourcePatterns && !interrupted) {
                  interrupted = true
                  throw new Error("simulated_process_interruption")
                }
                return reader.readWatchReferrerPage(page)
              },
            }
          },
        }),
      ).rejects.toThrow("simulated_process_interruption")
      const saved = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as {
        starts: { pages: unknown[] }
        referrers: { pages: unknown[] }
      }
      expect(saved.starts.pages).toHaveLength(1)
      expect(saved.referrers.pages).toHaveLength(0)
      const sealed = await captureGaWatchAggregates(input)
      expect(sealed.header.verification).toBe("two_matching_passes")
      const startCaptureCalls = fetchImpl.mock.calls.filter(([, init]) => {
        const body = JSON.parse(String(init?.body)) as {
          dimensions: { name: string }[]
          limit: string
        }
        return body.dimensions[0]?.name === "pagePath" && body.limit === "500"
      })
      expect(startCaptureCalls).toHaveLength(2)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("stops before staging a page that exceeds the cumulative byte cap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-cap-"))
    const fetchImpl = gaFixtureFetch("many_starts")
    const input = captureInput(directory, fetchImpl)
    try {
      await expect(
        captureGaWatchAggregates({
          ...input,
          createReader: (start, end) => {
            const reader = input.createReader(start, end)
            return {
              ...reader,
              readWatchStartsPage: async (
                page: Parameters<typeof reader.readWatchStartsPage>[0],
              ) => {
                if (page.offset === 500)
                  throw new Error("simulated_process_interruption")
                return reader.readWatchStartsPage(page)
              },
            }
          },
        }),
      ).rejects.toThrow("simulated_process_interruption")
      const saved = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as {
        starts: { pages: { compressedBytes: number }[] }
      }
      expect(saved.starts.pages).toHaveLength(1)
      await expect(
        captureGaWatchAggregates({
          ...input,
          maxStagedPageBytes: saved.starts.pages[0]!.compressedBytes,
        }),
      ).rejects.toMatchObject({ code: "ga_capture_staging_cap" })
      const after = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as {
        starts: { pages: unknown[] }
      }
      expect(after.starts.pages).toHaveLength(1)
      await expect(
        readFile(join(directory, "start_page-500.gz")),
      ).rejects.toMatchObject({ code: "ENOENT" })
      await expect(
        readFile(join(directory, "artifact.bin")),
      ).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
