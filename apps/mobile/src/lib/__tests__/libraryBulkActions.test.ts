import { bulkDelete, retryFailedSelected } from "../libraryBulkActions"
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

describe("bulkDelete (AE5)", () => {
  it("deletes across downloaded + downloading + queued, summing only effective bytes", async () => {
    const records = [
      record("done", "downloaded", { totalBytes: 100 }),
      record("dl", "downloading", { bytesWritten: 40, totalBytes: 200 }),
      record("q", "queued", { totalBytes: 50 }), // 0 bytesWritten -> contributes 0
    ]
    const deleteDownload = jest.fn().mockResolvedValue(undefined)

    const result = await bulkDelete({
      slugs: ["done", "dl", "q"],
      records,
      deleteDownload,
    })

    expect(deleteDownload).toHaveBeenCalledTimes(3)
    expect(deleteDownload).toHaveBeenNthCalledWith(1, "done")
    expect(deleteDownload).toHaveBeenNthCalledWith(2, "dl")
    expect(deleteDownload).toHaveBeenNthCalledWith(3, "q")
    expect(result).toEqual({ deletedCount: 3, freedBytes: 140, failedCount: 0 })
  })

  it("processes slugs sequentially, never overlapping in-flight calls", async () => {
    const events: string[] = []
    const deleteDownload = jest.fn(async (slug: string) => {
      events.push(`start:${slug}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      events.push(`end:${slug}`)
    })
    const records = [record("a", "downloaded"), record("b", "downloaded")]

    await bulkDelete({ slugs: ["a", "b"], records, deleteDownload })

    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"])
  })

  it("re-intersects with the live records at call time, skipping a vanished slug", async () => {
    const records = [record("a", "downloaded", { totalBytes: 100 })]
    const deleteDownload = jest.fn().mockResolvedValue(undefined)

    const result = await bulkDelete({
      slugs: ["a", "gone"],
      records,
      deleteDownload,
    })

    expect(deleteDownload).toHaveBeenCalledTimes(1)
    expect(deleteDownload).toHaveBeenCalledWith("a")
    expect(result).toEqual({ deletedCount: 1, freedBytes: 100, failedCount: 0 })
  })

  it("does not abort the rest of the batch when one slug's deleteDownload rejects", async () => {
    const records = [
      record("a", "downloaded", { totalBytes: 100 }),
      record("b", "downloaded", { totalBytes: 50 }),
      record("c", "downloaded", { totalBytes: 30 }),
    ]
    const deleteDownload = jest.fn(async (slug: string) => {
      if (slug === "b") throw new Error("boom")
    })

    const result = await bulkDelete({
      slugs: ["a", "b", "c"],
      records,
      deleteDownload,
    })

    expect(deleteDownload).toHaveBeenCalledTimes(3)
    // KTD4: counts reflect actual per-slug outcomes, not the requested count.
    expect(result).toEqual({ deletedCount: 2, freedBytes: 130, failedCount: 1 })
  })

  it("is a no-op returning zeroed counts for an empty slug list", async () => {
    const deleteDownload = jest.fn()
    const result = await bulkDelete({ slugs: [], records: [], deleteDownload })
    expect(deleteDownload).not.toHaveBeenCalled()
    expect(result).toEqual({ deletedCount: 0, freedBytes: 0, failedCount: 0 })
  })
})

describe("retryFailedSelected (AE3)", () => {
  it("targets only failed slugs from the selection, ignoring other states", async () => {
    const records = [
      record("failed1", "failed"),
      record("failed2", "failed"),
      record("done", "downloaded"),
      record("dl", "downloading"),
    ]
    const retryDownload = jest.fn().mockResolvedValue(undefined)

    const count = await retryFailedSelected({
      slugs: ["failed1", "failed2", "done", "dl"],
      records,
      retryDownload,
    })

    expect(retryDownload).toHaveBeenCalledTimes(2)
    expect(retryDownload).toHaveBeenCalledWith("failed1")
    expect(retryDownload).toHaveBeenCalledWith("failed2")
    expect(count).toBe(2)
  })

  it("counts only actual successes when a retry rejects (KTD4)", async () => {
    const records = [record("a", "failed"), record("b", "failed")]
    const retryDownload = jest.fn(async (slug: string) => {
      if (slug === "b") throw new Error("boom")
    })

    const count = await retryFailedSelected({
      slugs: ["a", "b"],
      records,
      retryDownload,
    })

    expect(count).toBe(1)
  })

  it("ignores a slug that vanished from records", async () => {
    const records = [record("a", "failed")]
    const retryDownload = jest.fn().mockResolvedValue(undefined)

    const count = await retryFailedSelected({
      slugs: ["a", "gone"],
      records,
      retryDownload,
    })

    expect(retryDownload).toHaveBeenCalledTimes(1)
    expect(count).toBe(1)
  })
})
