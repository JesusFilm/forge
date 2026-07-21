import {
  buildLibraryViewModel,
  formatLibraryBytes,
  formatLibraryDuration,
  libraryRowState,
  storageSummary,
} from "../libraryDownloads"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
} from "../offlineManifest"

function record(
  videoSlug: string,
  state: OfflineDownloadState,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug,
    dubDocumentId: "dub",
    renditionDocumentId: "rend",
    qualityLabel: "High",
    title: "Test",
    subtitleLanguageSlug: null,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 0,
    ...overrides,
  }
}

const MB = 1024 * 1024

describe("buildLibraryViewModel — grouping", () => {
  it("groups records that share a seriesSlug into one series card", () => {
    const a = record("ep-a", "downloaded", {
      seriesSlug: "s1",
      seriesTitle: "Series One",
    })
    const b = record("ep-b", "downloaded", {
      seriesSlug: "s1",
      seriesTitle: "Series One",
    })
    const model = buildLibraryViewModel([a, b])
    expect(model.seriesGroups).toHaveLength(1)
    expect(model.seriesGroups[0].seriesSlug).toBe("s1")
    expect(model.seriesGroups[0].seriesTitle).toBe("Series One")
    expect(model.seriesGroups[0].episodeCount).toBe(2)
    expect(model.standaloneRecords).toHaveLength(0)
  })

  it("lands legacy records (no seriesSlug) as standalone", () => {
    const v = record("solo", "downloaded")
    const model = buildLibraryViewModel([v])
    expect(model.standaloneRecords).toEqual([v])
    expect(model.seriesGroups).toHaveLength(0)
  })

  it("has no group at all once every one of its episodes is gone", () => {
    const a = record("ep-a", "downloaded", { seriesSlug: "s1" })
    expect(buildLibraryViewModel([a]).seriesGroups).toHaveLength(1)
    expect(buildLibraryViewModel([]).seriesGroups).toHaveLength(0)
  })

  it("counts failed episodes and sums combined bytes per group", () => {
    const done = record("ep-a", "downloaded", {
      seriesSlug: "s1",
      totalBytes: 100,
    })
    const inFlight = record("ep-b", "downloading", {
      seriesSlug: "s1",
      bytesWritten: 30,
      totalBytes: 200,
    })
    const failed = record("ep-c", "failed", {
      seriesSlug: "s1",
      totalBytes: 999,
    })
    const model = buildLibraryViewModel([done, inFlight, failed])
    expect(model.seriesGroups[0].combinedBytes).toBe(130)
    expect(model.seriesGroups[0].failedEpisodeCount).toBe(1)
  })
})

describe("buildLibraryViewModel — ordering", () => {
  it("orders episodes within a card by seriesEpisodeIndex", () => {
    const ep2 = record("ep2", "downloaded", {
      seriesSlug: "s1",
      seriesEpisodeIndex: 2,
    })
    const ep1 = record("ep1", "downloaded", {
      seriesSlug: "s1",
      seriesEpisodeIndex: 1,
    })
    const model = buildLibraryViewModel([ep2, ep1])
    expect(model.seriesGroups[0].episodes.map((e) => e.videoSlug)).toEqual([
      "ep1",
      "ep2",
    ])
  })

  it("falls back to enqueuedAt and sorts index-less episodes after indexed ones", () => {
    const indexed = record("indexed", "downloaded", {
      seriesSlug: "s1",
      seriesEpisodeIndex: 5,
      enqueuedAt: 9999,
    })
    const noIndexOld = record("noindex-old", "downloaded", {
      seriesSlug: "s1",
      enqueuedAt: 100,
    })
    const noIndexNew = record("noindex-new", "downloaded", {
      seriesSlug: "s1",
      enqueuedAt: 200,
    })
    const model = buildLibraryViewModel([noIndexNew, indexed, noIndexOld])
    expect(model.seriesGroups[0].episodes.map((e) => e.videoSlug)).toEqual([
      "indexed",
      "noindex-old",
      "noindex-new",
    ])
  })

  it("orders series cards and standalone rows newest-enqueuedAt first", () => {
    const s1 = record("s1-a", "downloaded", {
      seriesSlug: "s1",
      enqueuedAt: 100,
    })
    const s2 = record("s2-a", "downloaded", {
      seriesSlug: "s2",
      enqueuedAt: 300,
    })
    expect(
      buildLibraryViewModel([s1, s2]).seriesGroups.map((g) => g.seriesSlug),
    ).toEqual(["s2", "s1"])

    const v1 = record("v1", "downloaded", { enqueuedAt: 100 })
    const v2 = record("v2", "downloaded", { enqueuedAt: 300 })
    expect(
      buildLibraryViewModel([v1, v2]).standaloneRecords.map((r) => r.videoSlug),
    ).toEqual(["v2", "v1"])
  })

  it("uses a card's newest member as its own sort key", () => {
    const s1Old = record("s1-old", "downloaded", {
      seriesSlug: "s1",
      enqueuedAt: 100,
    })
    const s1New = record("s1-new", "downloaded", {
      seriesSlug: "s1",
      enqueuedAt: 500,
    })
    const s2 = record("s2-a", "downloaded", {
      seriesSlug: "s2",
      enqueuedAt: 300,
    })
    const model = buildLibraryViewModel([s1Old, s2, s1New])
    expect(model.seriesGroups.map((g) => g.seriesSlug)).toEqual(["s1", "s2"])
  })

  it("sorts legacy no-enqueuedAt records deterministically last", () => {
    const withTime = record("with-time", "downloaded", { enqueuedAt: 100 })
    const legacyA = record("legacy-a", "downloaded")
    const legacyB = record("legacy-b", "downloaded")
    const model = buildLibraryViewModel([legacyB, withTime, legacyA])
    expect(model.standaloneRecords.map((r) => r.videoSlug)).toEqual([
      "with-time",
      "legacy-a",
      "legacy-b",
    ])
  })
})

