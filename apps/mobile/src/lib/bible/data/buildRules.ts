// Build-time rules for scripts/build-bible-data.mjs (KTD6, KTD7). Only that
// script and tests import this file, so none of it ships in the app bundle.
import { BIBLE_BOOKS, isUsfmBookId } from "../text/books"
import type { TextDirection } from "../text/types"
import {
  BSB_SYSTEM_ID,
  BSB_TRANSLATION_ID,
  classifyTranslation,
  resolveBookSystem,
  type BookChapters,
  type TranslationChapters,
} from "../versification/classify"
import {
  STANDARD_SYSTEM_IDS,
  type VersificationSystemId,
} from "../versification/compact"
import { VERSIFICATION_SYSTEMS } from "../versification/systems.generated"
import type { TranslationSystemOverride } from "../versification/translationSystemOverrides"
import { decodeBookSet, type StoredCatalogTranslation } from "./catalog"

/** The Goal Capsule stops the work when the catalog lacks either of these. */
export const REQUIRED_TRANSLATION_IDS = [BSB_TRANSLATION_ID, "rus_syn"] as const

/** BSB's license is its own statement, not an eBible.org row (KTD7). */
export const BSB_CREDIT =
  "This text of God's Word has been dedicated to the public domain."

export type EbibleLicense = { redistributable: boolean; copyright: string }

/** Facts that the script extracts from one complete.json. */
export type TextFacts = {
  /** The sha256 of the fetched file. */
  sha256: string
  /** The uncompressed size, which a device download writes. */
  bytes: number
  /** The books present, as `encodeBookSet` writes them. */
  books: string
  /** Verse numbers that the text covers, in the 66 books. */
  verses: number
  /** Per book: `encodeChapterFacts` of the discriminating chapters. */
  chapters: Readonly<Partial<Record<string, string>>>
}

export type TextFailure = { rejected: string } | { missing: number }

/** One catalog entry with the facts that the lock records for it. */
export type SourceRecord = {
  id: string
  name: string
  englishName: string
  shortName: string
  language: string
  languageName: string
  languageEnglishName: string
  textDirection: TextDirection
  sha256: string
  licenseUrl: string
  /** The eBible.org row that `licenseUrl` names, or null for none. */
  license: EbibleLicense | null
  /** Null when the license check dropped it before any fetch. */
  text: TextFacts | TextFailure | null
}

export type DropReason =
  | "no-ebible-id"
  | "no-ebible-match"
  | "not-redistributable"
  | "no-credit"
  | "source-missing"
  | "text-rejected"

export type LicenseDecision =
  | { kind: "keep"; credit: string }
  | { kind: "drop"; reason: DropReason }

export type KeptTranslation = SourceRecord & {
  credit: string
  text: TextFacts
  complete: boolean
}

export type LanguageCandidate = {
  id: string
  language: string
  complete: boolean
  verses: number
}

export type SystemOverrides = Readonly<
  Record<string, Readonly<Record<string, TranslationSystemOverride>>>
>

/** `main` (left out when eng), then each book that uses another system. */
export type TranslationSystemEntry = Partial<
  Record<string, VersificationSystemId>
>

export type SystemTableResult = {
  /** Only translations that are not plain `eng` in every book. */
  table: Record<string, TranslationSystemEntry>
  /** `id BOOK` for each book the classifier could not place. */
  unknown: string[]
  /** Books per system, over every kept translation and book it has. */
  bookCounts: Record<string, number>
  /** `id BOOK: <classifier result> -> <override>` for each applied override. */
  overridden: string[]
  /** Overrides that name a missing translation or book. */
  errors: string[]
}

export class BibleDataRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BibleDataRuleError"
  }
}

/** RFC 4180 rows. Drops a byte-order mark and a final empty line. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char !== '"') field += char
      else if (source[i + 1] === '"') {
        field += '"'
        i += 1
      } else quoted = false
    } else if (char === '"') quoted = true
    else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else if (char !== "\r") field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** eBible.org's translations.csv, by its `translationId` column. */
export function readEbibleLicenses(csv: string): Map<string, EbibleLicense> {
  const [header = [], ...rows] = parseCsv(csv)
  const idColumn = header.indexOf("translationId")
  const redistributableColumn = header.indexOf("Redistributable")
  const copyrightColumn = header.indexOf("Copyright")
  if (idColumn < 0 || redistributableColumn < 0 || copyrightColumn < 0) {
    return new Map()
  }
  const licenses = new Map<string, EbibleLicense>()
  for (const row of rows) {
    const id = row[idColumn]
    if (!id || row.length !== header.length) continue
    licenses.set(id, {
      redistributable: row[redistributableColumn] === "True",
      copyright: row[copyrightColumn] ?? "",
    })
  }
  return licenses
}

