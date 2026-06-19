import { reconcile, type ReconcileInput } from "../downloadReconciliation"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
} from "../offlineManifest"

function record(
  videoSlug: string,
  state: OfflineDownloadState,
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
  }
}

function input(partial: Partial<ReconcileInput>): ReconcileInput {
  return {
    records: [],
    liveTaskSlugs: new Set(),
    pendingFileSlugs: new Set(),
    committedFileSlugs: new Set(),
    ...partial,
  }
}

describe("reconcile", () => {
  it("confirms a downloaded record when its committed file exists", () => {
    expect(
      reconcile(
        input({
          records: [record("a", "downloaded")],
          committedFileSlugs: new Set(["a"]),
        }),
      ),
    ).toEqual([{ action: "confirmDownloaded", videoSlug: "a" }])
  })

  it("repairs a downloaded record whose committed file is gone", () => {
    expect(reconcile(input({ records: [record("a", "downloaded")] }))).toEqual([
      { action: "repair", videoSlug: "a" },
    ])
  })

  it("rebinds an in-flight record that has a live task", () => {
    expect(
      reconcile(
        input({
          records: [record("a", "downloading")],
          liveTaskSlugs: new Set(["a"]),
          pendingFileSlugs: new Set(["a"]),
        }),
      ),
    ).toEqual([{ action: "rebind", videoSlug: "a" }])
  })

  it.each<OfflineDownloadState>(["downloading", "paused", "queued"])(
    "requeues an in-flight (%s) record with no live task",
    (state) => {
      expect(
        reconcile(
          input({
            records: [record("a", state)],
            pendingFileSlugs: new Set(["a"]),
          }),
        ),
      ).toEqual([{ action: "requeue", videoSlug: "a" }])
    },
  )

  it("never confirms a partial as complete (downloading never yields confirmDownloaded)", () => {
    const actions = reconcile(
      input({
        records: [record("a", "downloading")],
        committedFileSlugs: new Set(["a"]), // even if a stray committed file exists
        liveTaskSlugs: new Set(["a"]),
      }),
    )
    expect(actions.some((x) => x.action === "confirmDownloaded")).toBe(false)
  })

  it("leaves a failed record alone for explicit retry", () => {
    expect(reconcile(input({ records: [record("a", "failed")] }))).toEqual([])
  })

  it("drops a lingering canceled record", () => {
    expect(reconcile(input({ records: [record("a", "canceled")] }))).toEqual([
      { action: "dropRecord", videoSlug: "a" },
    ])
  })

  it("cleans up an orphan pending file with no in-flight record", () => {
    expect(reconcile(input({ pendingFileSlugs: new Set(["ghost"]) }))).toEqual([
      { action: "cleanupOrphanPending", videoSlug: "ghost" },
    ])
  })

  it("keeps a pending file that an in-flight record backs", () => {
    const actions = reconcile(
      input({
        records: [record("a", "paused")],
        pendingFileSlugs: new Set(["a"]),
      }),
    )
    expect(actions.some((x) => x.action === "cleanupOrphanPending")).toBe(false)
  })
})