describe("buildLibraryViewModel — section emptiness", () => {
  it("has no series groups when there are no series records", () => {
    const model = buildLibraryViewModel([record("v", "downloaded")])
    expect(model.seriesGroups).toEqual([])
  })

  it("has no standalone records when everything belongs to a series", () => {
    const model = buildLibraryViewModel([
      record("ep", "downloaded", { seriesSlug: "s1" }),
    ])
    expect(model.standaloneRecords).toEqual([])
  })
})

describe("libraryRowState (R6)", () => {
  it("downloaded → check, '<size> · Downloaded'", () => {
    const r = record("a", "downloaded", { totalBytes: 74 * MB })
    expect(libraryRowState(r, false)).toEqual({
      subtitle: "74 MB · Downloaded",
      affordance: "check",
    })
  })

  it("downloaded + pendingSwap reads identically (old copy is the truth)", () => {
    const r = record("a", "downloaded", { totalBytes: 74 * MB })
    expect(libraryRowState(r, true)).toEqual(libraryRowState(r, false))
  })

  it("downloading → ring with '<pct>% · <size>' and 0..1 progress", () => {
    const r = record("a", "downloading", {
      bytesWritten: 42 * MB,
      totalBytes: 100 * MB,
    })
    const s = libraryRowState(r, false)
    expect(s.affordance).toBe("ring")
    expect(s.subtitle).toBe("42% · 100 MB")
    expect(s.progress).toBeCloseTo(0.42)
  })

  it("downloading with an unknown total (0) reports 0 progress, no divide-by-zero", () => {
    const r = record("a", "downloading", { bytesWritten: 10, totalBytes: 0 })
    const s = libraryRowState(r, false)
    expect(s.progress).toBe(0)
    expect(s.subtitle).toBe("0% · 0 MB")
  })

  it("queued → none affordance, 'Queued'", () => {
    expect(libraryRowState(record("a", "queued"), false)).toEqual({
      subtitle: "Queued",
      affordance: "none",
    })
  })

  it("paused → resume affordance, 'Paused'", () => {
    expect(libraryRowState(record("a", "paused"), false)).toEqual({
      subtitle: "Paused",
      affordance: "resume",
    })
  })

  it("failed → retry affordance, 'Download failed'", () => {
    expect(libraryRowState(record("a", "failed"), false)).toEqual({
      subtitle: "Download failed",
      affordance: "retry",
    })
  })
})

describe("storageSummary (R2, KTD9)", () => {
  it("combinedBytes = downloaded totalBytes + in-flight bytesWritten", () => {
    const done = record("a", "downloaded", { totalBytes: 100 })
    const inFlight = record("b", "downloading", {
      bytesWritten: 30,
      totalBytes: 200,
    })
    const failed = record("c", "failed", { totalBytes: 500 })
    const summary = storageSummary([done, inFlight, failed], 1000)
    expect(summary?.count).toBe(3)
    expect(summary?.combinedBytes).toBe(130)
  })

  it("omits capacity + usage fraction when capacityBytes<=0, keeps count/combinedBytes", () => {
    const done = record("a", "downloaded", { totalBytes: 100 })
    expect(storageSummary([done], 0)).toEqual({
      count: 1,
      combinedBytes: 100,
      capacityBytes: null,
      usageFraction: null,
    })
  })

  it("hides the summary (null) for zero records", () => {
    expect(storageSummary([], 1000)).toBeNull()
  })

  it("computes a clamped usage fraction when capacity is known", () => {
    const done = record("a", "downloaded", { totalBytes: 250 })
    expect(storageSummary([done], 1000)?.usageFraction).toBeCloseTo(0.25)
  })
})

describe("formatLibraryBytes — edges", () => {
  it("rounds a sub-MB value down to whole MB", () => {
    expect(formatLibraryBytes(200 * 1024)).toBe("0 MB")
  })

  it("formats a plain MB value", () => {
    expect(formatLibraryBytes(74 * MB)).toBe("74 MB")
  })

  it("rolls over at exactly 1000 MB to GB, trimming a trailing .0", () => {
    expect(formatLibraryBytes(1000 * MB)).toBe("1 GB")
  })

  it("keeps one decimal for a non-round GB value", () => {
    expect(formatLibraryBytes(1500 * MB)).toBe("1.5 GB")
  })
})

describe("formatLibraryDuration — edges", () => {
  it("formats seconds as m:ss", () => {
    expect(formatLibraryDuration(252)).toBe("4:12")
  })

  it("pads seconds under 10", () => {
    expect(formatLibraryDuration(65)).toBe("1:05")
  })

  it("returns null (no badge) when duration is missing", () => {
    expect(formatLibraryDuration(undefined)).toBeNull()
  })
})