/** The eBible id in `https://ebible.org/Scriptures/details.php?id=<id>`. */
export function ebibleIdFromLicenseUrl(licenseUrl: string): string | null {
  let url: URL
  try {
    url = new URL(licenseUrl)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (
    (host !== "ebible.org" && host !== "www.ebible.org") ||
    url.pathname !== "/Scriptures/details.php"
  ) {
    return null
  }
  const id = url.searchParams.get("id")
  return id && id.trim().length > 0 ? id : null
}

/** The KTD7 license rule for one catalog entry. */
export function decideLicense(record: SourceRecord): LicenseDecision {
  if (record.id === BSB_TRANSLATION_ID) {
    return { kind: "keep", credit: BSB_CREDIT }
  }
  if (ebibleIdFromLicenseUrl(record.licenseUrl) === null) {
    return { kind: "drop", reason: "no-ebible-id" }
  }
  if (record.license === null) {
    return { kind: "drop", reason: "no-ebible-match" }
  }
  if (!record.license.redistributable) {
    return { kind: "drop", reason: "not-redistributable" }
  }
  const credit = record.license.copyright.trim()
  if (credit.length === 0) return { kind: "drop", reason: "no-credit" }
  return { kind: "keep", credit }
}

function isTextFacts(text: SourceRecord["text"]): text is TextFacts {
  return text !== null && "sha256" in text
}

/** Splits the records into the snapshot's translations and the drops. */
export function selectCatalog(records: readonly SourceRecord[]): {
  kept: KeptTranslation[]
  dropped: { id: string; reason: DropReason }[]
} {
  const kept: KeptTranslation[] = []
  const dropped: { id: string; reason: DropReason }[] = []
  for (const record of records) {
    const decision = decideLicense(record)
    if (decision.kind === "drop") {
      dropped.push({ id: record.id, reason: decision.reason })
      continue
    }
    const { text } = record
    if (text === null) {
      // The script fetches every licensed entry, so a gap is a broken lock.
      throw new BibleDataRuleError(
        `${record.id} passed the license check but has no text facts`,
      )
    }
    if (!isTextFacts(text)) {
      const reason = "missing" in text ? "source-missing" : "text-rejected"
      dropped.push({ id: record.id, reason })
      continue
    }
    const books = decodeBookSet(text.books)
    if (books === null) {
      throw new BibleDataRuleError(
        `${record.id} has a bad book set "${text.books}"`,
      )
    }
    kept.push({
      ...record,
      credit: decision.credit,
      text,
      complete: books.size === BIBLE_BOOKS.length,
    })
  }
  return { kept, dropped }
}

/** The ids of REQUIRED_TRANSLATION_IDS that `ids` does not contain. */
export function missingRequiredTranslations(ids: Iterable<string>): string[] {
  const present = new Set(ids)
  return REQUIRED_TRANSLATION_IDS.filter((id) => !present.has(id))
}

/** The snapshot entries, sorted by id. */
export function catalogEntries(
  kept: readonly KeptTranslation[],
): StoredCatalogTranslation[] {
  return kept
    .map((entry) => ({
      id: entry.id,
      language: entry.language,
      languageName: entry.languageName,
      languageEnglishName: entry.languageEnglishName,
      name: entry.name,
      englishName: entry.englishName,
      // One real entry (nld_) has an empty short name.
      shortName: entry.shortName.trim() || entry.id,
      textDirection: entry.textDirection,
      complete: entry.complete,
      credit: entry.credit,
      sha256: entry.sha256,
      downloadBytes: entry.text.bytes,
      books: entry.text.books,
    }))
    .sort((a, b) => compareIds(a.id, b.id))
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * ISO 639-3 code to default translation (KTD7): English is BSB; otherwise a
 * complete Bible, then the most verses, then the lower id.
 */
export function pickLanguageDefaults(
  candidates: readonly LanguageCandidate[],
): Record<string, string> {
  const best = new Map<string, LanguageCandidate>()
  for (const candidate of candidates) {
    const current = best.get(candidate.language)
    if (current === undefined || beats(candidate, current)) {
      best.set(candidate.language, candidate)
    }
  }
  const table: Record<string, string> = {}
  for (const language of [...best.keys()].sort(compareIds)) {
    const candidate = best.get(language)
    if (candidate) table[language] = candidate.id
  }
  return table
}

function beats(a: LanguageCandidate, b: LanguageCandidate): boolean {
  if (a.id === BSB_TRANSLATION_ID || b.id === BSB_TRANSLATION_ID) {
    return a.id === BSB_TRANSLATION_ID
  }
  if (a.complete !== b.complete) return a.complete
  if (a.verses !== b.verses) return a.verses > b.verses
  return compareIds(a.id, b.id) < 0
}

/** One book's facts as `"<chapter count> <chapter>:<last verse> ..."`. */
export function encodeChapterFacts(book: BookChapters): string {
  const pairs = Object.entries(book.lastVerses)
    .map(([chapter, last]) => [Number(chapter), last ?? 0] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, last]) => `${chapter}:${last}`)
  return [String(book.chapterCount), ...pairs].join(" ")
}

