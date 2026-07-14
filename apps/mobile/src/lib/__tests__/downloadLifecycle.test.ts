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
