import type { ExportReportSignal } from "../../components/ExportReportHost"
import type { ExportOutcome } from "../exportSession"
import type { RawExportInput, RawExportResult } from "../rawExportAdapter"
import type { SeriesEpisodeResolution } from "../seriesDownloadResolver"
import {
  buildSeriesExportRun,
  runSeriesRawExport,
  type SeriesExportRun,
  type SeriesExportRunDeps,
} from "../rawExportRun"

const SERIES_SLUG = "washi-gospel"
const SERIES_TITLE = "Washi Gospel"
const RUN_ID = "washi-gospel:1700000000000"

/**
 * Every gate the run reads is set on its own line, so a fixture that flips ONE
 * of them cannot fail several at once and pass a test for the wrong reason.
 */
function resolvedEpisode(
  index: number,
  overrides: Partial<SeriesEpisodeResolution> = {},
): SeriesEpisodeResolution {
  return {
    slug: `ep-${index}`,
    title: `Episode ${index}`,
    posterUrl: null,
    status: "resolved",
    rendition: {
      documentId: `rend-${index}`,
      quality: "High",
      size: String(1_000 * index),
      url: `https://cdn.example/ep-${index}.mp4`,
    },
    seriesEpisodeIndex: index,
    ...overrides,
  }
}

function episodes(count: number): SeriesEpisodeResolution[] {
  return Array.from({ length: count }, (_, i) => resolvedEpisode(i + 1))
}

function buildRun(
  resolved: readonly SeriesEpisodeResolution[],
  overrides: Partial<Parameters<typeof buildSeriesExportRun>[0]> = {},
): SeriesExportRun {
  return buildSeriesExportRun({
    runId: RUN_ID,
    seriesSlug: SERIES_SLUG,
    seriesTitle: SERIES_TITLE,
    wifiOnly: false,
    episodes: resolved,
    ...overrides,
  })
}

type EpisodePlan =
  | { kind: "saved"; reused?: boolean }
  | { kind: "outcome"; outcome: ExportOutcome }
  | { kind: "deferred" }
  | { kind: "already-exporting" }
  | { kind: "throws" }

type HarnessOptions = {
  plans?: Record<string, EpisodePlan>
  /** Runs while an episode stages — the window a cancel has to land in. */
  onStage?: (slug: string, actions: { cancel: () => void }) => void
}

/**
 * A stand-in for `rawExportAdapter`, mirroring the two orderings the run
 * depends on: the cancel flag is read AFTER the bytes stage and BEFORE the
 * library write, and every SETTLED outcome publishes exactly one report signal.
 */
function harness(options: HarnessOptions = {}) {
  const inputs: RawExportInput[] = []
  const libraryWrites: string[] = []
  const signals: ExportReportSignal[] = []
  const overlapped: string[] = []
  let running: string | null = null
  let cancelRequested = false

  const report = (signal: ExportReportSignal): void => {
    signals.push(signal)
  }

  const settle = (
    input: RawExportInput,
    outcome: ExportOutcome,
    reused = false,
  ): RawExportResult => {
    report({
      runId: input.runId,
      target: input.videoSlug,
      outcome,
      runSize: input.runSize,
      title: input.title,
    })
    return {
      kind: "settled",
      outcome,
      albumIntent: outcome === "saved" ? "album" : null,
      reused,
    }
  }

  const exportVideo = async (
    input: RawExportInput,
  ): Promise<RawExportResult> => {
    inputs.push(input)
    if (running !== null) overlapped.push(input.videoSlug)
    running = input.videoSlug
    try {
      const plan: EpisodePlan = options.plans?.[input.videoSlug] ?? {
        kind: "saved",
      }
      await Promise.resolve()
      options.onStage?.(input.videoSlug, {
        cancel: () => {
          cancelRequested = true
        },
      })
      if (plan.kind === "throws") {
        throw new Error(`transfer failed: ${input.videoSlug}`)
      }
      if (plan.kind === "already-exporting")
        return { kind: "already-exporting" }
      if (plan.kind === "deferred") {
        return { kind: "deferred", stagedPath: `staged/${input.videoSlug}.mp4` }
      }
      if (cancelRequested) return settle(input, "cancelled")
      if (plan.kind === "outcome") return settle(input, plan.outcome)
      libraryWrites.push(input.videoSlug)
      return settle(input, "saved", plan.reused === true)
    } finally {
      running = null
    }
  }

  const deps: SeriesExportRunDeps = {
    exportVideo,
    isCancelRequested: () => cancelRequested,
    report,
  }

  return {
    deps,
    inputs,
    libraryWrites,
    signals,
    overlapped,
    cancel: () => {
      cancelRequested = true
    },
  }
}