const COUNT = /^[1-9]\d*$/
const PAIR = /^([1-9]\d*):([1-9]\d*)$/

/** Reads `encodeChapterFacts` back; any malformed part gives null. */
export function decodeChapterFacts(text: string): BookChapters | null {
  const [countText = "", ...pairs] = text.split(" ")
  if (!COUNT.test(countText)) return null
  const chapterCount = Number(countText)
  const lastVerses: Record<number, number> = {}
  for (const pair of pairs) {
    const match = PAIR.exec(pair)
    if (!match) return null
    const chapter = Number(match[1])
    if (chapter > chapterCount || chapter in lastVerses) return null
    lastVerses[chapter] = Number(match[2])
  }
  return { chapterCount, lastVerses }
}

/**
 * The versification table (KTD6): BSB is `bsb`; the classifier places every
 * other book, and an override wins. It lists a translation only when some book
 * is not `eng`, and a book only when it differs from the translation's main.
 */
export function translationSystemTable(
  kept: readonly KeptTranslation[],
  overrides: SystemOverrides,
): SystemTableResult {
  const table: Record<string, TranslationSystemEntry> = {}
  const unknown: string[] = []
  const bookCounts: Record<string, number> = {}
  const overridden: string[] = []
  const errors: string[] = []
  const byId = new Map(kept.map((entry) => [entry.id, entry]))

  for (const [id, books] of Object.entries(overrides)) {
    const entry = byId.get(id)
    if (!entry) {
      errors.push(`override for ${id}: the translation is not in the catalog`)
      continue
    }
    const present = decodeBookSet(entry.text.books)
    for (const [bookId, override] of Object.entries(books)) {
      if (!isUsfmBookId(bookId) || !present?.has(bookId)) {
        errors.push(
          `override for ${id} ${bookId}: the translation lacks the book`,
        )
      }
      if (!STANDARD_SYSTEM_IDS.includes(override.system)) {
        errors.push(`override for ${id} ${bookId}: unknown system`)
      }
    }
  }

  for (const entry of kept) {
    const bookIds = [...(decodeBookSet(entry.text.books) ?? [])]
    if (entry.id === BSB_TRANSLATION_ID) {
      table[entry.id] = { main: BSB_SYSTEM_ID }
      bookCounts[BSB_SYSTEM_ID] =
        (bookCounts[BSB_SYSTEM_ID] ?? 0) + bookIds.length
      continue
    }
    const chapters: Record<string, BookChapters> = {}
    for (const [bookId, text] of Object.entries(entry.text.chapters)) {
      const facts = text === undefined ? null : decodeChapterFacts(text)
      if (facts === null) {
        throw new BibleDataRuleError(
          `${entry.id} ${bookId} has bad chapter facts`,
        )
      }
      chapters[bookId] = facts
    }
    const result = classifyTranslation(
      chapters satisfies TranslationChapters,
      VERSIFICATION_SYSTEMS,
    )
    const own = overrides[entry.id] ?? {}
    const differing: Record<string, VersificationSystemId> = {}
    for (const bookId of bookIds) {
      const override = own[bookId]
      if (!override && result.books[bookId] === "unknown") {
        unknown.push(`${entry.id} ${bookId}`)
      }
      if (override) {
        const classified = result.books[bookId] ?? `main ${result.main}`
        overridden.push(
          `${entry.id} ${bookId}: ${classified} -> ${override.system}`,
        )
      }
      const system = override?.system ?? resolveBookSystem(result, bookId)
      bookCounts[system] = (bookCounts[system] ?? 0) + 1
      if (system !== result.main) differing[bookId] = system
    }
    const tableEntry: TranslationSystemEntry =
      result.main === "eng" ? differing : { main: result.main, ...differing }
    if (Object.keys(tableEntry).length > 0) table[entry.id] = tableEntry
  }
  return { table, unknown, bookCounts, overridden, errors }
}
