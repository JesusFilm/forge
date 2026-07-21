import type { WatchDownload } from "./normalizeVideo"
import { STORAGE_RESERVE_BYTES } from "./offlineConstants"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
  type SwapFrom,
} from "./offlineManifest"

// Pure, React-free building blocks of the per-video Download Record lifecycle:
// request/record shapes and their tiny invariants, split from the
// createDownloadLifecycle factory so each file stays navigable (todo 013).

export type StartDownloadRequest = {
  videoSlug: string
  /** Human title stored on the record for the offline library. */
  title: string
  dubDocumentId: string
  /** The chosen rendition (documentId/quality/size/url) to download. */
  rendition: WatchDownload
  /** Chosen subtitle language slug, or null for "No subtitles". */
  subtitleLanguageSlug: string | null
  /** Fresh subtitle VTT URL when a subtitle was chosen, else null. */
  subtitleUrl: string | null
  /** Poster URL to cache for the offline library, if available. */
  posterUrl: string | null
  /** Per-download cellular override. */
  allowCellular: boolean
  /** Parent series slug, when this episode belongs to one. */
  seriesSlug?: string
  /** Parent series display title. */
  seriesTitle?: string
  /** Episode order within the series (series batch only; the watch route leaves it undefined). */
  seriesEpisodeIndex?: number
  /** Video runtime in seconds. */
  durationSeconds?: number
  /** Epoch ms when the download was enqueued. */
  enqueuedAt?: number
}

export type StartDownloadResult =
  | { ok: true }
  | {
      ok: false
      reason: "exists" | "insufficient-storage" | "error" | "canceled"
    }

/** A rendition's declared byte size; 0 when unknown (admin size is nullable). */
export function requestTotalBytes(request: StartDownloadRequest): number {
  return Number(request.rendition.size) || 0
}

/** Attempt-unique pending-path suffix so a retry never collides with a prior partial. */
export function newDownloadNonce(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(
    36,
  )}`
}

/** The states a fresh-from-request record can be written in (never terminal-downloaded). */
export type RequestRecordState = Extract<
  OfflineDownloadState,
  "queued" | "downloading" | "failed"
>

/**
 * The full record literal for a request in a given state — the single source of
 * the shape the batch pre-persist (`queued`), the start path (`downloading` +
 * pendingPath) and the pump's failed-resurface all write.
 */
export function buildRequestRecord(
  request: StartDownloadRequest,
  state: RequestRecordState,
  options?: { pendingPath?: string | null },
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug: request.videoSlug,
    dubDocumentId: request.dubDocumentId,
    renditionDocumentId: request.rendition.documentId,
    qualityLabel: request.rendition.quality,
    title: request.title,
    subtitleLanguageSlug: request.subtitleLanguageSlug,
    state,
    committedPath: null,
    pendingPath: options?.pendingPath ?? null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: requestTotalBytes(request),
    seriesSlug: request.seriesSlug,
    seriesTitle: request.seriesTitle,
    seriesEpisodeIndex: request.seriesEpisodeIndex,
    durationSeconds: request.durationSeconds,
    enqueuedAt: request.enqueuedAt,
  }
}

/**
 * Rebuild a StartDownloadRequest from a relaunched batch-placeholder record.
 * No media URL survives process death, so startDownload re-resolves; the empty
 * `url` fallback fails validation (failed badge), never a stale link.
 */
export function buildReattachRequest(
  record: OfflineDownloadRecord,
  allowCellular: boolean,
): StartDownloadRequest {
  return {
    videoSlug: record.videoSlug,
    title: record.title,
    dubDocumentId: record.dubDocumentId,
    rendition: {
      documentId: record.renditionDocumentId,
      quality: record.qualityLabel,
      size: record.totalBytes > 0 ? String(record.totalBytes) : "",
      url: "",
    },
    subtitleLanguageSlug: record.subtitleLanguageSlug,
    subtitleUrl: null,
    posterUrl: null,
    allowCellular,
    seriesSlug: record.seriesSlug,
    seriesTitle: record.seriesTitle,
    seriesEpisodeIndex: record.seriesEpisodeIndex,
    durationSeconds: record.durationSeconds,
    enqueuedAt: record.enqueuedAt,
  }
}

/**
 * Record fields that restore a mid-swap record to its pre-swap copy (AE2) — one
 * revert shape shared by the failure handlers and cancel, so the two paths can
 * never drift: restore identity + byte counts, clear pending/swap markers.
 */
export function swapRevertFields(
  swap: SwapFrom,
): Partial<OfflineDownloadRecord> {
  return {
    state: "downloaded",
    committedPath: swap.committedPath,
    renditionDocumentId: swap.renditionDocumentId,
    qualityLabel: swap.qualityLabel,
    subtitleLanguageSlug: swap.subtitleLanguageSlug,
    posterPath: swap.posterPath,
    totalBytes: swap.totalBytes,
    bytesWritten: swap.totalBytes,
    pendingPath: null,
    swapFrom: null,
  }
}

/**
 * Snapshot of the current committed copy taken before a swap begins (U8), the
 * exact fields swapRevertFields restores. committedPath passed separately so the
 * caller's non-null guard carries into the type.
 */
export function buildSwapSnapshot(
  existing: OfflineDownloadRecord,
  committedPath: string,
): SwapFrom {
  return {
    committedPath,
    renditionDocumentId: existing.renditionDocumentId,
    qualityLabel: existing.qualityLabel,
    subtitleLanguageSlug: existing.subtitleLanguageSlug,
    totalBytes: existing.totalBytes,
    posterPath: existing.posterPath,
  }
}

/**
 * Per-download storage gate (U12): block when size + reserve won't fit. free=0
 * means the API was unreadable — allow rather than block on an unperformed check
 * (the batch gate in seriesDownloadEnqueue deliberately blocks on unreadable free).
 */
export function isStorageBlocked(
  freeBytes: number,
  sizeBytes: number,
): boolean {
  return freeBytes > 0 && freeBytes < sizeBytes + STORAGE_RESERVE_BYTES
}

/**
 * Fire-and-forget telemetry sink injected by the provider (which owns the Datadog
 * import). Kept as a port so this pure module never pulls the native SDK — that
 * would break its unit tests, which run without the Datadog native binary.
 */
export type DownloadTelemetry = {
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
}

/**
 * R26: the per-attempt correlation id is the pending nonce, which is persisted in
 * `pendingPath` — so a next-launch terminal event derives the SAME id the
 * initiating session logged at begin, linking them across the process death.
 */
export function attemptIdFromPendingPath(pendingPath: string): string {
  return /\.pending-(.+)\.mp4$/.exec(pendingPath)?.[1] ?? pendingPath
}

export type RetryDownloadDeps = {
  getRecord: (videoSlug: string) => OfflineDownloadRecord | undefined
  restart: (record: OfflineDownloadRecord) => Promise<void>
  /** Release the slug's batch occupancy before restarting — a retried episode
   *  left in scope re-occupies the sequential slot and stalls queued siblings. */
  onLeaveBatchScope?: (videoSlug: string) => void
}

/**
 * D2/R21: retry only ever targets a currently-failed record via the engine's
 * restart — never a fresh start() (its resolution-failure path deletes the
 * record, and a retry has no persisted URL to build a request from anyway).
 */
export async function retryFailedDownload(
  deps: RetryDownloadDeps,
  videoSlug: string,
): Promise<void> {
  const record = deps.getRecord(videoSlug)
  if (record?.state !== "failed") return
  deps.onLeaveBatchScope?.(videoSlug)
  await deps.restart(record)
}
