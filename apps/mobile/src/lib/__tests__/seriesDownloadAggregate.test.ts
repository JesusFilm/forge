import {
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
})

describe("seriesDownloadLabel", () => {
  const lbl = (downloaded: number, total: number, inProgress: boolean) =>
    seriesDownloadLabel({ downloaded, total, inProgress, progress: 0 })

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
})

describe("seriesAllDownloaded", () => {
  const st = (downloaded: number, total: number) => ({
    downloaded,
    total,
    inProgress: false,
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
