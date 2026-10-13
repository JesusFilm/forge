/**
 * Mechanically pseudo-localizes an English UI string for i18n QA — no real
 * translation needed. Three independent, industry-standard stress signals,
 * all visible at a glance in a rendered page:
 *
 *  - Expansion (~35%): most real translations run longer than English;
 *    this catches truncation/overflow before a single real translation
 *    exists for a given string.
 *  - Accented characters: swaps common Latin letters for accented
 *    lookalikes, to catch encoding/font-glyph gaps.
 *  - Bracket markers around each transformed run of literal text: any UI
 *    text that renders WITHOUT brackets bypassed the translation layer
 *    entirely for that run — a hardcoded string, or (the specific bug class
 *    this project has repeatedly found — forge#M37/N50) a translated prefix
 *    with a hardcoded English suffix concatenated onto it. Bracketing each
 *    literal run separately, rather than the whole message once, is what
 *    makes a partially-untranslated concatenation visible: the hardcoded
 *    fragment shows up as plain, unbracketed English sitting right next to
 *    bracketed pseudo-text.
 *
 * ICU syntax is never touched. A `{placeholder}`, the head and selectors of a
 * `{count, plural, ...}` / `select` / `selectordinal` block (`one`, `=0`,
 * `offset:1`, `#`), and a rich-text tag like `<b>`/`</b>` are all left exactly
 * as authored. Only literal text is transformed — including the literal text
 * INSIDE each plural/select body, recursively, because a body is rendered on
 * screen like any other copy: left untouched it would show as unbracketed
 * English and read as a skipped translation. The real-catalog round-trip test
 * (pseudo-locale.test.ts) formats every message afterwards, which is what
 * proves the grammar survives.
 *
 * Used by the test-only fixture pages (PSEUDO_LOCALE below) that the nightly
 * stretch checks render; never served to visitors.
 */

/** The pseudo-locale's tag (the conventional Windows/ICU pseudo-locale id). */
export const PSEUDO_LOCALE = "qps-ploc"

/**
 * The pseudo-locale exists only in Playwright test runs of a non-production
 * build — the same gate as the test-only fixture routes — so no visitor can
 * ever be served pseudo-text, whatever URL they request.
 */
export function isPseudoLocaleEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.PLAYWRIGHT_TEST === "1"
}

type Segment = { text: string; protected: boolean }

function splitTopLevelBraces(message: string): Segment[] {
  const segments: Segment[] = []
  let i = 0
  let literalStart = 0
  while (i < message.length) {
    if (message[i] === "{") {
      if (i > literalStart) {
        segments.push({
          text: message.slice(literalStart, i),
          protected: false,
        })
      }
      const start = i
      let depth = 0
      do {
        if (message[i] === "{") depth++
        else if (message[i] === "}") depth--
        i++
      } while (i < message.length && depth > 0)
      segments.push({ text: message.slice(start, i), protected: true })
      literalStart = i
    } else {
      i++
    }
  }
  if (literalStart < message.length) {
    segments.push({ text: message.slice(literalStart), protected: false })
  }
  return segments
}

const TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9_]*\/?>/g

function splitTags(text: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  let match: RegExpExecArray | null
  TAG_PATTERN.lastIndex = 0
  while ((match = TAG_PATTERN.exec(text))) {
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), protected: false })
    }
    segments.push({ text: match[0], protected: true })
    last = TAG_PATTERN.lastIndex
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), protected: false })
  }
  return segments
}

function splitProtectedSegments(message: string): Segment[] {
  return splitTopLevelBraces(message).flatMap((segment) =>
    segment.protected ? [segment] : splitTags(segment.text),
  )
}

const ACCENT_MAP: Record<string, string> = {
  a: "á",
  e: "é",
  i: "í",
  o: "ó",
  u: "ú",
  A: "Á",
  E: "É",
  I: "Í",
  O: "Ó",
  U: "Ú",
  n: "ñ",
  N: "Ñ",
  c: "ç",
  C: "Ç",
  s: "š",
  S: "Š",
}

function accentify(text: string): string {
  return [...text].map((char) => ACCENT_MAP[char] ?? char).join("")
}

const EXPANSION_RATIO = 0.35

function expand(text: string): string {
  return text.replace(/[A-Za-zÀ-ÿ]+/g, (word) => {
    const extra = Math.max(1, Math.round(word.length * EXPANSION_RATIO))
    return word + word.slice(-1).repeat(extra)
  })
}

