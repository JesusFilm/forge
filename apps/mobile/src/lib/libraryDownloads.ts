import type { UiT } from "../i18n/useT"
import { compareIds } from "./collation"
import type {
  OfflineDownloadRecord,
  OfflineDownloadState,
} from "./offlineManifest"

/**
 * Pure Library view-model: grouping, ordering, row-state, storage math, and
 * formatters over DownloadsProvider's records. No React/RN/network — U4/U5
 * own all presentation (colors/icons/JSX) and consume these plain shapes.
 */

// ── byte accounting ────────────────────────────────────────────────────

const IN_FLIGHT_STATES: ReadonlySet<OfflineDownloadState> = new Set([
  "downloading",
  "paused",
  "queued",
])

/** A record's display title. A legacy record stored without one shows its
 *  slug as words, so the list row and the rail tile always agree. */
export function recordTitle(record: OfflineDownloadRecord): string {
  return (
    record.title ||
    record.videoSlug
      .split("-")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  )
}

/**
 * Bytes credited for storage/selection math: a finished copy's full size, an
 * in-flight transfer's bytes written so far — and a mid-swap record BOTH (its
 * old committed copy and new partial share the disk). Everything else is 0.
 */
export function effectiveDownloadBytes(record: OfflineDownloadRecord): number {
  if (record.swapFrom != null) {
    return record.swapFrom.totalBytes + record.bytesWritten
  }
  if (record.state === "downloaded") return record.totalBytes
  if (IN_FLIGHT_STATES.has(record.state) && record.bytesWritten > 0) {
    return record.bytesWritten
  }
  return 0
}

// ── formatters ──────────────────────────────────────────────────────────

/**
 * Byte formatter matching the mockup's `fmtMB` shape: sub-1000-MB values
 * round to whole MB; at/above 1000 MB it rolls to GB with a trailing ".0"
 * trimmed (e.g. 1500 MB -> "1.5 GB", 2000 MB -> "2 GB").
 */
export function formatLibraryBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1000) {
    return `${(mb / 1000).toFixed(1).replace(/\.0$/, "")} GB`
  }
  return `${Math.round(mb)} MB`
}

/** m:ss (h:mm:ss above an hour); null (no badge) when duration is absent. */
export function formatLibraryDuration(
  durationSeconds: number | undefined,
): string | null {
  if (durationSeconds == null || durationSeconds < 0) return null
  const pad = (n: number) => n.toString().padStart(2, "0")
  const hours = Math.floor(durationSeconds / 3600)
  const mins = Math.floor((durationSeconds % 3600) / 60)
  const secs = Math.floor(durationSeconds % 60)
  return hours > 0
    ? `${hours}:${pad(mins)}:${pad(secs)}`
    : `${mins}:${pad(secs)}`
}

// ── row-state mapping (R6) ─────────────────────────────────────────────

export type LibraryRowAffordance =
  | "check"
  | "ring"
  | "resume"
  | "retry"
  | "none"

/** A row's control and progress, with no text. */
export type LibraryRowAffordanceState = {
  affordance: LibraryRowAffordance
  /** 0..1; present only when affordance === "ring". */
  progress?: number
}

export type LibraryRowState = LibraryRowAffordanceState & {
  subtitle: string
}

/**
 * One offline record's row state — the single source of truth that the list
 * row and the My Watch rail tile both read. A mid-swap record's `state` is
 * "downloading" even though the old copy is still the playable truth (R6) —
 * `swapFrom`, not `state`, decides.
 */
export function libraryRowAffordance(
  record: OfflineDownloadRecord,
): LibraryRowAffordanceState {
  if (record.swapFrom != null) return { affordance: "check" }
  switch (record.state) {
    case "downloaded":
      return { affordance: "check" }
    case "downloading":
      return {
        affordance: "ring",
        progress:
          record.totalBytes > 0
            ? Math.max(0, Math.min(1, record.bytesWritten / record.totalBytes))
            : 0,
      }
    case "queued":
      return { affordance: "none" }
    case "paused":
      return { affordance: "resume" }
    case "failed":
      return { affordance: "retry" }
    case "canceled":
    default:
      // Unreachable — the provider filters canceled out of offlineRecords.
      // Degrade to the idle shape rather than throw.
      return { affordance: "none" }
  }
}

/** The list row's descriptor: the shared state plus its subtitle. */
export function libraryRowState(
  record: OfflineDownloadRecord,
  t: UiT<"Library">,
): LibraryRowState {
  const state = libraryRowAffordance(record)
  return { ...state, subtitle: rowSubtitle(record, state, t) }
}

