import {
  deriveSeriesDownloadState,
  seriesDownloadLabel,
} from "../seriesDownloadAggregate"
import type {
  OfflineDownloadRecord,
  OfflineDownloadState,
} from "../offlineManifest"

const rec = (
  videoSlug: string,
  state: OfflineDownloadState,
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
  bytesWritten: 0,
  totalBytes: 0,
})

const EPISODES = ["a", "b", "c"]

describe("deriveSeriesDownloadState", () => {
  it("counts only this series' downloaded episodes (intersection)", () => {
    const state = deriveSeriesDownloadState(EPISODES, ["a", "b", "other"], [])
    expect(state).toEqual({ downloaded: 2, total: 3, inProgress: false })
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
})

describe("seriesDownloadLabel", () => {
  it("reads 'Download all' when nothing is downloaded", () => {
    expect(
      seriesDownloadLabel({ downloaded: 0, total: 3, inProgress: false }),
    ).toBe("Download all")
  })

  it("reads 'N of M downloaded' for a partial set", () => {
    expect(
      seriesDownloadLabel({ downloaded: 2, total: 3, inProgress: false }),
    ).toBe("2 of 3 downloaded")
  })

  it("reads 'All downloaded' when complete", () => {
    expect(
      seriesDownloadLabel({ downloaded: 3, total: 3, inProgress: false }),
    ).toBe("All downloaded")
  })

  it("reads the in-progress label and takes priority over partial/complete", () => {
    expect(
      seriesDownloadLabel({ downloaded: 1, total: 3, inProgress: true }),
    ).toBe("Downloading… (1 of 3)")
    expect(
      seriesDownloadLabel({ downloaded: 3, total: 3, inProgress: true }),
    ).toBe("Downloading… (3 of 3)")
  })
})
