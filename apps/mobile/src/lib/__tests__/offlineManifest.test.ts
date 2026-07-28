import {
  OFFLINE_INDEX_STORAGE_KEY,
  OFFLINE_MANIFEST_VERSION,
  isBatchPlaceholderRecord,
  isLiveDownloadRecord,
  offlineRecordKey,
  parseOfflineIndex,
  parseOfflineRecord,
  serializeOfflineIndex,
  serializeOfflineRecord,
  type OfflineDownloadRecord,
} from "../offlineManifest"

const RECORD: OfflineDownloadRecord = {
  version: OFFLINE_MANIFEST_VERSION,
  videoSlug: "the-birth-of-jesus",
  dubDocumentId: "dub-123",
  renditionDocumentId: "rend-high-456",
  qualityLabel: "High",
  title: "The Birth of Jesus",
  subtitleLanguageSlug: "english",
  state: "downloaded",
  committedPath: "file:///docs/downloads/the-birth-of-jesus/rend-high-456.mp4",
  pendingPath: null,
  posterPath: "file:///docs/downloads/the-birth-of-jesus/poster.jpg",
  bytesWritten: 412_000_000,
  totalBytes: 412_000_000,
  swapFrom: null,
}

describe("offlineRecordKey", () => {
  it("namespaces by video slug", () => {
    expect(offlineRecordKey("the-birth-of-jesus")).toBe(
      "offline.download.the-birth-of-jesus",
    )
  })

  it("is distinct from the index key", () => {
    expect(offlineRecordKey("x")).not.toBe(OFFLINE_INDEX_STORAGE_KEY)
  })
})

describe("parseOfflineRecord", () => {
  it("round-trips a full record", () => {
    expect(parseOfflineRecord(serializeOfflineRecord(RECORD))).toEqual(RECORD)
  })

  it("round-trips a mid-swap record's swapFrom snapshot", () => {
    const swapping: OfflineDownloadRecord = {
      ...RECORD,
      state: "downloading",
      committedPath: null,
      swapFrom: {
        committedPath: "file:///docs/downloads/x/old.mp4",
        renditionDocumentId: "rend-low-1",
        qualityLabel: "Low",
        subtitleLanguageSlug: null,
        totalBytes: 100,
        posterPath: null,
      },
    }
    expect(parseOfflineRecord(serializeOfflineRecord(swapping))).toEqual(
      swapping,
    )
  })

  it("drops a malformed swapFrom (no identity) to null", () => {
    const out = parseOfflineRecord(
      JSON.stringify({ ...RECORD, swapFrom: { qualityLabel: "Low" } }),
    )
    expect(out?.swapFrom).toBeNull()
  })

  it("preserves a null subtitle slug (No subtitles)", () => {
    const noSubs = { ...RECORD, subtitleLanguageSlug: null }
    expect(
      parseOfflineRecord(serializeOfflineRecord(noSubs))?.subtitleLanguageSlug,
    ).toBeNull()
  })

  it.each([null, "", "not json", "[]", "42", '"a string"'])(
    "returns null for unusable blob %p",
    (raw) => {
      expect(parseOfflineRecord(raw)).toBeNull()
    },
  )

  it("drops a record from a different schema version", () => {
    const stale = JSON.stringify({ ...RECORD, version: 999 })
    expect(parseOfflineRecord(stale)).toBeNull()
  })

  it.each(["videoSlug", "dubDocumentId", "renditionDocumentId"])(
    "drops a record missing stable identity field %s",
    (field) => {
      const broken = { ...RECORD } as Record<string, unknown>
      delete broken[field]
      expect(parseOfflineRecord(JSON.stringify(broken))).toBeNull()
    },
  )

  it("drops a record with an unknown state", () => {
    const broken = JSON.stringify({ ...RECORD, state: "teleporting" })
    expect(parseOfflineRecord(broken)).toBeNull()
  })

  it("coerces non-numeric byte counts to 0", () => {
    const weird = JSON.stringify({
      ...RECORD,
      bytesWritten: "lots",
      totalBytes: null,
    })
    const out = parseOfflineRecord(weird)
    expect(out?.bytesWritten).toBe(0)
    expect(out?.totalBytes).toBe(0)
  })

  it("treats missing optional paths as null", () => {
    const minimal = JSON.stringify({
      version: OFFLINE_MANIFEST_VERSION,
      videoSlug: "s",
      dubDocumentId: "d",
      renditionDocumentId: "r",
      state: "queued",
    })
    const out = parseOfflineRecord(minimal)
    expect(out).not.toBeNull()
    expect(out?.committedPath).toBeNull()
    expect(out?.posterPath).toBeNull()
    expect(out?.qualityLabel).toBe("")
    expect(out?.title).toBe("")
  })
})

