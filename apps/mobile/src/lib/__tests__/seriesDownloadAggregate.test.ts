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
    // a queued episode counts as active, not paused
    const queued = deriveSeriesDownloadState(
      EPISODES,
      [],
      [rec("a", "paused"), rec("b", "queued")],
    )
    expect(queued.pausedAggregate).toBe(false)
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
})

describe("seriesDownloadLabel", () => {
  const lbl = (
    downloaded: number,
    total: number,
    inProgress: boolean,
    pausedAggregate = false,
  ) =>
    seriesDownloadLabel({
      downloaded,
      total,
      inProgress,
      pausedAggregate,
      inFlightSlugs: [],
      progress: 0,
    })

  it("reads 'Download all' when nothing is downloaded", () => {
    expect(lbl(0, 3, false)).toBe("Download all")
  })

  it("reads 'N of M downloaded' for a partial set", () => {
    expect(lbl(2, 3, false)).toBe("2 of 3 downloaded")
  })

  it("reads 'All downloaded' when complete", () => {
    expect(lbl(3, 3, false)).toBe("All downloaded")
  })

  it("reads the in-progress label and takes priority over partial/complete", () => {
    expect(lbl(1, 3, true)).toBe("Downloading… (1 of 3)")
    expect(lbl(3, 3, true)).toBe("Downloading… (3 of 3)")
  })

  it("reads the paused label before the in-progress label (U8)", () => {
    expect(lbl(1, 3, true, true)).toBe("Paused (1 of 3)")
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
})
