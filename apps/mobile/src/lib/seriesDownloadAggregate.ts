import { clampFraction, type ExportSessionSnapshot } from "./exportSession"
import type { SeriesExportRunProgress } from "./seriesExportProgress"
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
  /**
   * A raw export runs over one of this series' episodes (R16). It is separate
   * from `inProgress`: an export is not an offline transfer, and nothing about
   * it may be paused (R24).
   */
  exporting: boolean
  /**
   * 0..1 for the export ring, counted in EPISODES SAVED to the chosen folder,
   * so it steps once per episode and reads full only when the run has saved
   * them all — the offline ring's shape, on the export's own unit.
   *
   * It cannot come from the export session: that deletes each entry when its
   * episode finishes, so the only thing left to average is the one episode in
   * flight, which sweeps empty-to-full once per episode and stays at empty for
   * a whole run of reused offline copies. The run publishes the count instead.
   * Without a run — one episode exported from its own watch screen — this
   * falls back to that export's byte progress.
   */
  exportProgress: number
  /** The episodes exporting now — the cancel control acts on these (R30). */
  exportingSlugs: string[]
  /** Every exporting episode is paused, so the row offers a resume. */
  pausedExport: boolean
}

const IN_PROGRESS_STATES: ReadonlySet<OfflineDownloadState> =
  new Set<OfflineDownloadState>(["queued", "downloading", "paused"])

const NO_PENDING_SWAPS: ReadonlySet<string> = new Set()

/**
 * Episodes in the library PLUS how far the one in flight has got, over the
 * episodes the run covers — the offline ring's shape on the export's own unit.
 *
 * Both halves are load-bearing. The count alone steps a fifth at a time and
 * stands still in between; the in-flight fraction alone measures one episode
 * and resets at every boundary. Together the arc creeps and reads full exactly
 * when the run has saved them all.
 *
 * The byte mean is only the no-run fallback: one episode exported from its own
 * watch screen has no run, and its bytes are the only progress there is.
 */
export function exportRingProgress(
  runProgress: SeriesExportRunProgress | null | undefined,
  exportUnits: number,
  exportingCount: number,
): number {
  if (runProgress != null && runProgress.total > 0) {
    return clampFraction((runProgress.saved + exportUnits) / runProgress.total)
  }
  return exportingCount === 0 ? 0 : exportUnits / exportingCount
}

export function deriveSeriesDownloadState(
  episodeSlugs: readonly string[],
  downloadedSlugs: readonly string[],
  offlineRecords: readonly OfflineDownloadRecord[],
  // Episodes queued for a re-download SWAP: still `downloaded` (their old copy is
  // playable) but not yet replaced. Counting them as done would make the ring
  // read ~full during a re-download; they count 0 so it fills from scratch.
  pendingSwapSlugs: ReadonlySet<string> = NO_PENDING_SWAPS,
  exportSession?: ExportSessionSnapshot | null,
  // The live series export run, when one covers this series. It outlives each
  // episode's session entry, so it is also what keeps the row in its exporting
  // state across the gap between two episodes.
  runProgress?: SeriesExportRunProgress | null,
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
      // A pending re-download keeps the batch bar up and contributes 0 units,
      // so the ring reflects re-downloading the whole series from scratch.
      if (pendingSwapSlugs.has(slug)) inProgress = true
      else units += 1
    } else if (IN_PROGRESS_STATES.has(record.state)) {
      inProgress = true
      inFlightSlugs.push(slug)
      // Only a live transfer counts as downloading: under the sequential batch
      // queue (R14) episodes sit `queued` long-term, and counting them as active
      // would keep pausedAggregate false after Pause all — no Resume all, ever.
      if (record.state === "paused") anyPaused = true
      else if (record.state === "downloading") anyDownloading = true
      if (record.totalBytes > 0) {
        const fraction = record.bytesWritten / record.totalBytes
        units += Math.max(0, Math.min(1, fraction))
      }
    }
  }

  const exportingSlugs: string[] = []
  let exportUnits = 0
  let anyExportRunning = false
  for (const slug of episodeSlugs) {
    const entry = exportSession?.byTarget[slug]
    if (!entry) continue
    exportingSlugs.push(slug)
    exportUnits += clampFraction(entry.progress)
    if (!entry.paused) anyExportRunning = true
  }

  const total = episodeSlugs.length
  return {
    // N counts only completed copies; failed records are excluded (they are
    // neither in downloadedSlugs nor an in-progress state). A pending re-download
    // is excluded too, so "N of M" climbs from 0 as each swap finishes.
    downloaded: episodeSlugs.filter(
      (slug) => downloaded.has(slug) && !pendingSwapSlugs.has(slug),
    ).length,
    total,
    inProgress,
    pausedAggregate: anyPaused && !anyDownloading,
    inFlightSlugs,
    progress: total === 0 ? 0 : units / total,
    exporting: exportingSlugs.length > 0 || runProgress != null,
    exportProgress: exportRingProgress(
      runProgress,
      exportUnits,
      exportingSlugs.length,
    ),
    exportingSlugs,
    // Mirrors `pausedAggregate`: the row shows a resume only when NOTHING is
    // still transferring, so one running episode keeps the pause glyph.
    pausedExport: exportingSlugs.length > 0 && !anyExportRunning,
  }
}

