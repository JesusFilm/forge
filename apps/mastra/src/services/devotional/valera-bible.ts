import { parseReference } from "./synodal-bible"

/**
 * Spanish scripture from the Reina-Valera 1909 (public domain). As with the
 * Russian Synodal text, the verse is FETCHED, never machine-translated.
 *
 * Source: getbible.net v2 (`/valera/<bookNr>/<chapter>.json`). The 1909
 * orthography still accents the monosyllabic conjunctions ("ó", "á", "é",
 * "ú"), a rule the Academia dropped in 1959; those are normalised so the
 * on-screen text does not look misprinted, while the wording itself is left
 * as printed.
 */

const GETBIBLE = "https://api.getbible.net/v2/valera"
const FETCH_TIMEOUT_MS = 15_000

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

/** Spanish citation title per book (falls back to the API's book name). */
const ES_BOOK_TITLE: Record<string, string> = {
  Matt: "Mateo",
  Mark: "Marcos",
  Luke: "Lucas",
  John: "Juan",
  Acts: "Hechos",
  Rom: "Romanos",
  Ps: "Salmos",
  Prov: "Proverbios",
  Isa: "Isaías",
  Gen: "Génesis",
}

export type ValeraPassage = { text: string; reference: string }

export class ValeraBibleError extends Error {
  constructor(
    readonly code: "unsupported_reference" | "fetch_failed" | "empty",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ValeraBibleError"
  }
}

/** Drop the pre-1959 accents on one-letter conjunctions and prepositions. */
export function modernizeValeraOrthography(text: string): string {
  return text
    .replace(/(^|[\s(¡¿"“'])ó(?=[\s,.;:)!?"”'])/g, "$1o")
    .replace(/(^|[\s(¡¿"“'])á(?=[\s,.;:)!?"”'])/g, "$1a")
    .replace(/(^|[\s(¡¿"“'])é(?=[\s,.;:)!?"”'])/g, "$1e")
    .replace(/(^|[\s(¡¿"“'])ú(?=[\s,.;:)!?"”'])/g, "$1u")
}

type GetBibleChapter = {
  book_name?: string
  verses?: Array<{ verse: number; text: string }>
}

export async function fetchValeraPassage(
  ref: string,
  deps: { fetchFn?: typeof fetch } = {},
): Promise<ValeraPassage> {
  const parsed = parseReference(ref)
  if (!parsed) {
    throw new ValeraBibleError(
      "unsupported_reference",
      `cannot parse reference: ${ref}`,
    )
  }
  const bookNr = OSIS_TO_NUMBER[parsed.osisBook]
  if (!bookNr) {
    throw new ValeraBibleError(
      "unsupported_reference",
      `no Reina-Valera book mapping for ${parsed.osisBook}`,
    )
  }
  const fetchFn = deps.fetchFn ?? fetch
  let data: GetBibleChapter
  try {
    const r = await fetchFn(`${GETBIBLE}/${bookNr}/${parsed.chapter}.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) {
      throw new ValeraBibleError("fetch_failed", `getbible HTTP ${r.status}`)
    }
    data = (await r.json()) as GetBibleChapter
  } catch (error) {
    if (error instanceof ValeraBibleError) throw error
    throw new ValeraBibleError(
      "fetch_failed",
      `Reina-Valera fetch failed for ${ref}`,
      error,
    )
  }
  const verses = (data.verses ?? [])
    .filter((v) => v.verse >= parsed.verseStart && v.verse <= parsed.verseEnd)
    .sort((a, b) => a.verse - b.verse)
  const text = modernizeValeraOrthography(
    verses
      .map((v) => v.text.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  )
  if (!text) {
    throw new ValeraBibleError("empty", `no Reina-Valera verses for ${ref}`)
  }
  const title =
    ES_BOOK_TITLE[parsed.osisBook] ?? data.book_name ?? parsed.osisBook
  const range =
    parsed.verseEnd > parsed.verseStart
      ? `${parsed.verseStart}-${parsed.verseEnd}`
      : `${parsed.verseStart}`
  return { text, reference: `${title} ${parsed.chapter}:${range}` }
}

/** "Lucas 8:16" → "Lucas 8, 16"; "Lucas 8:16-18" → "Lucas 8, 16 al 18". */
export function esSpokenReference(reference: string): string {
  const m = reference.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/)
  if (!m) return reference
  const [, book, ch, v1, v2] = m
  return v2 ? `${book} ${ch}, ${v1} al ${v2}` : `${book} ${ch}, ${v1}`
}
