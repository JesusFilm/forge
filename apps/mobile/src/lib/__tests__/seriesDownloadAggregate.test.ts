import {
  deriveEpisodeBadges,
  deriveSeriesDownloadState,
  seriesAllDownloaded,
  seriesDownloadLabel,
} from "../seriesDownloadAggregate"
import type {
  OfflineDownloadRecord,
  OfflineDownloadState,
} from "../offlineManifest"
import type {
  ExportSessionEntry,
  ExportSessionSnapshot,
} from "../exportSession"

const exportEntry = (target: string, progress: number): ExportSessionEntry => ({
  target,
  runId: "run-1",
  title: null,
  seriesSlug: "series",
  progress,
  cancelRequested: false,
})

/** An export session snapshot holding one entry per named target. */
const session = (
  ...targets: [target: string, progress: number][]
): ExportSessionSnapshot => {
  const byTarget: Record<string, ExportSessionEntry> = {}
  for (const [target, progress] of targets) {
    byTarget[target] = exportEntry(target, progress)
  }
  return {
    byTarget,
    activeCount: targets.length,
    targets: new Set(Object.keys(byTarget)),
  }
}

const rec = (
  videoSlug: string,
  state: OfflineDownloadState,
  bytesWritten = 0,
  totalBytes = 0,
): OfflineDownloadRecord => ({
  version: 1,
  videoSlug,
  dubDocumentId: "d",
  renditionDocumentId: "r",
  qualityLabel: "high",
  title: "",
  subtitleLanguageSlug: null,
  state,
  committedPath: null,
  pendingPath: null,
  posterPath: null,
  bytesWritten,
  totalBytes,
})

const EPISODES = ["a", "b", "c"]

