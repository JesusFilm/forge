import type { OfflineDownloadRecord } from "./offlineManifest"

/**
 * Pure cold-start reconciliation (U6) over manifest records, live native tasks,
 * and on-disk files. A partial is NEVER presented as complete. Pure (no native
 * import) so the reattach brain is unit-testable.
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
  /** Paused record with no live task — stay paused, await a user resume (U5). */
  | { action: "keepPaused"; videoSlug: string }
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
      case "paused":
        // U5: a paused record whose task survived rebinds (resume continues in
        // place); one with no live task STAYS paused, awaiting a user resume — it
        // must NOT requeue into a zero-byte restart (R5/AE4).
        actions.push(
          input.liveTaskSlugs.has(record.videoSlug)
            ? { action: "rebind", videoSlug: record.videoSlug }
            : { action: "keepPaused", videoSlug: record.videoSlug },
        )
        break
      case "downloading":
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
