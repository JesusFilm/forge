/**
 * Russian scripture from the SYNODAL translation (Синодальный перевод, public
 * domain). We fetch the real verse text — scripture is NEVER machine-translated.
 *
 * Source: getbible.net v2 (`/synodal/<bookNr>/<chapter>.json`), which returns
 * the chapter's verses + the Russian book name. All curated JESUS-film passages
 * are in Luke, but the OSIS→book map covers the Gospels + common books so this
 * generalizes. A short timeout + typed error keep it off the critical path's
 * failure modes.
 *
 * For production this should be ingested (like the English WEB Bible) rather
 * than fetched per render; the fetch is fine for local/test runs.
 */

const GETBIBLE = "https://api.getbible.net/v2/synodal"
const FETCH_TIMEOUT_MS = 15_000

/** OSIS book id → getbible book number (KJV 1–66 order). */
const OSIS_TO_NUMBER: Record<string, number> = {
  Matt: 40,
  Mark: 41,
  Luke: 42,
  John: 43,
  Acts: 44,
  Rom: 45,
  Ps: 19,
  Prov: 20,
  Isa: 23,
  Gen: 1,
}

/** Standard Russian citation title per Gospel (falls back to the API name). */
const RU_BOOK_TITLE: Record<string, string> = {
  Matt: "От Матфея",
  Mark: "От Марка",
  Luke: "От Луки",
  John: "От Иоанна",
}

/** English book name (as used in scripture references) → OSIS id. */
const ENGLISH_NAME_TO_OSIS: Record<string, string> = {
  Matthew: "Matt",
  Mark: "Mark",
  Luke: "Luke",
  John: "John",
  Acts: "Acts",
  Romans: "Rom",
  Psalm: "Ps",
  Psalms: "Ps",
  Proverbs: "Prov",
  Isaiah: "Isa",
  Genesis: "Gen",
}

export type SynodalPassage = {
  /** Joined verse text (Synodal). */
  text: string
  /** Russian citation, e.g. "От Луки 19:1-10". */
  reference: string
}

export class SynodalBibleError extends Error {
  constructor(
    readonly code: "unsupported_reference" | "fetch_failed" | "empty",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SynodalBibleError"
  }
}

type ParsedRef = {
  osisBook: string
  chapter: number
  verseStart: number
  verseEnd: number
}

/**
 * Parse either an OSIS range ("Luke.19.1-Luke.19.10") or a human reference
 * ("Luke 19:10", "Luke 8:22-25") into a single-chapter verse range. We pass the
 * FOCUSED scripture reference (what the English devotional actually quotes), not
 * the broad passage, so the Russian verse mirrors the English selection.
 */
export function parseReference(ref: string): ParsedRef | null {
  const osis = ref
    .trim()
    .match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:-[^.]+\.\d+\.(\d+))?$/)
  if (osis) {
    const verseStart = Number(osis[3])
    return {
      osisBook: osis[1],
      chapter: Number(osis[2]),
      verseStart,
      verseEnd: osis[4] ? Number(osis[4]) : verseStart,
    }
  }
  const human = ref.trim().match(/^([1-3]?\s?[A-Za-z]+)\s+(\d+):(\d+)(?:-(\d+))?$/)
  if (human) {
    const name = human[1].replace(/\s+/g, "")
    const verseStart = Number(human[3])
    return {
      osisBook: ENGLISH_NAME_TO_OSIS[name] ?? name,
      chapter: Number(human[2]),
      verseStart,
      verseEnd: human[4] ? Number(human[4]) : verseStart,
    }
  }
  return null
}

type GetBibleChapter = {
  book_name?: string
  verses?: Array<{ verse: number; text: string }>
}

export type FetchSynodalDeps = {
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
}

/**
 * Fetch the Synodal text + Russian citation for an OSIS single-chapter range.
 */
export async function fetchSynodalPassage(
  ref: string,
  deps: FetchSynodalDeps = {},
): Promise<SynodalPassage> {
  const parsed = parseReference(ref)
  if (!parsed) {
    throw new SynodalBibleError(
      "unsupported_reference",
      `cannot parse reference: ${ref}`,
    )
  }
  const bookNr = OSIS_TO_NUMBER[parsed.osisBook]
  if (!bookNr) {
    throw new SynodalBibleError(
      "unsupported_reference",
      `no Synodal book mapping for ${parsed.osisBook}`,
    )
  }

  const fetchFn = deps.fetchFn ?? fetch
  let data: GetBibleChapter
  try {
    const r = await fetchFn(`${GETBIBLE}/${bookNr}/${parsed.chapter}.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) {
      throw new SynodalBibleError("fetch_failed", `getbible HTTP ${r.status}`)
    }
    data = (await r.json()) as GetBibleChapter
  } catch (error) {
    if (error instanceof SynodalBibleError) throw error
    throw new SynodalBibleError(
      "fetch_failed",
      `Synodal fetch failed for ${ref}`,
      error,
    )
  }

  const verses = (data.verses ?? [])
    .filter((v) => v.verse >= parsed.verseStart && v.verse <= parsed.verseEnd)
    .sort((a, b) => a.verse - b.verse)
  const text = verses
    .map((v) => v.text.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) {
    throw new SynodalBibleError("empty", `no Synodal verses for ${ref}`)
  }

  const title =
    RU_BOOK_TITLE[parsed.osisBook] ?? data.book_name ?? parsed.osisBook
  const range =
    parsed.verseEnd > parsed.verseStart
      ? `${parsed.verseStart}-${parsed.verseEnd}`
      : `${parsed.verseStart}`
  return { text, reference: `${title} ${parsed.chapter}:${range}` }
}