describe("deriveSeriesDownloadState", () => {
  it("counts only this series' downloaded episodes (intersection)", () => {
    const state = deriveSeriesDownloadState(EPISODES, ["a", "b", "other"], [])
    expect(state).toEqual({
      downloaded: 2,
      total: 3,
      inProgress: false,
      pausedAggregate: false,
      inFlightSlugs: [],
      progress: 0,
      exporting: false,
      exportProgress: 0,
      exportingSlugs: [],
    })
  })

  it("flags in-progress for queued/downloading/paused records of this series", () => {
    for (const s of ["queued", "downloading", "paused"] as const) {
      const state = deriveSeriesDownloadState(EPISODES, [], [rec("a", s)])
      expect(state.inProgress).toBe(true)
    }
  })

  it("excludes a failed record from both the count and the in-progress flag", () => {
    const state = deriveSeriesDownloadState(EPISODES, [], [rec("a", "failed")])
    expect(state.downloaded).toBe(0)
    expect(state.inProgress).toBe(false)
  })

  it("ignores records belonging to other series", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      [],
      [rec("not-an-episode", "downloading")],
    )
    expect(state.inProgress).toBe(false)
  })

  it("reports episode-normalized byte progress (done = 1, in-flight = fraction)", () => {
    // a downloaded, b at 50%, c not started -> (1 + 0.5 + 0) / 3
    const state = deriveSeriesDownloadState(
      EPISODES,
      ["a"],
      [rec("a", "downloaded", 100, 100), rec("b", "downloading", 50, 100)],
    )
    expect(state.progress).toBeCloseTo(0.5)
    expect(state.inProgress).toBe(true)
  })

  it("progress is 1 when all downloaded and 0 when none enqueued", () => {
    const all = deriveSeriesDownloadState(
      EPISODES,
      ["a", "b", "c"],
      EPISODES.map((s) => rec(s, "downloaded", 10, 10)),
    )
    expect(all.progress).toBe(1)
    expect(deriveSeriesDownloadState(EPISODES, [], []).progress).toBe(0)
  })

  it("treats a zero-totalBytes in-flight record as 0 progress (no NaN)", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      [],
      [rec("a", "downloading", 0, 0)],
    )
    expect(state.progress).toBe(0)
    expect(Number.isNaN(state.progress)).toBe(false)
  })

  it("pausedAggregate is true only when paused and nothing else active (U8)", () => {
    const allPaused = deriveSeriesDownloadState(
      EPISODES,
      [],
      [rec("a", "paused"), rec("b", "paused")],
    )
    expect(allPaused.pausedAggregate).toBe(true)
    // paused + one still downloading → keep "Pause all", not "Resume all"
    const mixed = deriveSeriesDownloadState(
      EPISODES,
      [],
      [rec("a", "paused"), rec("b", "downloading")],
    )
    expect(mixed.pausedAggregate).toBe(false)
    // R14 steady state: the paused slot + a queued tail must flip the bar to
    // "Resume all" — queued episodes are waiting on the pump, not downloading.
    const queued = deriveSeriesDownloadState(
      EPISODES,
      [],
      [rec("a", "paused"), rec("b", "queued")],
    )
    expect(queued.pausedAggregate).toBe(true)
  })

  it("all-queued batch start is downloading, not paused (R14)", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      [],
      [rec("a", "queued"), rec("b", "queued")],
    )
    expect(state.pausedAggregate).toBe(false)
    expect(state.inProgress).toBe(true)
  })

  it("collects the series' in-flight slugs for the batch controls", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      [],
      [
        rec("a", "downloading"),
        rec("b", "paused"),
        rec("c", "downloaded", 1, 1),
      ],
    )
    expect(state.inFlightSlugs.sort()).toEqual(["a", "b"])
  })

  it("a re-download at the start reads 0 progress, not ~full (pending swaps)", () => {
    // All three episodes are still `downloaded` (old copies) but queued for a
    // swap — the ring must reset to 0, not read 3/3.
    const state = deriveSeriesDownloadState(
      EPISODES,
      ["a", "b", "c"],
      EPISODES.map((s) => rec(s, "downloaded", 10, 10)),
      new Set(["a", "b", "c"]),
    )
    expect(state.progress).toBe(0)
    expect(state.downloaded).toBe(0)
    expect(state.inProgress).toBe(true)
  })

  it("re-download progress climbs as each swap finishes", () => {
    // a re-downloaded (done, not pending), b swapping at 50%, c still pending.
    const state = deriveSeriesDownloadState(
      EPISODES,
      ["a", "c"],
      [
        rec("a", "downloaded", 10, 10),
        rec("b", "downloading", 50, 100),
        rec("c", "downloaded", 10, 10),
      ],
      new Set(["c"]),
    )
    // (1 done + 0.5 in-flight + 0 pending) / 3
    expect(state.progress).toBeCloseTo(0.5)
    expect(state.downloaded).toBe(1) // only 'a' finished its swap
    expect(state.inProgress).toBe(true)
  })

  it("a pending swap is NOT an in-flight control target (not pausable)", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      ["a"],
      [rec("a", "downloaded", 10, 10)],
      new Set(["a"]),
    )
    expect(state.inFlightSlugs).toEqual([])
    expect(state.inProgress).toBe(true)
  })
})

describe("seriesDownloadLabel", () => {
  const lbl = (downloaded: number, total: number) =>
    seriesDownloadLabel({
      downloaded,
      total,
      inProgress: false,
      pausedAggregate: false,
      inFlightSlugs: [],
      progress: 0,
      exporting: false,
      exportProgress: 0,
      exportingSlugs: [],
    })

  it("reads 'Download all' when nothing is downloaded", () => {
    expect(lbl(0, 3)).toBe("Download all")
  })

  it("reads 'N of M downloaded' for a partial set", () => {
    expect(lbl(2, 3)).toBe("2 of 3 downloaded")
  })

  it("reads 'All downloaded' when complete", () => {
    expect(lbl(3, 3)).toBe("All downloaded")
  })
})

describe("seriesAllDownloaded", () => {
  const st = (downloaded: number, total: number) => ({
    downloaded,
    total,
    inProgress: false,
    pausedAggregate: false,
    inFlightSlugs: [] as string[],
    progress: 0,
    exporting: false,
    exportProgress: 0,
    exportingSlugs: [] as string[],
  })

  it("is true only when total > 0 and every episode is downloaded", () => {
    expect(seriesAllDownloaded(st(3, 3))).toBe(true)
    expect(seriesAllDownloaded(st(2, 3))).toBe(false)
  })

  it("is false for an empty series (total 0) so it never ticks nothing", () => {
    expect(seriesAllDownloaded(st(0, 0))).toBe(false)
  })
})