function rowSubtitle(
  record: OfflineDownloadRecord,
  state: LibraryRowAffordanceState,
  t: UiT<"Library">,
): string {
  switch (state.affordance) {
    case "check":
      return t("downloadedStatus", {
        size: formatLibraryBytes((record.swapFrom ?? record).totalBytes),
      })
    case "ring":
      // No words, so the format stays here rather than in the catalog.
      return `${Math.round((state.progress ?? 0) * 100)}% · ${formatLibraryBytes(record.totalBytes)}`
    case "resume":
      return t("paused")
    case "retry":
      return t("failed")
    case "none":
    default:
      return t("queued")
  }
}

// ── grouping + ordering (R4/R7/R22) ────────────────────────────────────

export type LibrarySeriesGroup = {
  seriesSlug: string
  seriesTitle: string
  episodeCount: number
  combinedBytes: number
  failedEpisodeCount: number
  episodes: OfflineDownloadRecord[]
}

export type LibraryViewModel = {
  seriesGroups: LibrarySeriesGroup[]
  standaloneRecords: OfflineDownloadRecord[]
}

/**
 * Content equality for memoized series cards: scalar fields plus per-index
 * episode record IDENTITY — a rebuilt wrapper with unchanged members is equal,
 * so a progress tick only re-renders the card whose episode actually changed.
 */
export function seriesGroupContentEqual(
  a: LibrarySeriesGroup,
  b: LibrarySeriesGroup,
): boolean {
  if (a === b) return true
  return (
    a.seriesSlug === b.seriesSlug &&
    a.seriesTitle === b.seriesTitle &&
    a.episodeCount === b.episodeCount &&
    a.combinedBytes === b.combinedBytes &&
    a.failedEpisodeCount === b.failedEpisodeCount &&
    a.episodes.length === b.episodes.length &&
    a.episodes.every((episode, i) => episode === b.episodes[i])
  )
}

/** Shared comparator: a known time wins; missing time sorts last, tie-broken
 *  by a stable key so output order never depends on input order. */
export function compareByTime(
  aTime: number | undefined,
  bTime: number | undefined,
  aKey: string,
  bKey: string,
  order: "newestFirst" | "oldestFirst",
): number {
  if (aTime == null && bTime == null) return compareIds(aKey, bKey)
  if (aTime == null) return 1
  if (bTime == null) return -1
  return order === "newestFirst" ? bTime - aTime : aTime - bTime
}

function compareEpisodes(
  a: OfflineDownloadRecord,
  b: OfflineDownloadRecord,
): number {
  const aIdx = a.seriesEpisodeIndex
  const bIdx = b.seriesEpisodeIndex
  if (aIdx != null && bIdx != null) return aIdx - bIdx
  if (aIdx != null || bIdx != null) return aIdx != null ? -1 : 1
  // Neither has an episode index (legacy record) — fall back to the order
  // they were enqueued in, oldest first.
  return compareByTime(
    a.enqueuedAt,
    b.enqueuedAt,
    a.videoSlug,
    b.videoSlug,
    "oldestFirst",
  )
}

export function newestEnqueuedAt(
  records: readonly OfflineDownloadRecord[],
): number | undefined {
  let max: number | undefined
  for (const record of records) {
    if (record.enqueuedAt != null && (max == null || record.enqueuedAt > max)) {
      max = record.enqueuedAt
    }
  }
  return max
}

/** Groups records by seriesSlug (else standalone) and orders both lists. */
export function buildLibraryViewModel(
  records: readonly OfflineDownloadRecord[],
): LibraryViewModel {
  const bySeriesSlug = new Map<string, OfflineDownloadRecord[]>()
  const standaloneRecords: OfflineDownloadRecord[] = []
  for (const record of records) {
    if (record.seriesSlug) {
      const group = bySeriesSlug.get(record.seriesSlug)
      if (group) group.push(record)
      else bySeriesSlug.set(record.seriesSlug, [record])
    } else {
      standaloneRecords.push(record)
    }
  }

  const seriesGroups: LibrarySeriesGroup[] = Array.from(
    bySeriesSlug.entries(),
  ).map(([seriesSlug, episodes]) => ({
    seriesSlug,
    seriesTitle: episodes.find((e) => e.seriesTitle)?.seriesTitle ?? seriesSlug,
    episodeCount: episodes.length,
    combinedBytes: episodes.reduce(
      (sum, e) => sum + effectiveDownloadBytes(e),
      0,
    ),
    failedEpisodeCount: episodes.filter((e) => e.state === "failed").length,
    episodes: [...episodes].sort(compareEpisodes),
  }))

  seriesGroups.sort((a, b) =>
    compareByTime(
      newestEnqueuedAt(a.episodes),
      newestEnqueuedAt(b.episodes),
      a.seriesSlug,
      b.seriesSlug,
      "newestFirst",
    ),
  )
  standaloneRecords.sort((a, b) =>
    compareByTime(
      a.enqueuedAt,
      b.enqueuedAt,
      a.videoSlug,
      b.videoSlug,
      "newestFirst",
    ),
  )

  return { seriesGroups, standaloneRecords }
}
