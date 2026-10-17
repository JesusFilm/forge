// The catalog snapshot (KTD7): the translations the app may show, as
// scripts/build-bible-data.mjs writes them to assets/bible/catalog.bible.
// Keep this file free of runtime imports other than ../text, for that script.
import { BIBLE_BOOKS, isUsfmBookId, type UsfmBookId } from "../text/books"
import type { TextDirection } from "../text/types"

/** Increase this when the stored shape changes, so the app refuses old files. */
export const CATALOG_FORMAT_VERSION = 1

/** One translation as the snapshot file stores it. */
export type StoredCatalogTranslation = {
  /** The bible.helloao.org id, for example `rus_syn`. */
  id: string
  /** ISO 639-3, for example `rus`. */
  language: string
  /** The language's own name, for example `русский`. */
  languageName: string
  languageEnglishName: string
  /** The translation's own name. */
  name: string
  englishName: string
  shortName: string
  textDirection: TextDirection
  /** True when the translation has all 66 books. */
  complete: boolean
  /** The copyright line the reader shows (R23, R26). */
  credit: string
  /** The catalog's content hash, the key for kept chapters (KTD2). */
  sha256: string
  /** The size of complete.json that a download writes (R29, KTD4). */
  downloadBytes: number
  /** The books it has, as canon-order ranges: `GEN-REV`, `MAT-REV`. */
  books: string
}

/** One translation, with its books as a set for the R25 fallback. */
export type CatalogTranslation = Omit<StoredCatalogTranslation, "books"> & {
  books: ReadonlySet<UsfmBookId>
}

export type Catalog = {
  /** In the stored order, which is by id. */
  translations: readonly CatalogTranslation[]
  byId: ReadonlyMap<string, CatalogTranslation>
}

export type StoredCatalog = {
  formatVersion: typeof CATALOG_FORMAT_VERSION
  translations: StoredCatalogTranslation[]
}

const ORDER: ReadonlyMap<string, number> = new Map(
  BIBLE_BOOKS.map((book, index) => [book.usfm, index]),
)
const SHA256 = /^[0-9a-f]{64}$/

/** Writes a set of book ids as canon-order ranges. It ignores unknown ids. */
export function encodeBookSet(bookIds: Iterable<string>): string {
  const indexes = [...new Set(bookIds)]
    .map((id) => ORDER.get(id))
    .filter((index) => index !== undefined)
    .sort((a, b) => a - b)
  const runs: string[] = []
  let start = 0
  for (let i = 1; i <= indexes.length; i += 1) {
    if (i < indexes.length && indexes[i] === (indexes[i - 1] ?? 0) + 1) {
      continue
    }
    const first = BIBLE_BOOKS[indexes[start] ?? 0].usfm
    const last = BIBLE_BOOKS[indexes[i - 1] ?? 0].usfm
    runs.push(first === last ? first : `${first}-${last}`)
    start = i
  }
  return runs.join(" ")
}

/** Reads ranges back. A bad id, a reversed range, or a repeat gives null. */
export function decodeBookSet(text: string): ReadonlySet<UsfmBookId> | null {
  const books = new Set<UsfmBookId>()
  let previous = -1
  for (const run of text.split(" ")) {
    const [first = "", last = first, extra] = run.split("-")
    if (extra !== undefined || !isUsfmBookId(first) || !isUsfmBookId(last)) {
      return null
    }
    const from = ORDER.get(first) ?? -1
    const to = ORDER.get(last) ?? -1
    if (from <= previous || to < from) return null
    for (let index = from; index <= to; index += 1) {
      books.add(BIBLE_BOOKS[index].usfm)
    }
    previous = to
  }
  return books
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function parseEntry(raw: unknown): CatalogTranslation | null {
  if (!isRecord(raw)) return null
  const {
    id,
    language,
    languageName,
    languageEnglishName,
    name,
    englishName,
    shortName,
    textDirection,
    complete,
    credit,
    sha256,
    downloadBytes,
    books,
  } = raw
  if (
    !isFilled(id) ||
    !isFilled(language) ||
    !isFilled(languageName) ||
    !isFilled(languageEnglishName) ||
    !isFilled(name) ||
    !isFilled(englishName) ||
    !isFilled(shortName) ||
    (textDirection !== "ltr" && textDirection !== "rtl") ||
    typeof complete !== "boolean" ||
    !isFilled(credit) ||
    typeof sha256 !== "string" ||
    !SHA256.test(sha256) ||
    typeof downloadBytes !== "number" ||
    !Number.isInteger(downloadBytes) ||
    downloadBytes <= 0 ||
    typeof books !== "string"
  ) {
    return null
  }
  const bookSet = decodeBookSet(books)
  if (bookSet === null || complete !== (bookSet.size === BIBLE_BOOKS.length)) {
    return null
  }
  return {
    id,
    language,
    languageName,
    languageEnglishName,
    name,
    englishName,
    shortName,
    textDirection,
    complete,
    credit,
    sha256,
    downloadBytes,
    books: bookSet,
  }
}

/** Reads the snapshot. Any bad entry refuses the whole file (fail-closed). */
export function parseCatalog(raw: unknown): Catalog | null {
  if (
    !isRecord(raw) ||
    raw.formatVersion !== CATALOG_FORMAT_VERSION ||
    !Array.isArray(raw.translations) ||
    raw.translations.length === 0
  ) {
    return null
  }
  const stored: readonly unknown[] = raw.translations
  const translations: CatalogTranslation[] = []
  const byId = new Map<string, CatalogTranslation>()
  for (const item of stored) {
    const entry = parseEntry(item)
    if (entry === null || byId.has(entry.id)) return null
    translations.push(entry)
    byId.set(entry.id, entry)
  }
  return { translations, byId }
}