/** Every episode has a completed offline copy — drives the "all done" tick. */
export function seriesAllDownloaded(state: SeriesDownloadState): boolean {
  return state.total > 0 && state.downloaded >= state.total
}

// ── Per-episode grid badge (U9) ─────────────────────────────────────

export type EpisodeBadgeState =
  | "saved"
  | "downloading"
  | "queued"
  | "paused"
  | "exporting"
  | "exporting-paused"
  | "none"

/** Badge state for one episode from its record; `none` for failed/absent. */
export function episodeBadgeState(
  record: OfflineDownloadRecord | undefined,
  exporting = false,
  exportPaused = false,
): EpisodeBadgeState {
  // R16: a running export outranks the offline state beneath it. A HELD one
  // says so, the way a held offline download does — the badge is the only
  // place a paused episode is named, since the row speaks for the whole run.
  if (exporting) return exportPaused ? "exporting-paused" : "exporting"
  switch (record?.state) {
    case "downloaded":
      return "saved"
    case "downloading":
      return "downloading"
    case "queued":
      return "queued"
    case "paused":
      return "paused"
    default:
      return "none"
  }
}

/** slug → badge state for the grid (derived read-side, no persisted field). */
export function deriveEpisodeBadges(
  episodeSlugs: readonly string[],
  offlineRecords: readonly OfflineDownloadRecord[],
  // Membership, NOT the whole snapshot: a badge only asks WHETHER a target is
  // exporting, and the snapshot changes identity on every progress tick.
  exportingTargets?: ReadonlySet<string> | null,
  pausedExportTargets?: ReadonlySet<string> | null,
): Map<string, EpisodeBadgeState> {
  const recordBySlug = new Map(
    offlineRecords.map((record) => [record.videoSlug, record] as const),
  )
  const badges = new Map<string, EpisodeBadgeState>()
  for (const slug of episodeSlugs) {
    badges.set(
      slug,
      episodeBadgeState(
        recordBySlug.get(slug),
        exportingTargets?.has(slug) === true,
        pausedExportTargets?.has(slug) === true,
      ),
    )
  }
  return badges
}

// The Download button's spoken label for the settled states — the in-progress /
// paused a11y is now the ring's own tap-hint (SeriesActionRow), so only the
// idle / partial / all-downloaded labels are reachable here.
export function seriesDownloadLabel(state: SeriesDownloadState): string {
  const { downloaded, total } = state
  if (seriesAllDownloaded(state)) return "All downloaded"
  if (downloaded > 0) return `${downloaded} of ${total} downloaded`
  return "Download all"
}
