/**
 * Seeker eval — deterministic code checks, in two lanes.
 *
 * HARD-FAIL lane (proven mechanisms — a violation here is a deterministic
 * break, the same verdict on every run):
 *   - cited-urls-grounded: every URL the answer cites must be in the served
 *     passages. Set membership; measured 0 false positives across 31
 *     citations (reference-runs/FINDINGS-RUN-3-RETRIEVAL.md §1).
 *   - cited-source-names-grounded: the source-name half of the same
 *     membership test — computed by `citableSources()` since the prototype
 *     but never consumed until now (prototype run-report.ts:111 checked only
 *     `urls`; decision doc PR A step 4 wires the names half).
 *   - tool-called: the model must have called `retrieveAnswer` ("Always call
 *     the retrieveAnswer tool"). Production's failover model skips it on 3
 *     of 6 questions — the defect that decided the whole eval design.
 *   - word-count / prose-format: mechanical criteria moved OUT of the judge
 *     (they drove 9–10 false protocol errors per run as judge criteria,
 *     FINDINGS-RUN-2.md §2).
 *
 * REPORT-ONLY lane (unproven parser — must not sit in the lane reserved for
 * deterministic breaks until validated against the committed run-3 corpus):
 *   - scripture-grounded: scripture references in the answer, normalized
 *     across book aliases, must appear in the served passage text. Promotion
 *     to hard-fail is a LATER, SEPARATE decision (decision doc PR A step 5);
 *     nothing in this module or its callers gates on it.
 *
 * The LLM judge passed `g-no-invented-citation` 17 of 17 while answers cited
 * scripture from memory — which is why grounding lives in code at all.
 */
import type { PromptSectionId } from "./prompt-sections"
import { citableSources, type RagFixtureFile } from "./rag"
import type { AnswerRecord } from "./types"

export type CheckLane = "hard-fail" | "report-only"
export type CheckStatus = "pass" | "violated" | "not-applicable"

export type CheckResult = {
  checkId: string
  lane: CheckLane
  status: CheckStatus
  /** The prompt section(s) whose contract this check enforces. */
  promptSections: readonly PromptSectionId[]
  /** One entry per offending item; empty on pass / not-applicable. */
  details: string[]
}

/* ------------------------------------------------------------------ */
/* URL + source-name grounding                                         */
/* ------------------------------------------------------------------ */

/** Trailing punctuation is prose, not part of the URL. */
export function extractUrls(text: string): string[] {
  const cited = text.match(/https?:\/\/[^\s)\]<>"'`]+/g) ?? []
  return cited.map((raw) => raw.replace(/[.,;:!?]+$/, ""))
}

/** Bounded Levenshtein distance with an early-exit ceiling. */
export function editDistanceAtMost(
  left: string,
  right: string,
  max: number,
): boolean {
  if (Math.abs(left.length - right.length) > max) return false
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 1; i <= left.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      )
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > max) return false
    previous = current
  }
  return previous[right.length] <= max
}

function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
}

/** A cited URL within small edit distance of a served URL is a CORRUPTED
 *  citation of a real source (measured: an answering model emitting
 *  `sightlinemiristry.org` for the served `sightlineministry.org`), not an
 *  invented source. Real defect, different class. */
const URL_TYPO_DISTANCE = 3