const SELECTING_ARGUMENT =
  /^\{\s*[A-Za-z_][\w]*\s*,\s*(?:plural|select|selectordinal)\s*,/

/**
 * A `{name, plural|select|selectordinal, …}` block: the head, selectors and
 * offset are copied as written; each `{body}` is pseudo-localized like a
 * message of its own (it may hold placeholders, tags and nested blocks). A
 * plural `#` needs no special care: it is not a letter, so the transform
 * leaves it in place inside the brackets and ICU still substitutes it.
 * Any other `{…}` (a placeholder, a number/date format) is returned as is.
 */
function mapArgument(
  argument: string,
  mapRun: (run: string) => string,
): string {
  const head = SELECTING_ARGUMENT.exec(argument)
  if (!head) return argument
  let out = head[0]
  let i = head[0].length
  const close = argument.length - 1
  while (i < close) {
    if (argument[i] !== "{") {
      out += argument[i]
      i++
      continue
    }
    let depth = 0
    let j = i
    do {
      if (argument[j] === "{") depth++
      else if (argument[j] === "}") depth--
      j++
    } while (j < argument.length && depth > 0)
    out += `{${mapLiteralRuns(argument.slice(i + 1, j - 1), mapRun)}}`
    i = j
  }
  return `${out}}`
}

/**
 * Rewrites every literal run of an ICU message — text outside placeholders,
 * tags and selectors, including inside plural/select bodies — with `mapRun`,
 * leaving all ICU syntax as written. Whitespace-only runs are left alone.
 */
function mapLiteralRuns(
  message: string,
  mapRun: (run: string) => string,
): string {
  return splitProtectedSegments(message)
    .map((segment) => {
      if (segment.protected) {
        return segment.text.startsWith("{")
          ? mapArgument(segment.text, mapRun)
          : segment.text
      }
      if (segment.text.trim().length === 0) return segment.text
      return mapRun(segment.text)
    })
    .join("")
}

/** Pseudo-localizes a single ICU message string. See file header for the technique and its scope limits. */
export function pseudoLocalize(message: string): string {
  return mapLiteralRuns(message, (run) => `[[${accentify(expand(run))}]]`)
}

/**
 * The words a message actually puts on screen, as written in its catalog:
 * each literal run, split where a plural's `#` number goes, trimmed. Used to
 * tell a real language's interface copy apart from content on a rendered page.
 */
export function literalRuns(message: string): string[] {
  const runs: string[] = []
  mapLiteralRuns(message, (run) => {
    runs.push(...run.split("#").map((piece) => piece.trim()))
    return run
  })
  return runs.filter((run) => run.length > 0)
}

type MessageTree = { [key: string]: string | MessageTree }

/** Recursively pseudo-localizes every leaf string in a message catalog tree. */
export function pseudoLocalizeCatalog<T extends object>(catalog: T): T {
  const result: MessageTree = {}
  for (const [key, value] of Object.entries(catalog as MessageTree)) {
    result[key] =
      typeof value === "string"
        ? pseudoLocalize(value)
        : pseudoLocalizeCatalog(value)
  }
  return result as T
}

const BRACKETED = /\[\[[^\]]*\]\]/g

/**
 * What is left of rendered text once every bracketed (catalog) run and every
 * known content string is removed — if it still holds a Latin word, that
 * text reached the screen without passing through a translation catalog.
 * Content (titles, language names) never goes through a catalog, so callers
 * pass it as `content`; it is matched case-insensitively because CSS
 * text-transform changes rendered case.
 */
export function untranslatedRemainder(
  text: string,
  content: readonly string[],
): string | null {
  let rest = text.replace(BRACKETED, " ")
  const known = [...content]
    .filter((item) => item.trim().length > 0)
    .sort((a, b) => b.length - a.length)
  for (const item of known) {
    // Whole words only: a short value such as the language code "ar" must
    // never erase part of a real word ("Hardcoded") and hide it.
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    rest = rest.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"),
      " ",
    )
  }
  rest = rest.replace(/\s+/g, " ").trim()
  return /[A-Za-z]{2,}/.test(rest) ? rest : null
}

/** Every leaf message of a catalog, keyed by its dotted path. */
function flattenCatalog(
  catalog: object,
  path: string[] = [],
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(catalog as MessageTree)) {
    if (typeof value === "string") out[[...path, key].join(".")] = value
    else flattenCatalog(value, [...path, key], out)
  }
  return out
}

/**
 * Which messages of a pseudo-localized catalog appeared in `rendered` text,
 * and how many could have: a message counts once any of its bracketed runs
 * is on screen (case-insensitive, `#` standing for the number a plural
 * substitutes). Messages with no literal words (only placeholders) can never
 * show a bracketed run, so they are left out of the total.
 */
export function phrasesOnScreen(
  pseudoCatalog: object,
  rendered: string,
): { shown: string[]; total: number } {
  const screen = rendered.toLocaleLowerCase()
  const shown: string[] = []
  let total = 0
  for (const [path, message] of Object.entries(flattenCatalog(pseudoCatalog))) {
    const runs = message.match(BRACKETED) ?? []
    if (runs.length === 0) continue
    total++
    const onScreen = runs.some((run) => {
      const pattern = run
        .toLocaleLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/#/g, "[\\d.,\\s]+")
      return new RegExp(pattern).test(screen)
    })
    if (onScreen) shown.push(path)
  }
  return { shown, total }
}
