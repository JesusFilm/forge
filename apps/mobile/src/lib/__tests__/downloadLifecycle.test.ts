import {
  buildRequestRecord,
  buildSwapSnapshot,
  isStorageBlocked,
  newDownloadNonce,
  requestTotalBytes,
  swapRevertFields,
  type StartDownloadRequest,
} from "../downloadLifecycle"
import { STORAGE_RESERVE_BYTES } from "../offlineConstants"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type SwapFrom,
} from "../offlineManifest"

function makeRequest(
  overrides: Partial<StartDownloadRequest> = {},
): StartDownloadRequest {
  return {
    videoSlug: "washi-gospel-1",
    title: "Washi Gospel — Episode 1",
    dubDocumentId: "dub-1",
    rendition: {
      documentId: "rend-1",
      quality: "High",
      size: "1000",
      url: "https://cdn.example/m.mp4",
    },
    subtitleLanguageSlug: "korean",
    subtitleUrl: "https://cdn.example/s.vtt",
    posterUrl: "https://cdn.example/p.jpg",
    allowCellular: false,
    ...overrides,
  }
}

function makeSeriesRequest(
  overrides: Partial<StartDownloadRequest> = {},
): StartDownloadRequest {
  return makeRequest({
    seriesSlug: "storyclubs",
    seriesTitle: "StoryClubs",
    seriesEpisodeIndex: 2,
    durationSeconds: 725,
    enqueuedAt: 1_753_000_000_000,
    ...overrides,
  })
}

describe("requestTotalBytes", () => {
  it("parses the rendition size", () => {
    expect(requestTotalBytes(makeRequest())).toBe(1000)
  })

  it("degrades unknown/empty/NaN sizes to 0", () => {
    for (const size of ["", "unknown", "NaN"]) {
      const request = makeRequest()
      request.rendition = { ...request.rendition, size }
      expect(requestTotalBytes(request)).toBe(0)
    }
  })
})

describe("newDownloadNonce", () => {
  it("is url-safe and attempt-unique", () => {
    const a = newDownloadNonce()
    const b = newDownloadNonce()
    expect(a).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
    expect(b).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
    expect(a).not.toBe(b)
  })
})

describe("buildRequestRecord", () => {
  // Characterization: the exact literal the provider previously hand-wrote at
  // queueBatchRecords (queued), startDownload (downloading), pump (failed).
  const expectedBase = {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug: "washi-gospel-1",
    dubDocumentId: "dub-1",
    renditionDocumentId: "rend-1",
    qualityLabel: "High",
    title: "Washi Gospel — Episode 1",
    subtitleLanguageSlug: "korean",
    committedPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 1000,
  }

  it("builds the batch queued placeholder (bare: no paths)", () => {
    expect(buildRequestRecord(makeRequest(), "queued")).toEqual({
      ...expectedBase,
      state: "queued",
      pendingPath: null,
    })
  })

  it("builds the start-path downloading record with its pending path", () => {
    expect(
      buildRequestRecord(makeRequest(), "downloading", {
        pendingPath: "/root/washi-gospel-1/media.abc.pending",
      }),
    ).toEqual({
      ...expectedBase,
      state: "downloading",
      pendingPath: "/root/washi-gospel-1/media.abc.pending",
    })
  })

  it("builds the pump's failed-resurface record (bare, size unknown → 0)", () => {
    const request = makeRequest()
    request.rendition = { ...request.rendition, size: "" }
    expect(buildRequestRecord(request, "failed")).toEqual({
      ...expectedBase,
      state: "failed",
      pendingPath: null,
      totalBytes: 0,
    })
  })

  // U1: series & ordering metadata carries through every buildRequestRecord
  // seam (queued/downloading/failed) — the single source all three writers share.
  it.each(["queued", "downloading", "failed"] as const)(
    "carries the five series/ordering fields in the %s write",
    (state) => {
      const record = buildRequestRecord(makeSeriesRequest(), state)
      expect(record.seriesSlug).toBe("storyclubs")
      expect(record.seriesTitle).toBe("StoryClubs")
      expect(record.seriesEpisodeIndex).toBe(2)
      expect(record.durationSeconds).toBe(725)
      expect(record.enqueuedAt).toBe(1_753_000_000_000)
    },
  )

  it("leaves the five fields undefined for a request that doesn't carry them", () => {
    const record = buildRequestRecord(makeRequest(), "queued")
    expect(record.seriesSlug).toBeUndefined()
    expect(record.seriesTitle).toBeUndefined()
    expect(record.seriesEpisodeIndex).toBeUndefined()
    expect(record.durationSeconds).toBeUndefined()
    expect(record.enqueuedAt).toBeUndefined()
  })
})

