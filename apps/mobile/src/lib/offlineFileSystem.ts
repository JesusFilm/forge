import {
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getFreeDiskStorageAsync,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
} from "expo-file-system/legacy"

import { sanitizeSegment } from "./offlineFiles"

/**
 * Filesystem I/O for offline downloads (expo-file-system legacy). Split from the
 * pure `offlineFiles` path builders so those stay unit-testable; all ops here are
 * best-effort and never throw (a failure must not crash boot or the UI). Offline
 * root lives under the persistent document directory; OS-backup exclusion is the
 * download module's config plugin on media files, not this layer.
 */

/** Persistent offline-download root (document directory ends with a slash). */
export const OFFLINE_ROOT = `${documentDirectory ?? ""}offline-downloads`

/** Per-video directory under the offline root (slug sanitized). */
export function offlineVideoDir(videoSlug: string): string {
  return `${OFFLINE_ROOT}/${sanitizeSegment(videoSlug)}`
}

/** Ensure a video's directory exists; returns the directory path. */
export async function ensureVideoDir(videoSlug: string): Promise<string> {
  const dir = offlineVideoDir(videoSlug)
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined)
  return dir
}

export async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await getInfoAsync(uri)
    return info.exists
  } catch {
    return false
  }
}

export async function removeUri(uri: string): Promise<void> {
  await deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}

/** Remove a video's entire offline directory (media + sidecars). */
export async function removeVideoDir(videoSlug: string): Promise<void> {
  await removeUri(offlineVideoDir(videoSlug))
}

/** Available internal storage in bytes (0 if unavailable). */
export async function freeDiskBytes(): Promise<number> {
  try {
    return await getFreeDiskStorageAsync()
  } catch {
    return 0
  }
}

/** Move a file (e.g. a verified pending download → its committed path). */
export async function moveFile(from: string, to: string): Promise<void> {
  await moveAsync({ from, to })
}

/**
 * Download a small sidecar (subtitle VTT, poster) to a local file. Used for
 * foreground sidecar transfers; the large media file goes through the native
 * background engine, not here.
 */
export async function downloadToFile(url: string, dest: string): Promise<void> {
  // Race a 30s deadline so a stalled CDN can't block finalize (and the iOS
  // background-completion signal that follows it) indefinitely. Callers treat a
  // throw as a terminal sidecar failure and degrade gracefully.
  await Promise.race([
    downloadAsync(url, dest),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("downloadToFile timeout")), 30_000),
    ),
  ])
}
