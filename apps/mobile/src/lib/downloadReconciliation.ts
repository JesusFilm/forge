import type { OfflineDownloadRecord } from "./offlineManifest"

/**
 * Pure launch reconciliation (U6): given the persisted manifest records, the
 * live native download tasks (from the background module's
 * getExistingDownloadTasks), and what partial/committed files exist on disk,
 * decide what to do on cold start. A partial is NEVER presented as complete.
 *
 * Pure so the reattach brain is unit-testable without the native module.
 */

export type ReconcileInput = {
  records: readonly OfflineDownloadRecord[]
  /** Video slugs that currently have a live native download task. */
  liveTaskSlugs: ReadonlySet<string>
  /** Video slugs with a `.pending` partial file on disk. */
  pendingFileSlugs: ReadonlySet<string>
  /** Video slugs whose committed (verified) media file exists on disk. */
  committedFileSlugs: ReadonlySet<string>
}

export type ReconcileAction =
  /** Record is in-flight and a live task exists — rebind the task to the record. */
  | { action: "rebind"; videoSlug: string }
  /** Record is in-flight but no live task survived — re-enqueue (refresh URL). */
  | { action: "requeue"; videoSlug: string }
  /** Record says downloaded and the committed file is present — confirm. */
  | { action: "confirmDownloaded"; videoSlug: string }
  /** Record says downloaded but the committed file is gone — re-download. */
  | { action: "repair"; videoSlug: string }
  /** Canceled record lingered — drop it. */
  | { action: "dropRecord"; videoSlug: string }
  /** A `.pending` partial with no in-flight record backing it — delete it. */
  | { action: "cleanupOrphanPending"; videoSlug: string }

const IN_FLIGHT: ReadonlySet<string> = new Set([
  "downloading",
  "paused",
  "queued",
])

export function reconcile(input: ReconcileInput): ReconcileAction[] {
  const actions: ReconcileAction[] = []

  for (const record of input.records) {
    switch (record.state) {
      case "downloaded":
        // Never trust a "downloaded" record without the committed file present.
        actions.push(
          input.committedFileSlugs.has(record.videoSlug)
            ? { action: "confirmDownloaded", videoSlug: record.videoSlug }
            : { action: "repair", videoSlug: record.videoSlug },
        )
        break
      case "downloading":
      case "paused":
      case "queued":
        actions.push(
          input.liveTaskSlugs.has(record.videoSlug)
            ? { action: "rebind", videoSlug: record.videoSlug }
            : { action: "requeue", videoSlug: record.videoSlug },
        )
        break
      case "failed":
        // Left for an explicit user retry — no reconcile action.
        break
      case "canceled":
        actions.push({ action: "dropRecord", videoSlug: record.videoSlug })
        break
    }
  }

  // A pending partial is only legitimate when an in-flight record backs it.
  const inFlightSlugs = new Set(
    input.records.filter((r) => IN_FLIGHT.has(r.state)).map((r) => r.videoSlug),
  )
  for (const slug of input.pendingFileSlugs) {
    if (!inFlightSlugs.has(slug)) {
      actions.push({ action: "cleanupOrphanPending", videoSlug: slug })
    }
  }

  return actions
}
