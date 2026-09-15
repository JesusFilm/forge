/**
 * How far a series export has got, counted in EPISODES SAVED.
 *
 * The export session cannot answer this. Its per-target entry is deleted the
 * moment an episode finishes, so no trace of a saved episode survives, and a
 * ring drawn from the session can only ever show the one episode in flight —
 * sweeping from empty to full once per episode, and sitting at empty for the
 * whole run when every episode reuses an offline copy and reports no progress.
 *
 * The run loop is the only thing that knows the count, so it publishes it here.
 */

/** Where a series export has got to, in episodes. */
export type SeriesExportRunProgress = {
  /** The run this belongs to, so the export report can tell whether the run
   *  behind one of its cards is still going. */
  runId: string
  /** Episodes of this run already written to the photo library. */
  saved: number
  /** Episodes the run covers. Never 0 while a run is live. */
  total: number
}

type Snapshot = Readonly<Record<string, SeriesExportRunProgress>>

const EMPTY: Snapshot = {}

let bySeries: Record<string, SeriesExportRunProgress> = {}
let snapshot: Snapshot = EMPTY
const listeners = new Set<() => void>()

function commit(): void {
  snapshot = { ...bySeries }
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // One bad subscriber must not stop the others being told.
    }
  }
}

/**
 * Publish a run's progress, or `null` once it ends. The run owns both calls,
 * and the end call belongs in a `finally` — a run that throws still has to
 * clear the ring it put up.
 */
export function publishSeriesExportProgress(
  seriesSlug: string,
  progress: SeriesExportRunProgress | null,
): void {
  if (seriesSlug === "") return
  const current = bySeries[seriesSlug]
  if (progress == null) {
    if (current == null) return
    // The run is over; its cancel latch must not outlive it and stop the next.
    cancelledRuns.delete(current.runId)
    const next = { ...bySeries }
    delete next[seriesSlug]
    bySeries = next
    commit()
    return
  }
  if (
    current != null &&
    current.runId === progress.runId &&
    current.saved === progress.saved &&
    current.total === progress.total
  ) {
    return
  }
  bySeries = { ...bySeries, [seriesSlug]: progress }
  commit()
}

export function getSeriesExportProgressSnapshot(): Snapshot {
  return snapshot
}

/**
 * Runs the viewer has stopped, by run id.
 *
 * The session's own cancel flag lives on a per-episode entry that is deleted
 * the moment that episode finishes, so it cannot answer "did the viewer stop
 * this RUN" during the library write or in the gap between two episodes — the
 * two windows where a stop used to be lost while the run carried on.
 */
const cancelledRuns = new Set<string>()

/** Stop the run covering this series, if one is live. Answers whether it was. */
export function requestSeriesExportCancel(seriesSlug: string): boolean {
  const run = bySeries[seriesSlug]
  if (!run) return false
  cancelledRuns.add(run.runId)
  return true
}

export function isSeriesExportCancelled(runId: string): boolean {
  return cancelledRuns.has(runId)
}

export function subscribeToSeriesExportProgress(
  listener: () => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only: drop every run and every subscriber. */
export function resetSeriesExportProgressForTests(): void {
  cancelledRuns.clear()
  bySeries = {}
  snapshot = EMPTY
  listeners.clear()
}