function checkUrlsGrounded(
  answer: AnswerRecord,
  fixtures: RagFixtureFile | null,
): { grounded: CheckResult; malformed: CheckResult } {
  const groundedBase = {
    checkId: "cited-urls-grounded",
    lane: "hard-fail" as const,
    promptSections: ["citation-discipline"] as const,
  }
  // Report-only: a near-miss of a served URL is a broken link the seeker
  // cannot follow — surfaced every run — but it is NOT the invented-source
  // class the hard-fail lane exists for, and it appears stochastically on an
  // UNCHANGED system (measured in the first green reruns), so red-ing the
  // delta gate on it would attribute a standing model habit to the change
  // under test.
  const malformedBase = {
    checkId: "cited-url-malformed-variant",
    lane: "report-only" as const,
    promptSections: ["citation-discipline"] as const,
  }
  if (!answer.text || !fixtures) {
    return {
      grounded: { ...groundedBase, status: "not-applicable", details: [] },
      malformed: { ...malformedBase, status: "not-applicable", details: [] },
    }
  }
  const { urls } = citableSources(fixtures)
  const servedNormalized = [...urls].map(normalizeUrl)
  // Hosts the fixtures actually served. A non-served deep link on a SERVED
  // host is a RECONSTRUCTED link to a real source (measured: an answering
  // model expanding the served `…/is-jesus-god.html` to
  // `…/is-jesus-god-or-just-a-good-man.html`, matching the passage title) —
  // a broken link, not an invented source. Foreign hosts stay hard-fail.
  const servedHosts = new Set(
    servedNormalized.map((served) => served.split("/")[0]),
  )
  const invented: string[] = []
  const nearMisses: string[] = []
  for (const cited of extractUrls(answer.text)) {
    if (urls.has(cited)) continue
    const citedNormalized = normalizeUrl(cited)
    if (servedNormalized.includes(citedNormalized)) continue
    const isNearMiss =
      servedHosts.has(citedNormalized.split("/")[0]) ||
      servedNormalized.some((served) =>
        editDistanceAtMost(citedNormalized, served, URL_TYPO_DISTANCE),
      )
    if (isNearMiss) nearMisses.push(cited)
    else invented.push(cited)
  }
  return {
    grounded: {
      ...groundedBase,
      status: invented.length > 0 ? "violated" : "pass",
      details: invented,
    },
    malformed: {
      ...malformedBase,
      status: nearMisses.length > 0 ? "violated" : "pass",
      details: nearMisses,
    },
  }
}

function normalizeName(value: string): string {
  return (
    value
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      // Display titles may omit publisher punctuation or parenthesized styling.
      // Compare the words, not presentation details such as `::`, `?`, or `(Part 3)`.
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  )
}

/**
 * Structured (name, url) attribution pairs. Deterministic-by-construction:
 * only citations where the answer PAIRS a name with a URL are extracted —
 * markdown links `[Name](url)` and parentheticals `(Name, url)` — because a
 * paired name is unambiguously an attribution. Unstructured name mentions
 * ("according to Cru...") stay the judge's `g-no-invented-citation`
 * territory: matching arbitrary prose names deterministically is exactly the
 * noisy-parser trap the hard-fail lane must not contain.
 */
export function extractNamedCitations(
  text: string,
): Array<{ name: string; url: string }> {
  const pairs: Array<{ name: string; url: string }> = []
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    pairs.push({ name: match[1], url: match[2] })
  }
  for (const match of text.matchAll(
    /\(([^()]{1,80}?),\s*(https?:\/\/[^\s)]+)\)/g,
  )) {
    pairs.push({ name: match[1], url: match[2] })
  }
  return pairs
    .map((pair) => ({
      name: pair.name.trim(),
      url: pair.url.replace(/[.,;:!?]+$/, ""),
    }))
    .filter(
      // A link whose text is itself a URL — with or without a protocol
      // ("sightlineministry.org/daily-devo/…", measured in the green reruns)
      // — carries no NAME claim; the URL half of the check already verifies
      // the address itself.
      (pair) =>
        pair.name.length > 0 &&
        !/^https?:\/\//.test(pair.name) &&
        !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(pair.name),
    )
}

/**
 * Whether a CITED name is a recognizable form of any SERVED name or title.
 * Models legitimately shorten ("EveryStudent.sk" for "EveryStudent — Slovak
 * (EveryStudent.sk)") and compose ("Cru: Why Was Jesus Crucified?"), and the
 * first green reruns measured exact-match flagging those grounded citations
 * as invented. Three forms are accepted:
 *   1. exact normalized equality;
 *   2. the cited name appears INSIDE a served name/title (length ≥ 4, so a
 *      fragment cannot match trivially);
 *   3. a served name/title appears inside the cited name as WHOLE WORDS
 *      ("cru" matches "Cru: What Is Justification…" but never "crucified").
 *   4. two or more cited words all occur in the served name/title, allowing
 *      readable aliases assembled from its brand and locale metadata.
 * A wholly invented name matches none of these and stays a violation.
 */
