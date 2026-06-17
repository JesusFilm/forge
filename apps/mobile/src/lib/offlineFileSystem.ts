import {
  deleteAsync,
  documentDirectory,
  getFreeDiskStorageAsync,
  getInfoAsync,
  makeDirectoryAsync,
} from "expo-file-system/legacy"

import { sanitizeSegment } from "./offlineFiles"

/**
 * Filesystem I/O for offline downloads (expo-file-system legacy). Kept separate
 * from the pure `offlineFiles` path builders so those stay unit-testable without
 * the native filesystem; this layer is typecheck-verified and exercised on
 * device. All ops are best-effort and never throw (a download/delete failure
 * must not crash boot or the UI).
 *
 * The offline root is under the app document directory (persistent). Excluding
 * it from OS backup is handled by the download module's config plugin on the
 * media files; this module only manages directories/sidecars under the root.
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