describe("swap snapshot + revert round-trip (AE2)", () => {
  const existing: OfflineDownloadRecord = {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug: "washi-gospel-1",
    dubDocumentId: "dub-1",
    renditionDocumentId: "rend-old",
    qualityLabel: "Low",
    title: "Washi Gospel — Episode 1",
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: "/root/washi-gospel-1/media.rend-old.mp4",
    pendingPath: null,
    posterPath: "/root/washi-gospel-1/poster.jpg",
    bytesWritten: 900,
    totalBytes: 900,
  }

  it("snapshot captures exactly the fields the revert restores", () => {
    expect(buildSwapSnapshot(existing, existing.committedPath!)).toEqual({
      committedPath: "/root/washi-gospel-1/media.rend-old.mp4",
      renditionDocumentId: "rend-old",
      qualityLabel: "Low",
      subtitleLanguageSlug: null,
      totalBytes: 900,
      posterPath: "/root/washi-gospel-1/poster.jpg",
    })
  })

  it("revert over a mid-swap record lands back on the old copy, markers cleared", () => {
    const swap: SwapFrom = buildSwapSnapshot(existing, existing.committedPath!)
    const midSwap: OfflineDownloadRecord = {
      ...existing,
      renditionDocumentId: "rend-new",
      qualityLabel: "High",
      subtitleLanguageSlug: "korean",
      state: "downloading",
      committedPath: null,
      pendingPath: "/root/washi-gospel-1/media.n1.pending",
      bytesWritten: 5,
      totalBytes: 2000,
      swapFrom: swap,
    }
    // Both revert sites merge these fields over the current record — the
    // buildHandlers patch() and cancelDownload's writeRecord({...current}).
    expect({ ...midSwap, ...swapRevertFields(swap) }).toEqual({
      ...existing,
      bytesWritten: 900,
      swapFrom: null,
    })
  })

  // A12: swapRevertFields is an explicit field list that does NOT mention
  // seriesSlug — it survives only because both revert call sites merge over
  // the CURRENT record (`{ ...current, ...swapRevertFields(swap) }`), never
  // replace it. Pin that the merge pattern (not the explicit list) is what
  // carries it.
  it("A12: a reverting swap preserves seriesSlug via the merge-over-current pattern", () => {
    const seriesExisting: OfflineDownloadRecord = {
      ...existing,
      seriesSlug: "storyclubs",
      seriesTitle: "StoryClubs",
      seriesEpisodeIndex: 2,
    }
    const swap: SwapFrom = buildSwapSnapshot(
      seriesExisting,
      seriesExisting.committedPath!,
    )
    const midSwap: OfflineDownloadRecord = {
      ...seriesExisting,
      renditionDocumentId: "rend-new",
      qualityLabel: "High",
      state: "downloading",
      committedPath: null,
      pendingPath: "/root/washi-gospel-1/media.n1.pending",
      swapFrom: swap,
    }
    const reverted = { ...midSwap, ...swapRevertFields(swap) }
    expect(reverted.seriesSlug).toBe("storyclubs")
    expect(reverted.seriesTitle).toBe("StoryClubs")
    expect(reverted.seriesEpisodeIndex).toBe(2)
  })
})

