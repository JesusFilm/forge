// Chapters read on the fly, one file each under `Paths.cache` (KTD2, R28).
// A path holds translation, book, chapter, and catalog sha256. Past the cap,
// the oldest go first; downloads live elsewhere, so it never removes one.
import { Directory, File } from "expo-file-system"

import { isUsfmBookId, type UsfmBookId } from "../text/books"
import { parseChapterText } from "../text/normalize"
import type { ChapterText } from "../text/types"
import type { ChapterAddress } from "./fetchChapter"
import {
  chapterCacheDirectory,
  deleteQuietly,
  ensureDirectory,
  isSafeTranslationId,
  isSha256,
} from "./storage"

export { chapterCacheDirectory }

/** About 3,000 chapters (KD24). */
export const CHAPTER_CACHE_MAX_BYTES = 30 * 1024 * 1024

/** A chapter address plus the catalog `sha256` at the time of the read. */
export type ChapterCacheKey = ChapterAddress & { sha256: string }

export type KeptChapter = {
  text: ChapterText
  /** True when the cache holds it under another catalog `sha256`. */
  stale: boolean
}

export type ChapterCache = {
  /** The kept chapter: this `sha256` first, else the newest other version. */
  read(key: ChapterCacheKey): Promise<KeptChapter | null>
  /** True when any version of the chapter is on the device. */
  has(address: ChapterAddress): boolean
  /** Keeps a chapter and removes its older versions. False when it fails. */
  write(key: ChapterCacheKey, text: ChapterText): boolean
  usedBytes(): number
}

export type ChapterCacheOptions = {
  directory?: () => Directory
  maxBytes?: number
}

type KeptName = { bookId: UsfmBookId; chapter: number; sha256: string }

type Entry = {
  /** Empty for a stray file at the root. */
  translationId: string
  name: string
  /** Null for a file that is not a kept chapter; it still counts and ages. */
  kept: KeptName | null
  bytes: number
  keptAt: number
  /** Breaks a tie between two equal modification times. */
  order: number
}

const KEPT_NAME = /^([0-9A-Z]{3})\.([1-9]\d*)\.([0-9a-f]{64})\.json$/

function fileName(key: ChapterCacheKey): string {
  return `${key.bookId}.${key.chapter}.${key.sha256}.json`
}

function parseName(name: string): KeptName | null {
  const match = KEPT_NAME.exec(name)
  const bookId = match?.[1] ?? ""
  if (!match || !isUsfmBookId(bookId)) return null
  return { bookId, chapter: Number(match[2]), sha256: match[3] ?? "" }
}

function isChapterOf(text: ChapterText, address: ChapterAddress): boolean {
  return (
    text.translationId === address.translationId &&
    text.bookId === address.bookId &&
    text.chapter.number === address.chapter
  )
}

export function createChapterCache(
  options: ChapterCacheOptions = {},
): ChapterCache {
  const directory = options.directory ?? chapterCacheDirectory
  const maxBytes = options.maxBytes ?? CHAPTER_CACHE_MAX_BYTES
  // Built from one directory scan on first use, then kept in step.
  let entries: Map<string, Entry> | null = null
  let total = 0
  let order = 0

  function entryKey(translationId: string, name: string): string {
    return `${translationId}/${name}`
  }

  function fileOf(entry: Entry): File {
    return entry.translationId
      ? new File(directory(), entry.translationId, entry.name)
      : new File(directory(), entry.name)
  }

  function track(map: Map<string, Entry>, translationId: string, file: File) {
    const entry: Entry = {
      translationId,
      name: file.name,
      kept: translationId ? parseName(file.name) : null,
      bytes: file.size ?? 0,
      keptAt: file.modificationTime ?? 0,
      order: order++,
    }
    const id = entryKey(translationId, entry.name)
    const previous = map.get(id)
    if (previous) total -= previous.bytes
    map.set(id, entry)
    total += entry.bytes
  }

  function index(): Map<string, Entry> {
    if (entries) return entries
    const map = new Map<string, Entry>()
    total = 0
    try {
      const root = directory()
      if (root.exists) {
        for (const child of root.list()) {
          if (child instanceof File) {
            track(map, "", child)
          } else {
            for (const item of child.list()) {
              if (item instanceof File) track(map, child.name, item)
            }
          }
        }
      }
    } catch {
      // An unreadable directory counts as empty; writes rebuild it.
    }
    entries = map
    return map
  }

  function remove(entry: Entry): void {
    deleteQuietly(fileOf(entry))
    if (entries?.delete(entryKey(entry.translationId, entry.name))) {
      total -= entry.bytes
    }
  }

  function versionsOf(address: ChapterAddress): Entry[] {
    const found: Entry[] = []
    for (const entry of index().values()) {
      if (
        entry.translationId === address.translationId &&
        entry.kept?.bookId === address.bookId &&
        entry.kept.chapter === address.chapter
      ) {
        found.push(entry)
      }
    }
    return found
  }

  function evictOldest(): void {
    if (total <= maxBytes) return
    const oldestFirst = [...index().values()].sort(
      (a, b) => a.keptAt - b.keptAt || a.order - b.order,
    )
    for (const entry of oldestFirst) {
      if (total <= maxBytes) return
      remove(entry)
    }
  }

  async function readKept(
    entry: Entry,
    address: ChapterAddress,
  ): Promise<ChapterText | null> {
    try {
      const parsed = parseChapterText(JSON.parse(await fileOf(entry).text()))
      if (parsed.status === "ok" && isChapterOf(parsed.value, address)) {
        return parsed.value
      }
    } catch {
      // Missing, unreadable, or not JSON: a miss.
    }
    return null
  }

  return {
    async read(key) {
      if (!isSafeTranslationId(key.translationId)) return null
      const versions = versionsOf(key)
      const exact = versions.find((entry) => entry.kept?.sha256 === key.sha256)
      const entry =
        exact ??
        versions.sort((a, b) => b.keptAt - a.keptAt || b.order - a.order)[0]
      if (!entry) return null
      const text = await readKept(entry, key)
      if (!text) {
        remove(entry)
        return null
      }
      return { text, stale: entry !== exact }
    },

    has(address) {
      if (!isSafeTranslationId(address.translationId)) return false
      // The system may clear the cache while the app runs.
      return versionsOf(address).some((entry) => fileOf(entry).exists)
    },

    write(key, text) {
      if (
        !isSafeTranslationId(key.translationId) ||
        !isSha256(key.sha256) ||
        !isChapterOf(text, key)
      ) {
        return false
      }
      const folder = new Directory(directory(), key.translationId)
      if (!ensureDirectory(folder)) return false
      const map = index()
      const file = new File(folder, fileName(key))
      try {
        file.write(JSON.stringify(text))
      } catch {
        deleteQuietly(file)
        return false
      }
      track(map, key.translationId, file)
      for (const entry of versionsOf(key)) {
        if (entry.kept?.sha256 !== key.sha256) remove(entry)
      }
      evictOldest()
      return true
    },

    usedBytes() {
      index()
      return total
    },
  }
}