describe("deriveEpisodeBadges (U9)", () => {
  it("maps each record state to a badge; failed/absent → none", () => {
    const badges = deriveEpisodeBadges(EPISODES, [
      rec("a", "downloaded", 1, 1),
      rec("b", "downloading"),
      rec("c", "failed"),
    ])
    expect(badges.get("a")).toBe("saved")
    expect(badges.get("b")).toBe("downloading")
    expect(badges.get("c")).toBe("none")
  })

  it("maps queued and paused, and returns none for a record-less episode", () => {
    const badges = deriveEpisodeBadges(
      ["q", "p", "x"],
      [rec("q", "queued"), rec("p", "paused")],
    )
    expect(badges.get("q")).toBe("queued")
    expect(badges.get("p")).toBe("paused")
    expect(badges.get("x")).toBe("none")
  })

  it("badges an exporting episode over its own offline state (R16)", () => {
    const badges = deriveEpisodeBadges(
      EPISODES,
      [rec("a", "downloaded", 1, 1), rec("b", "downloading")],
      session(["a", 0.3]).targets,
    )
    expect(badges.get("a")).toBe("exporting")
    expect(badges.get("b")).toBe("downloading")
    expect(badges.get("c")).toBe("none")
  })

  it("badges an exporting episode that has no offline record at all", () => {
    const badges = deriveEpisodeBadges(EPISODES, [], session(["c", 0]).targets)
    expect(badges.get("c")).toBe("exporting")
  })

  it("ignores an export of a video outside this series", () => {
    const badges = deriveEpisodeBadges(
      EPISODES,
      [],
      session(["elsewhere", 0.5]).targets,
    )
    expect([...badges.values()]).toEqual(["none", "none", "none"])
  })
})

describe("deriveSeriesDownloadState with a raw export (R16, R24, R30)", () => {
  it("reports no export when no session is passed", () => {
    const state = deriveSeriesDownloadState(EPISODES, [], [])
    expect(state.exporting).toBe(false)
    expect(state.exportProgress).toBe(0)
    expect(state.exportingSlugs).toEqual([])
  })

  it("flags the export and names the episodes the cancel acts on", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      [],
      [],
      undefined,
      session(["b", 0.5]),
    )
    expect(state.exporting).toBe(true)
    expect(state.exportingSlugs).toEqual(["b"])
    expect(state.exportProgress).toBeCloseTo(0.5)
  })

  it("averages the in-flight episodes' progress for the ring", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      [],
      [],
      undefined,
      session(["a", 0.25], ["b", 0.75]),
    )
    expect(state.exportProgress).toBeCloseTo(0.5)
  })

  it("ignores an export of a video outside this series", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      [],
      [],
      undefined,
      session(["elsewhere", 0.5]),
    )
    expect(state.exporting).toBe(false)
    expect(state.exportingSlugs).toEqual([])
  })

  it("clamps an out-of-range progress and never yields NaN", () => {
    const high = deriveSeriesDownloadState(
      EPISODES,
      [],
      [],
      undefined,
      session(["a", 4]),
    )
    expect(high.exportProgress).toBe(1)
    const low = deriveSeriesDownloadState(
      EPISODES,
      [],
      [],
      undefined,
      session(["a", -1]),
    )
    expect(low.exportProgress).toBe(0)
    const broken = deriveSeriesDownloadState(
      EPISODES,
      [],
      [],
      undefined,
      session(["a", Number.NaN]),
    )
    expect(Number.isNaN(broken.exportProgress)).toBe(false)
  })

  it("leaves the offline aggregate untouched — an export pauses nothing", () => {
    const state = deriveSeriesDownloadState(
      EPISODES,
      ["c"],
      [rec("a", "paused"), rec("c", "downloaded", 10, 10)],
      undefined,
      session(["a", 0.5]),
    )
    expect(state.exporting).toBe(true)
    expect(state.pausedAggregate).toBe(true)
    expect(state.inProgress).toBe(true)
    expect(state.downloaded).toBe(1)
    expect(state.inFlightSlugs).toEqual(["a"])
  })
})
