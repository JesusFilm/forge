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
}

const IN_PROGRESS_STATES: ReadonlySet<OfflineDownloadState> =
  new Set<OfflineDownloadState>(["queued", "downloading", "paused"])

export function deriveSeriesDownloadState(
  episodeSlugs: readonly string[],
  downloadedSlugs: readonly string[],
  offlineRecords: readonly OfflineDownloadRecord[],
): SeriesDownloadState {
  const episodes = new Set(episodeSlugs)
  const downloaded = new Set(downloadedSlugs)
  return {
    // N counts only completed copies; failed records are excluded (they are
    // neither in downloadedSlugs nor an in-progress state).
    downloaded: episodeSlugs.filter((slug) => downloaded.has(slug)).length,
    total: episodeSlugs.length,
    inProgress: offlineRecords.some(
      (record) =>
        episodes.has(record.videoSlug) && IN_PROGRESS_STATES.has(record.state),
    ),
  }
}

export function seriesDownloadLabel(state: SeriesDownloadState): string {
  const { downloaded, total, inProgress } = state
  if (inProgress) return `Downloading… (${downloaded} of ${total})`
  if (total > 0 && downloaded >= total) return "All downloaded"
  if (downloaded > 0) return `${downloaded} of ${total} downloaded`
  return "Download all"
}