export function citedNameIsServed(
  citedName: string,
  known: readonly string[],
): boolean {
  const cited = normalizeName(citedName)
  if (cited.length === 0) return false
  return known.some((entry) => {
    if (entry === cited) return true
    if (cited.length >= 4 && entry.includes(cited)) return true
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(
        cited,
      )
    )
      return true
    const citedWords = cited.split(" ").filter((word) => word.length >= 3)
    const servedWords = entry.split(" ").filter((word) => word.length >= 3)
    if (citedWords.length < 2) return false
    return servedWords.some((_, start) =>
      citedWords.every((word, offset) => servedWords[start + offset] === word),
    )
  })
}

function checkSourceNamesGrounded(
  answer: AnswerRecord,
  fixtures: RagFixtureFile | null,
): CheckResult {
  const base = {
    checkId: "cited-source-names-grounded",
    lane: "hard-fail" as const,
    promptSections: ["citation-discipline"] as const,
  }
  if (!answer.text || !fixtures) {
    return { ...base, status: "not-applicable", details: [] }
  }
  const offenders = extractNamedCitations(answer.text)
    .filter((pair) => {
      const citedUrl = normalizeUrl(pair.url)
      const known = fixtures.fixtures
        .flatMap((fixture) => fixture.result.sources)
        .filter((source) => normalizeUrl(source.url) === citedUrl)
        .flatMap((source) => [source.sourceName, source.title])
        .filter((value): value is string => value != null)
        .map(normalizeName)
        .filter((value) => value.length >= 3)
      return !citedNameIsServed(pair.name, known)
    })
    .map((pair) => `${pair.name} (${pair.url})`)
  return {
    ...base,
    status: offenders.length > 0 ? "violated" : "pass",
    details: offenders,
  }
}

/* ------------------------------------------------------------------ */
/* Tool called                                                         */
/* ------------------------------------------------------------------ */

/**
 * Real signal only in tool-loop runs, where the MODEL decided. Injected runs
 * stamp `skippedTool: false` by construction (the exchange is scripted), so
 * the check passes vacuously there; prompt-only records carry no field and
 * report not-applicable.
 *
 * An `ok: false` cell is ALSO not-applicable: run-loop stamps `skippedTool`
 * from `calls.length` even when the provider failed (401/429/timeout) before
 * any tool round-trip could happen, so a violated verdict there would read an
 * infrastructure outage as "the model chose to skip retrieval" — false-red
 * against a clean baseline, and a permanent disarm of the zero-skip rule if
 * a blip lands in a promoted baseline. Mirrors the sibling checks' answer
 * guard.
 */
function checkToolCalled(answer: AnswerRecord): CheckResult {
  const base = {
    checkId: "tool-called",
    lane: "hard-fail" as const,
    promptSections: ["tool-usage"] as const,
  }
  if (!answer.ok || answer.skippedTool == null) {
    return { ...base, status: "not-applicable", details: [] }
  }
  return answer.skippedTool
    ? {
        ...base,
        status: "violated",
        details: ["model never called retrieveAnswer on this question"],
      }
    : { ...base, status: "pass", details: [] }
}

/* ------------------------------------------------------------------ */
/* Word count + prose format (mechanical, ex-judge)                     */
/* ------------------------------------------------------------------ */

/**
 * Target is the rubric's "roughly 250 words"; the hard threshold adds 10%
 * so the deterministic lane never reds an answer a human would call
 * borderline-fine. 276 words is a violation; 275 is not.
 */
export const WORD_COUNT_TARGET = 250
export const WORD_COUNT_HARD_LIMIT = 275

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

function checkWordCount(answer: AnswerRecord): CheckResult {
  const base = {
    checkId: "word-count",
    lane: "hard-fail" as const,
    // No prompt line owns brevity — see prompt-sections.ts on `unowned`.
    promptSections: ["unowned"] as const,
  }
  if (!answer.text) return { ...base, status: "not-applicable", details: [] }
  const words = countWords(answer.text)
  return words > WORD_COUNT_HARD_LIMIT
    ? {
        ...base,
        status: "violated",
        details: [`${words} words (hard limit ${WORD_COUNT_HARD_LIMIT})`],
      }
    : { ...base, status: "pass", details: [] }
}

/**
 * Markdown headings and bulleted/numbered lists, per line. Inline markdown
 * (links, emphasis) is conversational and allowed; block structure is not.
 */
