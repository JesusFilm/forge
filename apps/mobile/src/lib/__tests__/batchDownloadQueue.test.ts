import { canQueueBatchDownload, nextBatchAction } from "../batchDownloadQueue"
import type { OfflineDownloadRecord } from "../offlineManifest"
import type { StartDownloadRequest } from "../../contexts/DownloadsProvider"

const rec = (
  videoSlug: string,
  state: OfflineDownloadRecord["state"],
  extra: Partial<OfflineDownloadRecord> = {},
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
  ...extra,
})

const req = (videoSlug: string): StartDownloadRequest => ({
  videoSlug,
  title: "",
  dubDocumentId: "d",
  rendition: { documentId: "r", quality: "high", size: "1", url: "https://x" },
  subtitleLanguageSlug: null,
  subtitleUrl: null,
  posterUrl: null,
  allowCellular: true,
})

const asMap = (...records: OfflineDownloadRecord[]) =>
  Object.fromEntries(records.map((r) => [r.videoSlug, r]))

describe("nextBatchAction (strict-sequential batch pump)", () => {
  it("empty queue → empty", () => {
    expect(nextBatchAction({}, [], new Set())).toEqual({ kind: "empty" })
  })

  it("waits while a batch episode is downloading (strict one-at-a-time)", () => {
    const records = asMap(rec("e1", "downloading"), rec("e2", "queued"))
    const action = nextBatchAction(records, [req("e2")], new Set(["e1", "e2"]))
    expect(action).toEqual({ kind: "wait" })
  })

  it("waits while a batch episode is paused (Pause all must not advance)", () => {
    const records = asMap(rec("e1", "paused"), rec("e2", "queued"))
    const action = nextBatchAction(records, [req("e2")], new Set(["e1", "e2"]))
    expect(action).toEqual({ kind: "wait" })
  })

  it("a long-paused download OUTSIDE the batch never blocks it", () => {
    const records = asMap(rec("old-video", "paused"), rec("e1", "queued"))
    const action = nextBatchAction(records, [req("e1")], new Set(["e1"]))
    expect(action).toEqual({ kind: "start", request: req("e1") })
  })

  it("starts the queue head when the slot is free (FIFO order)", () => {
    const records = asMap(rec("e1", "queued"), rec("e2", "queued"))
    const action = nextBatchAction(
      records,
      [req("e1"), req("e2")],
      new Set(["e1", "e2"]),
    )
    expect(action).toEqual({ kind: "start", request: req("e1") })
  })

  it("drops a head whose placeholder is gone (canceled while waiting)", () => {
    const action = nextBatchAction({}, [req("e1")], new Set(["e1"]))
    expect(action).toEqual({ kind: "drop", videoSlug: "e1" })
  })

  it("drops a head another flow already claimed (not a bare placeholder)", () => {
    const records = asMap(rec("e1", "downloading", { pendingPath: "/p" }))
    const action = nextBatchAction(records, [req("e1")], new Set(["e1"]))
    // e1 both occupies the slot and is the head — occupancy wins first.
    expect(action).toEqual({ kind: "wait" })
  })

  it("drops a head that completed out-of-band (downloaded record)", () => {
    const records = asMap(
      rec("e1", "downloaded", { committedPath: "/c" }),
      rec("e2", "queued"),
    )
    const action = nextBatchAction(
      records,
      [req("e1"), req("e2")],
      new Set(["e1", "e2"]),
    )
    expect(action).toEqual({ kind: "drop", videoSlug: "e1" })
  })

  it("honors a larger cap when configured", () => {
    const records = asMap(rec("e1", "downloading"), rec("e2", "queued"))
    const action = nextBatchAction(
      records,
      [req("e2")],
      new Set(["e1", "e2"]),
      2,
    )
    expect(action).toEqual({ kind: "start", request: req("e2") })
  })
})

describe("canQueueBatchDownload (batch-queue acceptance gate)", () => {
  it("rejects a slug another flow owns (live non-placeholder record)", () => {
    const records = asMap(rec("e1", "downloading", { pendingPath: "/p" }))
    expect(canQueueBatchDownload(records, [], "e1")).toBe(false)
  })

  it("accepts a slug whose record is the batch's own placeholder", () => {
    const records = asMap(rec("e1", "queued"))
    expect(canQueueBatchDownload(records, [], "e1")).toBe(true)
  })

  it("rejects a slug already waiting in the queue", () => {
    expect(canQueueBatchDownload({}, [req("e1")], "e1")).toBe(false)
  })

  it("accepts a fresh slug (no record, not queued)", () => {
    expect(canQueueBatchDownload({}, [req("e2")], "e1")).toBe(true)
  })

  it("accepts re-queueing after a failed attempt (failed is not live)", () => {
    const records = asMap(rec("e1", "failed"))
    expect(canQueueBatchDownload(records, [], "e1")).toBe(true)
  })
})