describe("series & ordering metadata (U1)", () => {
  const withSeries: OfflineDownloadRecord = {
    ...RECORD,
    seriesSlug: "storyclubs",
    seriesTitle: "StoryClubs",
    seriesEpisodeIndex: 3,
    durationSeconds: 725,
    enqueuedAt: 1_753_000_000_000,
  }

  it("round-trips all five fields intact", () => {
    expect(parseOfflineRecord(serializeOfflineRecord(withSeries))).toEqual(
      withSeries,
    )
  })

  it("AE4: a legacy record (none of the five present) parses with all five undefined, not dropped", () => {
    const out = parseOfflineRecord(serializeOfflineRecord(RECORD))
    expect(out).not.toBeNull()
    expect(out?.seriesSlug).toBeUndefined()
    expect(out?.seriesTitle).toBeUndefined()
    expect(out?.seriesEpisodeIndex).toBeUndefined()
    expect(out?.durationSeconds).toBeUndefined()
    expect(out?.enqueuedAt).toBeUndefined()
  })

  it("round-trips seriesEpisodeIndex: 0 / durationSeconds: 0 as 0, not absent", () => {
    const zeroed: OfflineDownloadRecord = {
      ...withSeries,
      seriesEpisodeIndex: 0,
      durationSeconds: 0,
    }
    const out = parseOfflineRecord(serializeOfflineRecord(zeroed))
    expect(out?.seriesEpisodeIndex).toBe(0)
    expect(out?.durationSeconds).toBe(0)
  })
})

describe("parseOfflineIndex", () => {
  it("round-trips a slug list and removes duplicates", () => {
    const raw = serializeOfflineIndex(["a", "b", "a"])
    expect(parseOfflineIndex(raw)).toEqual(["a", "b"])
  })

  it.each([null, "", "not json", "{}", "42"])(
    "returns [] for unusable blob %p",
    (raw) => {
      expect(parseOfflineIndex(raw)).toEqual([])
    },
  )

  it("filters non-string and empty entries", () => {
    const raw = JSON.stringify(["a", 1, null, "", "b", { x: 1 }])
    expect(parseOfflineIndex(raw)).toEqual(["a", "b"])
  })
})

describe("isBatchPlaceholderRecord", () => {
  it("is true only for a bare queued record with no pending/committed file", () => {
    expect(
      isBatchPlaceholderRecord({
        ...RECORD,
        state: "queued",
        pendingPath: null,
        committedPath: null,
      }),
    ).toBe(true)
  })

  it("is false for null, an in-progress record, or a queued record with a file", () => {
    expect(isBatchPlaceholderRecord(null)).toBe(false)
    expect(isBatchPlaceholderRecord({ ...RECORD, state: "downloading" })).toBe(
      false,
    )
    expect(
      isBatchPlaceholderRecord({
        ...RECORD,
        state: "queued",
        pendingPath: "/tmp/x.pending",
        committedPath: null,
      }),
    ).toBe(false)
    expect(
      isBatchPlaceholderRecord({
        ...RECORD,
        state: "queued",
        pendingPath: null,
        committedPath: "/files/x.mp4",
      }),
    ).toBe(false)
  })
})

describe("isLiveDownloadRecord", () => {
  it("is true for downloaded and in-progress states", () => {
    for (const state of [
      "downloaded",
      "downloading",
      "queued",
      "paused",
    ] as const) {
      expect(isLiveDownloadRecord({ ...RECORD, state })).toBe(true)
    }
  })

  it("is false for null, failed, and canceled (re-downloadable slugs)", () => {
    expect(isLiveDownloadRecord(null)).toBe(false)
    expect(isLiveDownloadRecord({ ...RECORD, state: "failed" })).toBe(false)
    expect(isLiveDownloadRecord({ ...RECORD, state: "canceled" })).toBe(false)
  })
})