function checkProseFormat(answer: AnswerRecord): CheckResult {
  const base = {
    checkId: "prose-format",
    lane: "hard-fail" as const,
    promptSections: ["unowned"] as const,
  }
  if (!answer.text) return { ...base, status: "not-applicable", details: [] }
  const details: string[] = []
  for (const line of answer.text.split("\n")) {
    if (/^#{1,6}\s+/.test(line)) details.push(`heading: ${line.slice(0, 60)}`)
    else if (/^\s*[-*+]\s+/.test(line))
      details.push(`bullet: ${line.trim().slice(0, 60)}`)
    else if (/^\s*\d{1,2}[.)]\s+/.test(line))
      details.push(`numbered item: ${line.trim().slice(0, 60)}`)
  }
  return {
    ...base,
    status: details.length > 0 ? "violated" : "pass",
    details,
  }
}

/* ------------------------------------------------------------------ */
/* Scripture references (REPORT-ONLY)                                  */
/* ------------------------------------------------------------------ */

/**
 * Canonical book id → aliases as they appear in prose. Numbered books list
 * their full numbered forms so "1 John 4:8" can never be swallowed by the
 * "John" alias (the extractor tries longer aliases first).
 */
const BOOK_ALIASES: Readonly<Record<string, readonly string[]>> = {
  genesis: ["genesis", "gen"],
  exodus: ["exodus", "exod", "ex"],
  leviticus: ["leviticus", "lev"],
  numbers: ["numbers", "num"],
  deuteronomy: ["deuteronomy", "deut"],
  joshua: ["joshua", "josh"],
  judges: ["judges", "judg"],
  ruth: ["ruth"],
  "1-samuel": ["1 samuel", "1 sam", "first samuel"],
  "2-samuel": ["2 samuel", "2 sam", "second samuel"],
  "1-kings": ["1 kings", "1 kgs", "first kings"],
  "2-kings": ["2 kings", "2 kgs", "second kings"],
  "1-chronicles": ["1 chronicles", "1 chron", "1 chr"],
  "2-chronicles": ["2 chronicles", "2 chron", "2 chr"],
  ezra: ["ezra"],
  nehemiah: ["nehemiah", "neh"],
  esther: ["esther", "esth"],
  job: ["job"],
  psalms: ["psalms", "psalm", "ps"],
  proverbs: ["proverbs", "prov"],
  ecclesiastes: ["ecclesiastes", "eccl"],
  "song-of-solomon": ["song of solomon", "song of songs", "song"],
  isaiah: ["isaiah", "isa"],
  jeremiah: ["jeremiah", "jer"],
  lamentations: ["lamentations", "lam"],
  ezekiel: ["ezekiel", "ezek"],
  daniel: ["daniel", "dan"],
  hosea: ["hosea", "hos"],
  joel: ["joel"],
  amos: ["amos"],
  obadiah: ["obadiah", "obad"],
  jonah: ["jonah"],
  micah: ["micah", "mic"],
  nahum: ["nahum", "nah"],
  habakkuk: ["habakkuk", "hab"],
  zephaniah: ["zephaniah", "zeph"],
  haggai: ["haggai", "hag"],
  zechariah: ["zechariah", "zech"],
  malachi: ["malachi", "mal"],
  matthew: ["matthew", "matt", "mt"],
  mark: ["mark", "mk"],
  luke: ["luke", "lk"],
  john: ["john", "jn"],
  acts: ["acts"],
  romans: ["romans", "rom"],
  "1-corinthians": ["1 corinthians", "1 cor", "first corinthians"],
  "2-corinthians": ["2 corinthians", "2 cor", "second corinthians"],
  galatians: ["galatians", "gal"],
  ephesians: ["ephesians", "eph"],
  philippians: ["philippians", "phil"],
  colossians: ["colossians", "col"],
  "1-thessalonians": ["1 thessalonians", "1 thess"],
  "2-thessalonians": ["2 thessalonians", "2 thess"],
  "1-timothy": ["1 timothy", "1 tim"],
  "2-timothy": ["2 timothy", "2 tim"],
  titus: ["titus"],
  philemon: ["philemon", "phlm"],
  hebrews: ["hebrews", "heb"],
  james: ["james", "jas"],
  "1-peter": ["1 peter", "1 pet"],
  "2-peter": ["2 peter", "2 pet"],
  "1-john": ["1 john", "1 jn", "first john"],
  "2-john": ["2 john", "2 jn", "second john"],
  "3-john": ["3 john", "3 jn", "third john"],
  jude: ["jude"],
  revelation: ["revelation", "rev"],
}

