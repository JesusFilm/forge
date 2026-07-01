import type {
  OfflineDownloadRecord,
  OfflineDownloadState,
} from "./offlineManifest"

// Series-level download state for the action row, derived purely at read time by
// intersecting the series' episode slugs with the download records — there is no
// persisted series-membership field (KTD5).

export type SeriesDownloadState = {
  downloaded: number
  total: number
  inProgress: boolean
  /**
   * Any episode paused and NONE still downloading/queued (U8). `inProgress`
   * already counts `paused`, so it can't drive "Pause all" — this is the flag
   * checked FIRST to flip the batch bar to "Resume all".
   */
  pausedAggregate: boolean
  /** Series episode slugs in an in-progress state — the batch controls act on these. */
  inFlightSlugs: string[]
  /** 0..1 byte-weighted progress across the series for the action-row ring. */
  progress: number
}

const IN_PROGRESS_STATES: ReadonlySet<OfflineDownloadState> =
  new Set<OfflineDownloadState>(["queued", "downloading", "paused"])

export function deriveSeriesDownloadState(
  episodeSlugs: readonly string[],
  downloadedSlugs: readonly string[],
  offlineRecords: readonly OfflineDownloadRecord[],
): SeriesDownloadState {
  const downloaded = new Set(downloadedSlugs)
  const recordBySlug = new Map(
    offlineRecords.map((record) => [record.videoSlug, record] as const),
  )

  // Episode-normalized byte progress: a completed episode counts as 1, an
  // in-flight one as its byte fraction, so the ring creeps smoothly and reads
  // full only when every episode is downloaded.
  let inProgress = false
  let anyDownloading = false
  let anyPaused = false
  const inFlightSlugs: string[] = []
  let units = 0
  for (const slug of episodeSlugs) {
    const record = recordBySlug.get(slug)
    if (!record) continue
    if (record.state === "downloaded") {
      units += 1
    } else if (IN_PROGRESS_STATES.has(record.state)) {
      inProgress = true
      inFlightSlugs.push(slug)
      // `queued` counts as active (not paused) so a queued episode keeps the bar
      // on "Pause all" rather than flipping it to "Resume all".
      if (record.state === "paused") anyPaused = true
      else anyDownloading = true
      if (record.totalBytes > 0) {
        const fraction = record.bytesWritten / record.totalBytes
        units += Math.max(0, Math.min(1, fraction))
      }
    }
  }

  const total = episodeSlugs.length
  return {
    // N counts only completed copies; failed records are excluded (they are
    // neither in downloadedSlugs nor an in-progress state).
    downloaded: episodeSlugs.filter((slug) => downloaded.has(slug)).length,
    total,
    inProgress,
    pausedAggregate: anyPaused && !anyDownloading,
    inFlightSlugs,
    progress: total === 0 ? 0 : units / total,
  }
}

/** Every episode has a completed offline copy — drives the "all done" tick. */
export function seriesAllDownloaded(state: SeriesDownloadState): boolean {
  return state.total > 0 && state.downloaded >= state.total
}

export function seriesDownloadLabel(state: SeriesDownloadState): string {
  const { downloaded, total, inProgress, pausedAggregate } = state
  if (pausedAggregate) return `Paused (${downloaded} of ${total})`
  if (inProgress) return `Downloading… (${downloaded} of ${total})`
  if (seriesAllDownloaded(state)) return "All downloaded"
  if (downloaded > 0) return `${downloaded} of ${total} downloaded`
  return "Download all"
}
