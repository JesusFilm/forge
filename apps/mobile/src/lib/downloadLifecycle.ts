import type { WatchDownload } from "./normalizeVideo"
import { STORAGE_RESERVE_BYTES } from "./offlineConstants"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
  type SwapFrom,
} from "./offlineManifest"

// Pure, React-free building blocks of the per-video Download Record lifecycle.
// DownloadsProvider wires these into its orchestration; keeping the shapes here
// gives them a jest surface and one source of truth per invariant (todo 013).

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