// Mirrors DownloadsProvider.tsx's launch-reattach effect (~line 475-495): the
// isBatchPlaceholderRecord branch rebuilds a StartDownloadRequest BY HAND from
// a persisted record (no React harness here — this is a characterization of
// that literal, kept in lockstep with the provider by hand; a mismatch would
// only surface as a runtime/manual-QA regression, not a test failure here).
function buildReattachRequest(
  record: OfflineDownloadRecord,
  allowCellular: boolean,
): StartDownloadRequest {
  return {
    videoSlug: record.videoSlug,
    title: record.title,
    dubDocumentId: record.dubDocumentId,
    rendition: {
      documentId: record.renditionDocumentId,
      quality: record.qualityLabel,
      size: record.totalBytes > 0 ? String(record.totalBytes) : "",
      url: "",
    },
    subtitleLanguageSlug: record.subtitleLanguageSlug,
    subtitleUrl: null,
    posterUrl: null,
    allowCellular,
    seriesSlug: record.seriesSlug,
    seriesTitle: record.seriesTitle,
    seriesEpisodeIndex: record.seriesEpisodeIndex,
    durationSeconds: record.durationSeconds,
    enqueuedAt: record.enqueuedAt,
  }
}

describe("reattach requeue (DownloadsProvider batch-placeholder rebuild)", () => {
  const relaunchedPlaceholder: OfflineDownloadRecord = {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug: "washi-gospel-2",
    dubDocumentId: "dub-2",
    renditionDocumentId: "rend-2",
    qualityLabel: "High",
    title: "Washi Gospel — Episode 2",
    subtitleLanguageSlug: null,
    state: "queued",
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 1000,
    seriesSlug: "storyclubs",
    seriesTitle: "StoryClubs",
    seriesEpisodeIndex: 2,
    durationSeconds: 725,
    enqueuedAt: 1_753_000_000_000,
  }

  it("rebuilds a request carrying the five fields from a relaunched placeholder record", () => {
    const request = buildReattachRequest(relaunchedPlaceholder, false)
    expect(request.seriesSlug).toBe("storyclubs")
    expect(request.seriesTitle).toBe("StoryClubs")
    expect(request.seriesEpisodeIndex).toBe(2)
    expect(request.durationSeconds).toBe(725)
    expect(request.enqueuedAt).toBe(1_753_000_000_000)
  })

  // AE7: a kill/relaunch mid-batch reattaches this placeholder, it re-enters the
  // queue via the rebuilt request above, and if the pump's start attempt fails,
  // the failed-resurface write (DownloadsProvider.tsx:610) must still carry
  // seriesSlug — not silently drop it back to a bare unlinked record.
  it("AE7: a failed-resurface after the reattach keeps seriesSlug", () => {
    const request = buildReattachRequest(relaunchedPlaceholder, false)
    const failedRecord = buildRequestRecord(request, "failed")
    expect(failedRecord.seriesSlug).toBe("storyclubs")
    expect(failedRecord.seriesTitle).toBe("StoryClubs")
    expect(failedRecord.seriesEpisodeIndex).toBe(2)
  })
})

describe("isStorageBlocked (U12 per-download gate)", () => {
  it("never blocks on an unreadable free reading (0)", () => {
    expect(isStorageBlocked(0, 10_000)).toBe(false)
  })

  it("blocks when size + reserve exceeds free", () => {
    expect(isStorageBlocked(STORAGE_RESERVE_BYTES + 999, 1000)).toBe(true)
  })

  it("allows at exactly size + reserve, and above", () => {
    expect(isStorageBlocked(STORAGE_RESERVE_BYTES + 1000, 1000)).toBe(false)
    expect(isStorageBlocked(STORAGE_RESERVE_BYTES + 1001, 1000)).toBe(false)
  })

  it("a zero-size request still requires the reserve", () => {
    expect(isStorageBlocked(STORAGE_RESERVE_BYTES - 1, 0)).toBe(true)
    expect(isStorageBlocked(STORAGE_RESERVE_BYTES, 0)).toBe(false)
  })
})