export type ScriptureReference = {
  book: string
  chapter: number
  /** Verse range; null when only a chapter was cited. */
  verseStart: number | null
  verseEnd: number | null
  /** The matched text, for report details. */
  raw: string
}

const ALIAS_TO_BOOK: ReadonlyArray<{ alias: string; book: string }> =
  Object.entries(BOOK_ALIASES)
    .flatMap(([book, aliases]) => aliases.map((alias) => ({ alias, book })))
    // Longest alias first, so "1 john" wins over "john" and
    // "song of solomon" over "song".
    .sort((left, right) => right.alias.length - left.alias.length)

const REFERENCE_PATTERN = new RegExp(
  `(?<![A-Za-z0-9])(${ALIAS_TO_BOOK.map((entry) =>
    entry.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|")})\\.?\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?`,
  "gi",
)

/**
 * Extract chapter-bearing scripture references. Bare book mentions ("the
 * gospel of John") are deliberately NOT references — matching them would
 * flood the report with prose noise.
 */
export function extractScriptureReferences(text: string): ScriptureReference[] {
  const references: ScriptureReference[] = []
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const alias = match[1].toLowerCase().replace(/\s+/g, " ")
    const entry = ALIAS_TO_BOOK.find((candidate) => candidate.alias === alias)
    if (!entry) continue
    const verseStart = match[3] != null ? Number(match[3]) : null
    references.push({
      book: entry.book,
      chapter: Number(match[2]),
      verseStart,
      verseEnd:
        match[4] != null
          ? Number(match[4])
          : verseStart != null
            ? verseStart
            : null,
      raw: match[0],
    })
  }
  return references
}

function referenceGrounded(
  cited: ScriptureReference,
  served: readonly ScriptureReference[],
): boolean {
  return served.some((candidate) => {
    if (candidate.book !== cited.book || candidate.chapter !== cited.chapter) {
      return false
    }
    // A chapter-only citation is grounded by any reference to that chapter.
    if (cited.verseStart == null) return true
    // A verse citation needs the passage's reference to cover the verse; a
    // chapter-only passage reference does not prove the verse was served.
    if (candidate.verseStart == null) return false
    const citedEnd = cited.verseEnd ?? cited.verseStart
    const candidateEnd = candidate.verseEnd ?? candidate.verseStart
    return cited.verseStart >= candidate.verseStart && citedEnd <= candidateEnd
  })
}

function checkScriptureGrounded(
  answer: AnswerRecord,
  fixtures: RagFixtureFile | null,
): CheckResult {
  const base = {
    checkId: "scripture-grounded",
    lane: "report-only" as const,
    promptSections: ["citation-discipline", "safety"] as const,
  }
  if (!answer.text || !fixtures) {
    return { ...base, status: "not-applicable", details: [] }
  }
  const cited = extractScriptureReferences(answer.text)
  if (cited.length === 0) {
    return { ...base, status: "not-applicable", details: [] }
  }
  const served = fixtures.fixtures.flatMap((fixture) =>
    fixture.result.sources.flatMap((source) =>
      extractScriptureReferences(source.text),
    ),
  )
  const offenders = cited
    .filter((reference) => !referenceGrounded(reference, served))
    .map((reference) => reference.raw)
  return {
    ...base,
    status: offenders.length > 0 ? "violated" : "pass",
    details: offenders,
  }
}

/* ------------------------------------------------------------------ */

export function runAnswerChecks(
  answer: AnswerRecord,
  fixtures: RagFixtureFile | null,
): CheckResult[] {
  const urlResults = checkUrlsGrounded(answer, fixtures)
  return [
    urlResults.grounded,
    urlResults.malformed,
    checkSourceNamesGrounded(answer, fixtures),
    checkToolCalled(answer),
    checkWordCount(answer),
    checkProseFormat(answer),
    checkScriptureGrounded(answer, fixtures),
  ]
}

/**
 * The gate's input: only hard-fail lane violations. Report-only findings
 * NEVER appear here — promotion of the scripture check is a later, separate
 * decision, and this projection is what makes that structural rather than
 * disciplinary.
 */
export function hardFailViolations(
  results: readonly CheckResult[],
): CheckResult[] {
  return results.filter(
    (result) => result.lane === "hard-fail" && result.status === "violated",
  )
}
