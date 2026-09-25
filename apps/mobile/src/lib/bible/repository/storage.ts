// Where the repository keeps its files (feat-551 KTD2). Downloads live under
// `Paths.document`, which iOS never purges. Kept chapters and raw downloads
// live under `Paths.cache`, which the system may clear at any time.
import { Directory, File, Paths } from "expo-file-system"

const SAFE_TRANSLATION_ID = /^[A-Za-z0-9_-]+$/
const SHA256 = /^[0-9a-f]{64}$/

/** A catalog id is part of a file path, so only plain characters pass. */
export function isSafeTranslationId(id: string): boolean {
  return SAFE_TRANSLATION_ID.test(id)
}

export function isSha256(value: string): boolean {
  return SHA256.test(value)
}

export function chapterCacheDirectory(): Directory {
  return new Directory(Paths.cache, "bible", "chapters")
}

export function translationsDirectory(): Directory {
  return new Directory(Paths.document, "bible", "translations")
}

export function stagingDirectory(): Directory {
  return new Directory(Paths.cache, "bible", "downloads")
}

/** Creates a directory and its parents. It returns false when that fails. */
export function ensureDirectory(directory: Directory): boolean {
  try {
    directory.create({ intermediates: true, idempotent: true })
    return true
  } catch {
    return false
  }
}

export function deleteQuietly(entry: File | Directory): void {
  try {
    entry.delete()
  } catch {
    // Already gone, or the system holds it; the next check sees what is left.
  }
}