describe("buildSeriesExportRun", () => {
  it("covers every episode the sheet resolved, in episode order (R19, R20)", () => {
    const shuffled = [
      resolvedEpisode(3),
      resolvedEpisode(1),
      resolvedEpisode(2),
    ]

    const run = buildRun(shuffled)

    expect(run.episodes.map((episode) => episode.videoSlug)).toEqual([
      "ep-1",
      "ep-2",
      "ep-3",
    ])
  })

  it("keeps the given order when the set carries no episode index", () => {
    const unindexed = [
      resolvedEpisode(3, { seriesEpisodeIndex: undefined }),
      resolvedEpisode(1, { seriesEpisodeIndex: undefined }),
    ]

    const run = buildRun(unindexed)

    expect(run.episodes.map((episode) => episode.videoSlug)).toEqual([
      "ep-3",
      "ep-1",
    ])
  })

  it("carries each episode's OWN rendition, so reuse is decided per episode", () => {
    const run = buildRun(episodes(3))

    expect(run.episodes.map((episode) => episode.rendition.documentId)).toEqual(
      ["rend-1", "rend-2", "rend-3"],
    )
    expect(run.episodes[1].rendition.sizeBytes).toBe(2_000)
  })

  it("reads an unknown rendition size as null, never as zero bytes", () => {
    const unsized = buildRun([
      resolvedEpisode(1, {
        rendition: {
          documentId: "rend-1",
          quality: "High",
          size: "",
          url: "https://cdn.example/ep-1.mp4",
        },
      }),
    ])

    expect(unsized.episodes[0].rendition.sizeBytes).toBeNull()
    expect(unsized.runExports).toEqual([{ sizeBytes: null }])
  })

  it("drops an episode carrying no rendition rather than exporting a blank url", () => {
    const run = buildRun([resolvedEpisode(1, { rendition: undefined })])

    expect(run.episodes).toEqual([])
    expect(run.runExports).toEqual([])
  })

  it("sizes the run ONCE, counting a reused episode the same as a transfer", () => {
    // R8/KTD9: peak use is every library copy plus ONE staged file, so an
    // episode that duplicates a local copy still occupies the same bytes.
    const run = buildRun(episodes(3))

    expect(run.runExports).toEqual([
      { sizeBytes: 1_000 },
      { sizeBytes: 2_000 },
      { sizeBytes: 3_000 },
    ])
  })
})

