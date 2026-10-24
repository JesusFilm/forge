// A translation's own book names (owner, 2026-09-28), so a Korean reader sees
// 창세기, not Genesis. The bundled catalog has no names, so they come from
// `/api/<id>/books.json` and stay on the device after that.
import { isUsfmBookId, type UsfmBookId } from "../text/books"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import {
  BIBLE_API_BASE,
  fetchBoundedJson,
  type FetchLike,
} from "./fetchChapter"

/** Increase this when the stored shape changes, so the app refuses old files. */
export const BOOK_NAMES_FORMAT_VERSION = 1

/** About 6x the largest real file: mya_ojv books.json, 41 KB (2026-09-28). */
export const BOOK_NAMES_MAX_BYTES = 256 * 1024

/** A longer name is not a book name; that book keeps its English name. */
export const BOOK_NAME_MAX_LENGTH = 80

export type BookNames = ReadonlyMap<UsfmBookId, string>

/** Which names: the id, and the catalog hash that says when they change. */
export type BookNamesKey = { id: string; sha256: string }

export function bookNamesUrl(translationId: string): string {
  return `${BIBLE_API_BASE}/${encodeURIComponent(translationId)}/books.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  if (name.length === 0 || [...name].length > BOOK_NAME_MAX_LENGTH) return null
  return name
}

/** The same order as the chapter file's name (normalize.ts), so the picker
 *  and the passage pill agree. */
function nameOf(book: Record<string, unknown>): string | null {
  return (
    cleanName(book.commonName) ?? cleanName(book.name) ?? cleanName(book.title)
  )
}

/** Reads `books.json`. A file for another translation, or with no names, is
 *  null; a single bad book only loses its own name. */
export function parseBooksFile(
  raw: unknown,
  translationId: string,
): BookNames | null {
  if (!isRecord(raw) || !isRecord(raw.translation)) return null
  if (raw.translation.id !== translationId || !Array.isArray(raw.books)) {
    return null
  }
  const books: readonly unknown[] = raw.books
  const names = new Map<UsfmBookId, string>()
  for (const book of books) {
    if (!isRecord(book)) continue
    const { id } = book
    if (typeof id !== "string" || !isUsfmBookId(id) || names.has(id)) continue
    const name = nameOf(book)
    if (name !== null) names.set(id, name)
  }
  return names.size > 0 ? names : null
}

/** The names a download already holds, one per book. */
export function bookNamesFromBooks(
  books: readonly { bookId: UsfmBookId; bookName: string }[],
): BookNames | null {
  const names = new Map<UsfmBookId, string>()
  for (const { bookId, bookName } of books) {
    const name = cleanName(bookName)
    if (name !== null && !names.has(bookId)) names.set(bookId, name)
  }
  return names.size > 0 ? names : null
}

type StoredNames = { sha256: string; names: BookNames }

export function storedBookNamesText(
  key: BookNamesKey,
  names: BookNames,
): string {
  return JSON.stringify({
    formatVersion: BOOK_NAMES_FORMAT_VERSION,
    translationId: key.id,
    sha256: key.sha256,
    names: Object.fromEntries(names),
  })
}

export function parseStoredBookNames(
  raw: unknown,
  translationId: string,
): StoredNames | null {
  if (
    !isRecord(raw) ||
    raw.formatVersion !== BOOK_NAMES_FORMAT_VERSION ||
    raw.translationId !== translationId ||
    typeof raw.sha256 !== "string" ||
    !isRecord(raw.names)
  ) {
    return null
  }
  const names = new Map<UsfmBookId, string>()
  for (const [id, value] of Object.entries(raw.names)) {
    const name = cleanName(value)
    if (isUsfmBookId(id) && name !== null) names.set(id, name)
  }
  return names.size > 0 ? { sha256: raw.sha256, names } : null
}

export type BookNamesStore = {
  /** The names in memory, or null. It never starts a read. */
  peek(id: string): BookNames | null
  /** Memory, then the device, then the network. It never rejects; null
   *  means English names. Two calls for one translation share one read. */
  load(key: BookNamesKey): Promise<BookNames | null>
  /** Keeps names the app already has, for example from a download. */
  keep(key: BookNamesKey, names: BookNames): void
  subscribe(listener: () => void): () => void
}

export type BookNamesStoreOptions = {
  fetchNames: (translationId: string) => Promise<BookNames | null>
  /** The parsed stored file, or null. It never rejects. */
  readStored: (translationId: string) => Promise<unknown>
  writeStored: (translationId: string, text: string) => void
}

// BSB's names are the app's own English names, so BSB reads nothing. Old names
// (another catalog hash) still show while a fresh read runs, and stay when the
// read fails: a book is rarely renamed, and English is the worse fallback.
export function createBookNamesStore(
  options: BookNamesStoreOptions,
): BookNamesStore {
  const known = new Map<string, StoredNames>()
  const inflight = new Map<string, Promise<BookNames | null>>()
  const listeners = new Set<() => void>()

  function publish(): void {
    for (const listener of [...listeners]) listener()
  }

  function remember(id: string, entry: StoredNames): void {
    const previous = known.get(id)
    if (previous?.sha256 === entry.sha256 && previous.names === entry.names) {
      return
    }
    known.set(id, entry)
    publish()
  }

  async function read(key: BookNamesKey): Promise<BookNames | null> {
    const { id, sha256 } = key
    if (!known.has(id)) {
      const stored = parseStoredBookNames(await options.readStored(id), id)
      if (stored) remember(id, stored)
    }
    const current = known.get(id)
    if (current?.sha256 === sha256) return current.names
    const fetched = await options.fetchNames(id)
    if (!fetched) return current?.names ?? null
    remember(id, { sha256, names: fetched })
    try {
      options.writeStored(id, storedBookNamesText(key, fetched))
    } catch {
      // The names still show; the next open reads them again.
    }
    return fetched
  }

  return {
    peek(id) {
      return known.get(id)?.names ?? null
    },
    load(key) {
      if (key.id === BSB_TRANSLATION_ID) return Promise.resolve(null)
      const current = known.get(key.id)
      if (current?.sha256 === key.sha256) return Promise.resolve(current.names)
      const running = inflight.get(key.id)
      if (running) return running
      const flight = read(key).catch(() => known.get(key.id)?.names ?? null)
      inflight.set(key.id, flight)
      const release = () => {
        if (inflight.get(key.id) === flight) inflight.delete(key.id)
      }
      void flight.then(release, release)
      return flight
    },
    keep(key, names) {
      if (key.id === BSB_TRANSLATION_ID) return
      remember(key.id, { sha256: key.sha256, names })
      try {
        options.writeStored(key.id, storedBookNamesText(key, names))
      } catch {
        // Memory still has them for this session.
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** One network read of `books.json`, with the chapter fetch's limits. */
export async function fetchBookNames(
  translationId: string,
  fetchImpl?: FetchLike,
): Promise<BookNames | null> {
  const result = await fetchBoundedJson(bookNamesUrl(translationId), {
    fetchImpl,
    maxBytes: BOOK_NAMES_MAX_BYTES,
  })
  return result.status === "ok"
    ? parseBooksFile(result.raw, translationId)
    : null
}
