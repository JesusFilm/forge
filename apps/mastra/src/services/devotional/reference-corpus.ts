import { readFileSync } from "node:fs"
import path from "node:path"

import { getDevotionalCorpusDir } from "../../config/env"
import { parseOsis } from "./reflection-corpus"
import { repoRoot } from "./repo-root"

/**
 * Public-domain reference works for the depth agents (feat-572): two Bible
 * dictionaries, a Greek lexicon, and the Greek Gospels tagged word by word.
 * Built by scripts/ingest-reference-corpora.ts into devo/corpus (gitignored).
 *
 * The agents only ever see text that comes out of here, and everything they
 * quote back is checked against it with `verifyQuote`: a reference the model
 * remembers rather than reads is exactly the failure this exists to stop.
 */

export type DictionaryEntry = {
  id: string
  term: string
  source: string
  text: string
  /** Scripture the entry cites, as OSIS ("Luke.15.16", "Luke.15.11-Luke.15.32"). */
  refs: string[]
}

export type LexiconEntry = {
  strong: string
  lemma: string
  translit: string
  gloss: string
  text: string
}

export type GreekWord = {
  osis: string
  n: number
  greek: string
  translit: string
  english: string
  strong: string
  lemma: string
  gloss: string
}

export type ReferenceCorpora = {
  dictionaries: DictionaryEntry[]
  lexicon: Record<string, LexiconEntry>
  lexiconSource: string
  greek: GreekWord[]
  /** Ancient texts by OSIS verse (Sirach, KJV): primary sources for customs. */
  ancient: Record<string, string>
}

/** An ancient text's verses as one dictionary-like entry the context agent
 *  can quote ("Sir.33.19-Sir.33.23"), or null when a verse is missing. */
export function ancientEntry(
  corpora: ReferenceCorpora,
  osisRange: string,
): DictionaryEntry | null {
  const m = /^(\w+)\.(\d+)\.(\d+)(?:-\w+\.\d+\.(\d+))?$/.exec(osisRange)
  if (!m) return null
  const [book, ch, from, to] = [m[1], m[2], Number(m[3]), Number(m[4] ?? m[3])]
  const lines: string[] = []
  for (let v = from; v <= to; v++) {
    const t = corpora.ancient[`${book}.${ch}.${v}`]
    if (!t) return null
    lines.push(t)
  }
  const ref = `${book === "Sir" ? "Sirach" : book} ${ch}:${from}${to > from ? `-${to}` : ""}`
  return {
    id: ref,
    term: ref,
    source: "Book of Sirach (KJV)",
    text: lines.join(" "),
    refs: [],
  }
}

type Span = { book: string; from: number; to: number }

const ord = (chapter: number, verse: number | null) =>
  chapter * 1000 + (verse ?? 0)

/** "Luke.15.11-Luke.15.32" / "Luke.15.16" / "Luke.15" as a comparable span. */
export function osisSpan(osis: string): Span | null {
  const [a, b] = osis.split("-")
  const start = parseOsis(a)
  const end = b ? parseOsis(b) : start
  if (!start || !end) return null
  return {
    book: start.book,
    from: ord(start.chapter, start.verse ?? 0),
    to: end.verse == null ? ord(end.chapter, 999) : ord(end.chapter, end.verse),
  }
}

const overlaps = (x: Span, y: Span) =>
  x.book === y.book && x.from <= y.to && y.from <= x.to

/** Dictionary entries that cite any verse of the passage. */
export function entriesCiting(
  corpora: ReferenceCorpora,
  osisRange: string,
): DictionaryEntry[] {
  const target = osisSpan(osisRange)
  if (!target) return []
  return corpora.dictionaries.filter((e) =>
    e.refs.some((r) => {
      const s = osisSpan(r)
      return s != null && overlaps(s, target)
    }),
  )
}

/** Tagged Greek words of the passage, in order. */
export function greekWords(
  corpora: ReferenceCorpora,
  osisRange: string,
): GreekWord[] {
  const target = osisSpan(osisRange)
  if (!target) return []
  return corpora.greek.filter((w) => {
    const s = osisSpan(w.osis)
    return s != null && overlaps(s, target)
  })
}

/** Lowercase, straight quotes, letters and digits only, single spaces. */
export function normalizeForQuote(text: string): string {
  return (
    text
      .normalize("NFC")
      // Scripture citations in parentheses sit mid-sentence in the dictionaries
      // ("a signet (Gen. 38:18). They were") and a quotation naturally leaves
      // them out; they are not words of the claim.
      .replace(/\([^()]*\d[^()]*\)/g, " ")
      .toLowerCase()
      // Double quotes are punctuation; a single quote is an apostrophe only
      // inside a word (landowner's), otherwise it is a quotation mark too. The
      // corpora use curly marks and the model straight ones: the curly pair
      // around fatted calf in Easton once failed to match here.
      .replace(/[“”"]/g, " ")
      .replace(/[‘’]/g, "'")
      .replace(/(^|[^\p{L}])'+|'+(?=[^\p{L}]|$)/gu, "$1 ")
      .replace(/[^\p{L}\p{N}']+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
}

/** True when `quote` (at least four words) appears word for word in `text`,
 *  ignoring case, punctuation and spacing. A near miss is a miss. */
export function verifyQuote(quote: string, text: string): boolean {
  const q = normalizeForQuote(quote)
  if (q.split(" ").length < 4) return false
  return ` ${normalizeForQuote(text)} `.includes(` ${q} `)
}

function readData<T>(
  dir: string,
  file: string,
): { meta: Record<string, unknown>; data: T } | null {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(dir, file), "utf8"),
    ) as Record<string, unknown>
    return { meta: raw, data: raw.data as T }
  } catch {
    return null
  }
}

let cache: { dir: string; corpora: ReferenceCorpora } | null = null

/** Loads the four files; throws when any is missing (the depth agents must
 *  not run blind and quietly return "nothing useful"). */
export function loadReferenceCorpora(dir?: string): ReferenceCorpora {
  const resolved =
    dir ?? getDevotionalCorpusDir() ?? path.join(repoRoot(), "devo/corpus")
  if (cache && cache.dir === resolved) return cache.corpora
  const easton = readData<DictionaryEntry[]>(resolved, "easton.json")
  const smith = readData<DictionaryEntry[]>(resolved, "smith.json")
  const lexicon = readData<Record<string, LexiconEntry>>(
    resolved,
    "abbott-smith.json",
  )
  const greek = readData<GreekWord[]>(resolved, "tagnt-gospels.json")
  const ancient = readData<Record<string, string>>(resolved, "sirach-kjv.json")
  if (!easton || !smith || !lexicon || !greek) {
    throw new Error(
      `reference corpora missing in ${resolved}: run scripts/ingest-reference-corpora.ts`,
    )
  }
  const corpora: ReferenceCorpora = {
    dictionaries: [...easton.data, ...smith.data],
    lexicon: lexicon.data,
    lexiconSource: String(lexicon.meta.source ?? "Abbott-Smith lexicon"),
    greek: greek.data,
    ancient: ancient?.data ?? {},
  }
  cache = { dir: resolved, corpora }
  return corpora
}
