import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { captureGaWatchAggregates } from "./ga-watch-capture"
import { createGaWatchHistoryReader } from "./ga-watch-history"
import { HistoricalAnalyticsError } from "./historical-analytics"

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

  it("resumes a late second-read interruption from the next matched page", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-verify-resume-"))
    const base = captureInput(directory, gaFixtureFetch())
    const startOffsets: number[] = []
    let interrupt = true
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage !== "snapshot_page") return reader
        return {
          ...reader,
          async readWatchStartsPage(page: { offset: number; limit: number }) {
            startOffsets.push(page.offset)
            if (
              interrupt &&
              page.offset === 1_000 &&
              startOffsets.filter((offset) => offset === 1_000).length === 2
            )
              throw new HistoricalAnalyticsError("analytics_unavailable")
            const rows = Array.from(
              { length: Math.min(page.limit, 1_001 - page.offset) },
              (_, index) => {
                const identity = page.offset + index
                return {
                  pagePath: `/watch/target-${identity}.html/english.html`,
                  mediaComponentId: "media",
                  starts: identity === 0 ? 3 : 0,
                  rowIdentityDigest: identity.toString(16).padStart(64, "0"),
                }
              },
            )
            return {
              provider: "ga_data_api" as const,
              status: "unqualified" as const,
              propertyId: "320198532",
              rangeStart,
              rangeEnd,
              rows,
              rowCount: 1_001,
              nextOffset:
                page.offset + rows.length < 1_001
                  ? page.offset + rows.length
                  : null,
              requestCount: 1,
              propertyTimeZone: "America/New_York",
              reportLimitations: [],
              sourceAvailableAfter: null,
              truncatedDateRanges: [],
              truncationTypes: [],
              canonicalMapping: "unverified" as const,
              orderedTransitions: "unavailable" as const,
              botFiltering: "unknown" as const,
              snapshotConsistency: "not_frozen" as const,
            }
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_unavailable",
      })
      const interrupted = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as { verification?: { startsVerifiedPages: number } }
      expect(interrupted.verification?.startsVerifiedPages).toBe(2)
      expect(startOffsets).toEqual([0, 500, 1_000, 0, 500, 1_000])

      interrupt = false
      startOffsets.length = 0
      const sealed = await captureGaWatchAggregates(input)
      expect(startOffsets).toEqual([1_000])
      expect(sealed.header).toMatchObject({
        verification: "two_matching_passes",
        startPages: 3,
        referrerPages: 1,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("repeats the whole second pass after a matching prefix meets postflight drift", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ga-capture-postflight-drift-"),
    )
    const base = captureInput(directory, gaFixtureFetch())
    let requestedQualifications = 0
    let driftPostflight = true
    const pageReads: string[] = []
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage === "qualification") {
          if (rangeStart === base.binding.requestedStart)
            requestedQualifications += 1
          if (driftPostflight && requestedQualifications === 2)
            return {
              ...reader,
              inspectCoverage: async () => ({
                ...(await reader.inspectCoverage()),
                resultDigest: "f".repeat(64),
              }),
            }
          return reader
        }
        return {
          ...reader,
          readWatchStartsPage: async (
            page: Parameters<typeof reader.readWatchStartsPage>[0],
          ) => {
            pageReads.push(`start:${page.offset}`)
            return reader.readWatchStartsPage(page)
          },
          readWatchReferrerPage: async (
            page: Parameters<typeof reader.readWatchReferrerPage>[0],
          ) => {
            pageReads.push(`referrer:${page.offset}`)
            return reader.readWatchReferrerPage(page)
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_incomplete",
      })
      const interrupted = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as {
        verification?: {
          startsVerifiedPages: number
          referrersVerifiedPages: number
          state: string
        }
      }
      expect(interrupted.verification).toMatchObject({
        startsVerifiedPages: 1,
        referrersVerifiedPages: 1,
        state: "postflight",
      })
      driftPostflight = false
      pageReads.length = 0
      const sealed = await captureGaWatchAggregates(input)
      expect(pageReads).toEqual(["start:0", "referrer:0"])
      expect(sealed.header.verification).toBe("two_matching_passes")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("rejects corrupt checkpoint prefixes and starts a legacy journal at zero", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-checkpoint-"))
    const base = captureInput(directory, gaFixtureFetch())
    let referrerReads = 0
    let startReads = 0
    let interrupt = true
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage !== "snapshot_page") return reader
        return {
          ...reader,
          readWatchStartsPage: async (
            page: Parameters<typeof reader.readWatchStartsPage>[0],
          ) => {
            startReads += 1
            return reader.readWatchStartsPage(page)
          },
          readWatchReferrerPage: async (
            page: Parameters<typeof reader.readWatchReferrerPage>[0],
          ) => {
            referrerReads += 1
            if (interrupt && referrerReads === 2)
              throw new HistoricalAnalyticsError("analytics_unavailable")
            return reader.readWatchReferrerPage(page)
          },
        }
      },
    }
    const journalPath = join(directory, "journal.json")
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_unavailable",
      })
      const original = JSON.parse(await readFile(journalPath, "utf8")) as {
        bindingDigest: string
        starts: { pages: { rawSha256: string }[] }
        verification?: {
          bindingDigest: string
          savedPagesDigest: string
          startsVerifiedPages: number
        }
      }
      expect(original.verification?.startsVerifiedPages).toBe(1)
      for (const mutate of [
        (journal: typeof original) => {
          journal.verification!.bindingDigest = "0".repeat(64)
        },
        (journal: typeof original) => {
          journal.verification!.savedPagesDigest = "0".repeat(64)
        },
        (journal: typeof original) => {
          journal.verification!.startsVerifiedPages = 2
        },
        (journal: typeof original) => {
          journal.starts.pages[0]!.rawSha256 = "0".repeat(64)
        },
      ]) {
        const damaged = structuredClone(original)
        mutate(damaged)
        await writeFile(journalPath, JSON.stringify(damaged))
        await expect(
          captureGaWatchAggregates({
            ...input,
            createReader: () => {
              throw new Error("provider_called_before_checkpoint_rejection")
            },
          }),
        ).rejects.toMatchObject({ code: "analytics_incomplete" })
      }

      const legacy = structuredClone(original)
      delete legacy.verification
      await writeFile(journalPath, JSON.stringify(legacy))
      interrupt = false
      referrerReads = 0
      startReads = 0
      const sealed = await captureGaWatchAggregates(input)
      expect([startReads, referrerReads]).toEqual([1, 1])
      expect(sealed.header.verification).toBe("two_matching_passes")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("invalidates a matching prefix after an observed second-read page drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-page-drift-"))
    const base = captureInput(directory, gaFixtureFetch())
    let startReads = 0
    let referrerReads = 0
    let drift = true
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage !== "snapshot_page") return reader
        return {
          ...reader,
          readWatchStartsPage: async (
            page: Parameters<typeof reader.readWatchStartsPage>[0],
          ) => {
            startReads += 1
            return reader.readWatchStartsPage(page)
          },
          readWatchReferrerPage: async (
            page: Parameters<typeof reader.readWatchReferrerPage>[0],
          ) => {
            referrerReads += 1
            const result = await reader.readWatchReferrerPage(page)
            if (drift && referrerReads === 2)
              return {
                ...result,
                rows: result.rows.map((row) => ({ ...row, starts: 4 })),
              }
            return result
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_incomplete",
      })
      const interrupted = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as { verification?: { state: string; startsVerifiedPages: number } }
      expect(interrupted.verification).toMatchObject({
        state: "reading",
        startsVerifiedPages: 1,
      })
      drift = false
      startReads = 0
      referrerReads = 0
      const sealed = await captureGaWatchAggregates(input)
      expect(startReads).toBe(1)
      expect(referrerReads).toBe(1)
      expect(sealed.header.verification).toBe("two_matching_passes")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("rejects a duplicate identity crossing the resumed verification boundary", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ga-capture-resume-duplicate-"),
    )
    const base = captureInput(directory, gaFixtureFetch())
    const offsets: number[] = []
    let interrupt = true
    let duplicate = false
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage !== "snapshot_page") return reader
        return {
          ...reader,
          async readWatchStartsPage(page: { offset: number; limit: number }) {
            offsets.push(page.offset)
            if (
              interrupt &&
              page.offset === 500 &&
              offsets.filter((offset) => offset === 500).length === 2
            )
              throw new HistoricalAnalyticsError("analytics_unavailable")
            const rows = Array.from(
              { length: Math.min(page.limit, 501 - page.offset) },
              (_, index) => {
                const identity = page.offset + index
                return {
                  pagePath: `/watch/target-${identity}.html/english.html`,
                  mediaComponentId: "media",
                  starts: identity === 0 ? 3 : 0,
                  rowIdentityDigest:
                    duplicate && identity === 500
                      ? "0".repeat(64)
                      : identity.toString(16).padStart(64, "0"),
                }
              },
            )
            return {
              provider: "ga_data_api" as const,
              status: "unqualified" as const,
              propertyId: "320198532",
              rangeStart,
              rangeEnd,
              rows,
              rowCount: 501,
              nextOffset:
                page.offset + rows.length < 501
                  ? page.offset + rows.length
                  : null,
              requestCount: 1,
              propertyTimeZone: "America/New_York",
              reportLimitations: [],
              sourceAvailableAfter: null,
              truncatedDateRanges: [],
              truncationTypes: [],
              canonicalMapping: "unverified" as const,
              orderedTransitions: "unavailable" as const,
              botFiltering: "unknown" as const,
              snapshotConsistency: "not_frozen" as const,
            }
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_unavailable",
      })
      interrupt = false
      duplicate = true
      offsets.length = 0
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_incomplete",
      })
      expect(offsets).toEqual([500])
      const interrupted = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as { verification?: { state: string } }
      expect(interrupted.verification?.state).toBe("reading")
      duplicate = false
      offsets.length = 0
      const sealed = await captureGaWatchAggregates(input)
      expect(offsets).toEqual([0, 500])
      expect(sealed.header.verification).toBe("two_matching_passes")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("does not seal when a matched page checkpoint cannot be persisted", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ga-capture-checkpoint-write-"),
    )
    const journalPath = join(directory, "journal.json")
    const backupPath = join(directory, "journal.backup")
    const base = captureInput(directory, gaFixtureFetch())
    let blockCheckpoint = true
    let referrerReads = 0
    let startReads = 0
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage !== "snapshot_page") return reader
        return {
          ...reader,
          readWatchStartsPage: async (
            page: Parameters<typeof reader.readWatchStartsPage>[0],
          ) => {
            startReads += 1
            return reader.readWatchStartsPage(page)
          },
          readWatchReferrerPage: async (
            page: Parameters<typeof reader.readWatchReferrerPage>[0],
          ) => {
            referrerReads += 1
            const result = await reader.readWatchReferrerPage(page)
            if (blockCheckpoint && referrerReads === 2) {
              await rename(journalPath, backupPath)
              await mkdir(journalPath)
              blockCheckpoint = false
            }
            return result
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toThrow()
      await expect(
        readFile(join(directory, "artifact.bin")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      })
      await rm(journalPath, { recursive: true })
      await rename(backupPath, journalPath)
      const checkpoint = JSON.parse(await readFile(journalPath, "utf8")) as {
        verification?: { startsVerifiedPages: number; state: string }
      }
      expect(checkpoint.verification).toMatchObject({
        startsVerifiedPages: 1,
        state: "reading",
      })
      startReads = 0
      referrerReads = 0
      const sealed = await captureGaWatchAggregates(input)
      expect([startReads, referrerReads]).toEqual([1, 1])
      expect(sealed.header.verification).toBe("two_matching_passes")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("replays a verified prefix after an unclassified interrupted read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-unknown-read-"))
    const base = captureInput(directory, gaFixtureFetch())
    const reads: string[] = []
    let referrerReads = 0
    let interrupt = true
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage !== "snapshot_page") return reader
        return {
          ...reader,
          readWatchStartsPage: async (
            page: Parameters<typeof reader.readWatchStartsPage>[0],
          ) => {
            reads.push(`start:${page.offset}`)
            return reader.readWatchStartsPage(page)
          },
          readWatchReferrerPage: async (
            page: Parameters<typeof reader.readWatchReferrerPage>[0],
          ) => {
            reads.push(`referrer:${page.offset}`)
            referrerReads += 1
            if (interrupt && referrerReads === 2)
              throw new Error("reader_interrupted")
            return reader.readWatchReferrerPage(page)
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toThrow(
        "reader_interrupted",
      )
      const journal = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as {
        verification?: {
          startsVerifiedPages: number
          referrersVerifiedPages: number
          state: string
        }
      }
      expect(journal.verification).toMatchObject({
        startsVerifiedPages: 1,
        referrersVerifiedPages: 0,
        state: "reading",
      })

      interrupt = false
      reads.length = 0
      const sealed = await captureGaWatchAggregates(input)
      expect(reads).toEqual(["start:0", "referrer:0"])
      expect(sealed.header.verification).toBe("two_matching_passes")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("restarts verification after fresh continuation qualification drifts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-fresh-drift-"))
    const base = captureInput(directory, gaFixtureFetch())
    let requestedQualifications = 0
    let driftFresh = false
    let interrupt = true
    let startReads = 0
    let referrerReads = 0
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage === "qualification") {
          if (rangeStart === base.binding.requestedStart)
            requestedQualifications += 1
          if (driftFresh && requestedQualifications === 2)
            return {
              ...reader,
              inspectCoverage: async () => ({
                ...(await reader.inspectCoverage()),
                resultDigest: "f".repeat(64),
              }),
            }
          return reader
        }
        return {
          ...reader,
          readWatchStartsPage: async (
            page: Parameters<typeof reader.readWatchStartsPage>[0],
          ) => {
            startReads += 1
            return reader.readWatchStartsPage(page)
          },
          readWatchReferrerPage: async (
            page: Parameters<typeof reader.readWatchReferrerPage>[0],
          ) => {
            referrerReads += 1
            if (interrupt && referrerReads === 2)
              throw new HistoricalAnalyticsError("analytics_unavailable")
            return reader.readWatchReferrerPage(page)
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_unavailable",
      })
      interrupt = false
      driftFresh = true
      const readsBeforeDrift = [startReads, referrerReads]
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_incomplete",
      })
      expect([startReads, referrerReads]).toEqual(readsBeforeDrift)
      const journal = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as { verification?: { state: string } }
      expect(journal.verification?.state).toBe("qualification")

      driftFresh = false
      startReads = 0
      referrerReads = 0
      const sealed = await captureGaWatchAggregates(input)
      expect([startReads, referrerReads]).toEqual([1, 1])
      expect(sealed.header.verification).toBe("two_matching_passes")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("resumes after 107 committed start pages and rejects saved-page corruption or verification drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-deep-resume-"))
    const fetchImpl = gaFixtureFetch()
    const base = captureInput(directory, fetchImpl)
    const startOffsets: number[] = []
    let interruptAtNextPage = true
    let driftOnVerification = false
    const input = {
      ...base,
      createReader: (
        rangeStart: string,
        rangeEnd: string,
        stage: "qualification" | "snapshot_page",
      ) => {
        const reader = base.createReader(rangeStart, rangeEnd)
        if (stage !== "snapshot_page") return reader
        return {
          ...reader,
          async readWatchStartsPage(page: { offset: number; limit: number }) {
            startOffsets.push(page.offset)
            if (interruptAtNextPage && page.offset === 53_500) {
              interruptAtNextPage = false
              throw new Error("simulated_start_page_interruption")
            }
            const rows = Array.from(
              { length: Math.min(page.limit, 53_501 - page.offset) },
              (_, index) => {
                const identity = page.offset + index
                return {
                  pagePath: `/watch/target-${identity}.html/english.html`,
                  mediaComponentId: "media",
                  starts: identity === 0 ? (driftOnVerification ? 4 : 3) : 0,
                  rowIdentityDigest: identity.toString(16).padStart(64, "0"),
                }
              },
            )
            return {
              provider: "ga_data_api" as const,
              status: "unqualified" as const,
              propertyId: "320198532",
              rangeStart,
              rangeEnd,
              rows,
              rowCount: 53_501,
              nextOffset:
                page.offset + rows.length < 53_501
                  ? page.offset + rows.length
                  : null,
              requestCount: 1,
              propertyTimeZone: "America/New_York",
              reportLimitations: [],
              sourceAvailableAfter: null,
              truncatedDateRanges: [],
              truncationTypes: [],
              canonicalMapping: "unverified" as const,
              orderedTransitions: "unavailable" as const,
              botFiltering: "unknown" as const,
              snapshotConsistency: "not_frozen" as const,
            }
          },
        }
      },
    }
    try {
      await expect(captureGaWatchAggregates(input)).rejects.toThrow(
        "simulated_start_page_interruption",
      )
      const journal = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as {
        starts: {
          expectedTotal: number
          complete: boolean
          pages: { path: string; pageOffset: number }[]
        }
      }
      expect(journal.starts.expectedTotal).toBe(53_501)
      expect(journal.starts.complete).toBe(false)
      expect(journal.starts.pages).toHaveLength(107)
      expect(journal.starts.pages.at(-1)?.pageOffset).toBe(53_000)

      const savedPath = journal.starts.pages[0]!.path
      const savedBytes = await readFile(savedPath)
      await writeFile(savedPath, "corrupt")
      const beforeCorruptResume = startOffsets.length
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "ga_capture_corrupt_block",
      })
      expect(startOffsets).toHaveLength(beforeCorruptResume)
      await writeFile(savedPath, savedBytes)

      const beforeDriftResume = startOffsets.length
      driftOnVerification = true
      await expect(captureGaWatchAggregates(input)).rejects.toMatchObject({
        code: "analytics_incomplete",
      })
      expect(startOffsets.slice(beforeDriftResume)).toEqual([53_500, 0])
      await expect(
        readFile(join(directory, "artifact.bin")),
      ).rejects.toMatchObject({ code: "ENOENT" })

      driftOnVerification = false
      const beforeSuccessfulResume = startOffsets.length
      const sealed = await captureGaWatchAggregates(input)
      expect(sealed.header.verification).toBe("two_matching_passes")
      expect(startOffsets.slice(beforeSuccessfulResume)).toEqual(
        Array.from({ length: 108 }, (_, index) => index * 500),
      )
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