describe("runSeriesRawExport", () => {
  it("reports ten saved and two failed against the resolved set (AE8, R21)", async () => {
    const set = episodes(12)
    const run = buildRun(set)
    const h = harness({
      plans: {
        "ep-4": { kind: "throws" },
        "ep-9": { kind: "outcome", outcome: "failed" },
      },
    })

    const summary = await runSeriesRawExport(run, h.deps)

    // The denominator is read from the run, not written into the assertion.
    expect(summary.total).toBe(set.length)
    expect(summary.saved).toBe(10)
    expect(summary.failed).toBe(2)
    expect(summary.saved + summary.failed).toBe(summary.total)
    expect(summary.cancelled).toBe(false)
  })

  it("emits NO skipped count, and one report signal per episode (R21)", async () => {
    const run = buildRun(episodes(12))
    const h = harness({
      plans: { "ep-2": { kind: "outcome", outcome: "blocked" } },
    })

    const summary = await runSeriesRawExport(run, h.deps)

    expect("skipped" in summary).toBe(false)
    expect(Object.keys(summary)).not.toContain("skipped")
    expect(summary.saved + summary.failed).toBe(summary.total)
    // The host COUNTS signals against runSize, so an episode that publishes
    // nothing reads as never saved.
    expect(h.signals).toHaveLength(summary.total)
    expect(new Set(h.signals.map((signal) => signal.target)).size).toBe(
      summary.total,
    )
    for (const signal of h.signals) {
      expect(signal.runId).toBe(RUN_ID)
      expect(signal.runSize).toBe(summary.total)
    }
  })

  it("saves one at a time, in episode order (R20)", async () => {
    const run = buildRun(episodes(5))
    const h = harness()

    await runSeriesRawExport(run, h.deps)

    expect(h.libraryWrites).toEqual(["ep-1", "ep-2", "ep-3", "ep-4", "ep-5"])
    expect(h.inputs.map((input) => input.videoSlug)).toEqual(h.libraryWrites)
    expect(h.overlapped).toEqual([])
  })

  it("derives the run's sizing ONCE and charges each episode the REMAINDER", async () => {
    const run = buildRun(episodes(4))
    const h = harness()

    await runSeriesRawExport(run, h.deps)

    // Derived once: the run still holds the whole set, and no episode
    // re-measures anything.
    expect(run.runExports).toHaveLength(4)

    // Charged as a suffix. The adapter re-reads FREE SPACE per episode, and by
    // episode 3 that space has already dropped by the two library copies
    // episodes 1 and 2 wrote. Handing it the whole run again would demand room
    // for copies the device is already holding, so a run that fits at the start
    // would be refused midway through.
    expect(h.inputs.map((input) => input.runExports)).toEqual([
      run.runExports.slice(0),
      run.runExports.slice(1),
      run.runExports.slice(2),
      run.runExports.slice(3),
    ])
  })

  it("never charges an episode MORE than the one before it", async () => {
    // The property the suffix exists for, asserted independently of how it is
    // sliced: the budget may only shrink, because free space only shrinks.
    const run = buildRun(episodes(5))
    const h = harness()

    await runSeriesRawExport(run, h.deps)

    const demands = h.inputs.map((input) => (input.runExports ?? []).length)
    expect(demands).toHaveLength(5)
    for (let i = 1; i < demands.length; i++) {
      expect(demands[i]).toBeLessThan(demands[i - 1])
    }
  })

  it("stops the in-flight episode before its library write, and starts no more (AE9, R22)", async () => {
    const run = buildRun(episodes(6))
    const h = harness({
      onStage: (slug, actions) => {
        if (slug === "ep-3") actions.cancel()
      },
    })
    // Only the OUTCOME may stop this run: the pre-start check stays false, so
    // the assertion cannot pass through the other mechanism.
    const summary = await runSeriesRawExport(run, {
      ...h.deps,
      isCancelRequested: () => false,
    })

    expect(h.libraryWrites).toEqual(["ep-1", "ep-2"])
    expect(h.inputs.map((input) => input.videoSlug)).toEqual([
      "ep-1",
      "ep-2",
      "ep-3",
    ])
    expect(summary.cancelled).toBe(true)
    expect(summary.saved).toBe(2)
  })

  it("reports a cancelled run as cancelled, never as failed (R22)", async () => {
    const run = buildRun(episodes(6))
    const h = harness({
      onStage: (slug, actions) => {
        if (slug === "ep-2") actions.cancel()
      },
    })

    const summary = await runSeriesRawExport(run, h.deps)

    expect(summary.cancelled).toBe(true)
    expect(summary.failed).toBe(0)
    expect(summary.saved).toBe(1)
    expect(h.signals.map((signal) => signal.outcome)).toEqual([
      "saved",
      "cancelled",
    ])
  })

  it("starts no further episode once the caller's cancel check is set (R22)", async () => {
    const run = buildRun(episodes(4))
    const h = harness({
      onStage: (slug, actions) => {
        if (slug === "ep-1") actions.cancel()
      },
    })
    const deps: SeriesExportRunDeps = {
      ...h.deps,
      exportVideo: async (input) => {
        const result = await h.deps.exportVideo(input)
        // Force the in-flight episode to a SAVED outcome, so only the
        // pre-start check can stop this run.
        return result.kind === "settled"
          ? { ...result, outcome: "saved" as const }
          : result
      },
    }

    const summary = await runSeriesRawExport(run, deps)

    expect(h.inputs.map((input) => input.videoSlug)).toEqual(["ep-1"])
    expect(summary.cancelled).toBe(true)
    expect(summary.saved).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it("passes over a failing episode; the rest still attempt (R31)", async () => {
    const run = buildRun(episodes(5))
    const h = harness({ plans: { "ep-2": { kind: "throws" } } })

    const summary = await runSeriesRawExport(run, h.deps)

    expect(h.libraryWrites).toEqual(["ep-1", "ep-3", "ep-4", "ep-5"])
    expect(summary.saved).toBe(4)
    expect(summary.failed).toBe(1)
    expect(summary.cancelled).toBe(false)
    // A thrown export reports nothing of its own, so the run reports for it.
    expect(h.signals.filter((signal) => signal.target === "ep-2")).toEqual([
      {
        runId: RUN_ID,
        target: "ep-2",
        outcome: "failed",
        runSize: 5,
        title: "Episode 2",
      },
    ])
  })

  it("does not fail the rest when one episode is blocked or refused (R31)", async () => {
    const run = buildRun(episodes(4))
    const h = harness({
      plans: {
        "ep-2": { kind: "outcome", outcome: "blocked" },
        "ep-3": { kind: "outcome", outcome: "refused" },
      },
    })

    const summary = await runSeriesRawExport(run, h.deps)

    expect(h.libraryWrites).toEqual(["ep-1", "ep-4"])
    expect(summary.saved).toBe(2)
    expect(summary.failed).toBe(2)
    expect(summary.saved + summary.failed).toBe(summary.total)
  })

  it("reuses exactly the episodes holding a matching offline copy (R37)", async () => {
    const run = buildRun(episodes(4))
    const h = harness({
      plans: {
        "ep-2": { kind: "saved", reused: true },
        "ep-4": { kind: "saved", reused: true },
      },
    })

    const summary = await runSeriesRawExport(run, h.deps)

    // The adapter decides reuse per call, so the run must hand each episode its
    // own rendition identity — a run-wide one would reuse the wrong file.
    expect(h.inputs.map((input) => input.rendition.documentId)).toEqual([
      "rend-1",
      "rend-2",
      "rend-3",
      "rend-4",
    ])
    expect(h.libraryWrites).toEqual(["ep-1", "ep-2", "ep-3", "ep-4"])
    expect(summary.saved).toBe(4)
    expect(summary.failed).toBe(0)
  })

  it("counts a deferred episode as saved and lets its own completion report it (KTD4, R21)", async () => {
    const run = buildRun(episodes(3))
    const h = harness({ plans: { "ep-2": { kind: "deferred" } } })

    const summary = await runSeriesRawExport(run, h.deps)

    expect(summary.deferred).toBe(1)
    expect(summary.saved).toBe(3)
    expect(summary.failed).toBe(0)
    expect(summary.saved + summary.failed).toBe(summary.total)
    // The deferred library write publishes under this same runId when it runs,
    // so a guessed signal here would be overwritten by the truth.
    expect(h.signals.filter((signal) => signal.target === "ep-2")).toEqual([])
  })

  it("counts an episode already exporting elsewhere as failed, and reports it (R27)", async () => {
    const run = buildRun(episodes(3))
    const h = harness({ plans: { "ep-3": { kind: "already-exporting" } } })

    const summary = await runSeriesRawExport(run, h.deps)

    expect(summary.saved).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.saved + summary.failed).toBe(summary.total)
    expect(h.signals).toHaveLength(3)
    expect(h.signals[2]).toMatchObject({ target: "ep-3", outcome: "failed" })
  })

  it("carries the series identity and the wifi-only choice into every episode", async () => {
    const run = buildRun(episodes(2), { wifiOnly: true })
    const h = harness()

    await runSeriesRawExport(run, h.deps)

    for (const input of h.inputs) {
      expect(input.seriesSlug).toBe(SERIES_SLUG)
      expect(input.wifiOnly).toBe(true)
      expect(input.runId).toBe(RUN_ID)
      expect(input.runSize).toBe(2)
    }
  })

  it("reports an empty resolved set without starting anything", async () => {
    const run = buildRun([])
    const h = harness()

    const summary = await runSeriesRawExport(run, h.deps)

    expect(h.inputs).toEqual([])
    expect(summary).toEqual({
      runId: RUN_ID,
      total: 0,
      saved: 0,
      failed: 0,
      deferred: 0,
      cancelled: false,
    })
  })
})
