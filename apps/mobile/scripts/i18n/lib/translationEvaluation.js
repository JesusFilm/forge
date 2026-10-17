"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
// Report-only checks for evaluate-translations.mjs (feat-604, layer 1). They
// look for what web's contract checks cannot see: the wrong script or language,
// English left in, odd lengths, inconsistent repeats, and differences from web.

const { parse, TYPE } = require("@formatjs/icu-messageformat-parser")

const SEVERITIES = ["error", "warning", "info"]

// Names that a translation keeps as written: the product names in web's system
// prompt and the ones in en.json. A longer name comes before its own parts.
const KEPT_NAMES = [
  "Jesus Film Project",
  "NUA: Origins",
  "BibleProject",
  "Jesus Film",
  "JesusFilm",
  "AirPlay",
  "Wi-Fi",
  "NUA",
  "OK",
  "ID",
]

// ISO 15924 code to Unicode Script_Extensions values. A test fails when a web
// catalog uses a script that this map lacks.
const SCRIPT_VALUES = {
  Arab: ["Arabic"],
  Armn: ["Armenian"],
  Beng: ["Bengali"],
  Cans: ["Canadian_Aboriginal"],
  Cyrl: ["Cyrillic"],
  Deva: ["Devanagari"],
  Ethi: ["Ethiopic"],
  Geor: ["Georgian"],
  Grek: ["Greek"],
  Gujr: ["Gujarati"],
  Guru: ["Gurmukhi"],
  Hans: ["Han"],
  Hant: ["Han"],
  Hebr: ["Hebrew"],
  Jpan: ["Han", "Hiragana", "Katakana"],
  Khmr: ["Khmer"],
  Knda: ["Kannada"],
  Kore: ["Hangul", "Han"],
  Laoo: ["Lao"],
  Latn: ["Latin"],
  Mlym: ["Malayalam"],
  Mong: ["Mongolian"],
  Mymr: ["Myanmar"],
  Olck: ["Ol_Chiki"],
  Orya: ["Oriya"],
  Sinh: ["Sinhala"],
  Taml: ["Tamil"],
  Telu: ["Telugu"],
  Thaa: ["Thaana"],
  Thai: ["Thai"],
  Tibt: ["Tibetan"],
}

// Frequent characters whose Simplified and Traditional forms differ. Both are
// the Han script, so a zh-Hant catalog in Simplified passes the script check.
// 后 and 里 are left out: Traditional text also uses them (皇后, 公里).
const CHINESE_FORM_PAIRS =
  "们們 这這 说說 个個 来來 时時 为為 发發 门門 见見 电電 话話 视視 频頻 载載 设設 语語 观觀 选選 关關 没沒 请請 试試 网網 连連 继繼 续續 检檢 结結 页頁 开開 动動 历歷 节節 圣聖 经經 书書 无無 应應 国國 学學 会會 过過 还還 进進 从從 问問 题題 显顯 线線 读讀 稣穌 号號 录錄 么麼"
    .split(" ")
    .map((pair) => [...pair])
const CHINESE_FORMS = {
  Hans: new Set(CHINESE_FORM_PAIRS.map(([simplified]) => simplified)),
  Hant: new Set(CHINESE_FORM_PAIRS.map(([, traditional]) => traditional)),
}
const CHINESE_FORM_NAMES = { Hans: "Simplified", Hant: "Traditional" }
// Taiwan's Hakka and Hokkien orthographies write 个 for the particle kai/ê.
const CHINESE_FORM_EXCEPTIONS = { hak: new Set(["个"]), nan: new Set(["个"]) }

// Web's explicit-script check uses the same share.
const MIN_SCRIPT_SHARE = 0.5
const MIN_SCRIPT_LETTERS = 3
const MIN_SCRIPT_SUMMARY_MESSAGES = 10
const SCRIPT_SUMMARY_EXAMPLES = 3
const MIN_WEB_SCRIPT_LETTERS = 50
const ENGLISH_RUN_WORDS = 3
const MIN_LENGTH_SOURCE = 15
const MIN_LENGTH_SAMPLES = 10
const LENGTH_FACTOR = 3
const MESSAGE_ID_MIN_LETTERS = 40
// A catalog read as another language is an error only when GlotLID is sure and
// its own language is nearly absent; a close second (sr and bs) is a warning.
const CATALOG_ID_ERROR_TOP_FROM = 0.5
const CATALOG_ID_ERROR_EXPECTED_BELOW = 0.1
const MESSAGE_ID_WARNING_PROBABILITY = 0.9
const VALUE_PREVIEW_LENGTH = 160

// Ends a run of words: a placeholder, a plural branch, a link, or a kept name.
const BREAK = "\n"
const LETTER = /\p{L}/gu
const WORD = /\p{L}+(?:'\p{L}+)*/gu
const RUN_BREAK = /\n|[^\p{L}\s']+/u
const LINK =
  /(?:https?:\/\/|www\.)\S+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|com|net|app|io)\b\S*/giu

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Latin-only edges: in "のBibleProjectコレクション" the name touches kana.
const KEPT_NAME_PATTERNS = KEPT_NAMES.map(
  (name) =>
    new RegExp(
      `(?<![\\p{scx=Latin}\\p{N}])${escapeRegExp(name)}(?![\\p{scx=Latin}\\p{N}])`,
      "gu",
    ),
)

const SCRIPT_NAMES = [...new Set(Object.values(SCRIPT_VALUES).flat())]

function countMatches(text, pattern) {
  return text.match(pattern)?.length ?? 0
}

function letterPattern(values) {
  // Letters only: an Indic vowel sign is a mark, and LETTER counts no marks.
  const set = values.map((value) => `\\p{scx=${value}}`).join("")
  return new RegExp(`(?=\\p{L})[${set}]`, "gu")
}

const SCRIPT_PATTERNS = Object.fromEntries(
  Object.entries(SCRIPT_VALUES).map(([code, values]) => [
    code,
    letterPattern(values),
  ]),
)
const NAME_PATTERNS = Object.fromEntries(
  SCRIPT_NAMES.map((name) => [name, letterPattern([name])]),
)

function plainText(elements) {
  return elements
    .map((element) => {
      if (element.type === TYPE.literal) return element.value
      if (element.type === TYPE.tag) return plainText(element.children)
      if (element.type === TYPE.plural || element.type === TYPE.select) {
        return Object.values(element.options)
          .map((option) => `${BREAK}${plainText(option.value)}${BREAK}`)
          .join("")
      }
      return BREAK
    })
    .join("")
}

/** The words a reader sees, without ICU syntax, placeholders, links, or kept
 * names. A line break stands where one of them was. */
function readableText(message) {
  let text
  try {
    text = plainText(parse(message))
  } catch {
    text = message.replace(/\{[^{}]*\}/gu, BREAK)
  }
  text = text.replace(LINK, BREAK).replace(/’/gu, "'")
  for (const pattern of KEPT_NAME_PATTERNS) text = text.replace(pattern, BREAK)
  return text
    .replace(/[^\S\n]+/gu, " ")
    .replace(/\s*\n\s*/gu, BREAK)
    .trim()
}

function oneLine(text) {
  return text.replace(/\s+/gu, " ")
}

// The longest branch stands for a plural or select: ar has six branches and ja
// has one, so a sum of the branches would compare the counts, not the text.
function measuredText(elements) {
  return elements
    .map((element) => {
      if (element.type === TYPE.literal) return element.value
      if (element.type === TYPE.tag) return measuredText(element.children)
      if (element.type === TYPE.plural || element.type === TYPE.select) {
        return Object.values(element.options)
          .map((option) => measuredText(option.value))
          .reduce((longest, text) =>
            text.length > longest.length ? text : longest,
          )
      }
      return ""
    })
    .join("")
}

function measuredLength(message) {
  let text
  try {
    text = measuredText(parse(message))
  } catch {
    text = message.replace(/\{[^{}]*\}/gu, "")
  }
  return [...oneLine(text).trim()].length
}

/** The script that a locale's catalog must use: its subtag or its CLDR default. */
function expectedScript(locale) {
  try {
    return new Intl.Locale(locale).maximize().script ?? null
  } catch {
    return null
  }
}

function dominantScript(text) {
  let best = "no known script"
  let bestCount = 0
  for (const name of SCRIPT_NAMES) {
    const count = countMatches(text, NAME_PATTERNS[name])
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

function percent(share) {
  return `${Math.round(share * 100)}%`
}

function preview(value) {
  return value.length > VALUE_PREVIEW_LENGTH
    ? `${value.slice(0, VALUE_PREVIEW_LENGTH)}…`
    : value
}

function finding(rule, severity, key, detail, value) {
  const result = { rule, severity }
  if (key !== null) result.key = key
  result.detail = detail
  if (value !== undefined) result.value = preview(value)
  return result
}

/** Case, width, spacing, and end punctuation do not make two values differ. */
function comparable(value, locale) {
  const text = value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[\s.。!！?？…]+$/u, "")
  try {
    return text.toLocaleLowerCase(locale)
  } catch {
    return text.toLowerCase()
  }
}

function scriptFindings(locale, entries) {
  const code = expectedScript(locale)
  const pattern = code ? SCRIPT_PATTERNS[code] : undefined
  if (!pattern) {
    return [
      finding(
        "script",
        "info",
        null,
        `No script check: ${locale} uses ${code ?? "no known script"}, which this check does not know.`,
      ),
    ]
  }
  const findings = []
  const failedText = []
  let checked = 0
  for (const { key, text, value } of entries) {
    const letters = countMatches(text, LETTER)
    if (letters < MIN_SCRIPT_LETTERS) continue
    checked += 1
    const share = countMatches(text, pattern) / letters
    if (share >= MIN_SCRIPT_SHARE) continue
    failedText.push(text)
    // No letter in the script is an error; a loanword mix ("Cookie設定") is not.
    findings.push(
      finding(
        "script",
        share === 0 ? "error" : "warning",
        key,
        `Only ${percent(share)} of the letters are ${code}; most are ${dominantScript(text)}.`,
        value,
      ),
    )
  }
  // A whole catalog in another script is one problem, not hundreds.
  if (
    checked >= MIN_SCRIPT_SUMMARY_MESSAGES &&
    findings.length / checked >= MIN_SCRIPT_SHARE
  ) {
    const examples = findings
      .slice(0, SCRIPT_SUMMARY_EXAMPLES)
      .map((item) => item.key)
      .join(", ")
    return [
      finding(
        "script",
        "error",
        null,
        `${findings.length} of ${checked} messages are not mostly ${code}; most of their letters are ${dominantScript(failedText.join(" "))}. Examples: ${examples}.`,
      ),
    ]
  }
  return findings
}

function chineseFormFindings(locale, entries) {
  const code = expectedScript(locale)
  if (!CHINESE_FORMS[code]) return []
  const other = code === "Hans" ? "Hant" : "Hans"
  const otherName = CHINESE_FORM_NAMES[other]
  const allowed =
    CHINESE_FORM_EXCEPTIONS[new Intl.Locale(locale).language] ?? new Set()
  const findings = []
  let checked = 0
  let wrongTotal = 0
  let rightTotal = 0
  for (const { key, text, value } of entries) {
    const chars = [...text]
    const wrong = chars.filter(
      (char) => CHINESE_FORMS[other].has(char) && !allowed.has(char),
    )
    const right = chars.filter((char) => CHINESE_FORMS[code].has(char))
    if (wrong.length === 0 && right.length === 0) continue
    checked += 1
    wrongTotal += wrong.length
    rightTotal += right.length
    if (wrong.length === 0) continue
    const sample = [...new Set(wrong)].slice(0, 5).join(", ")
    findings.push(
      finding(
        "script",
        "warning",
        key,
        `Uses ${otherName} forms (${sample}), but the catalog needs ${CHINESE_FORM_NAMES[code]}.`,
        value,
      ),
    )
  }
  // A whole catalog in the other form is one problem, as in scriptFindings.
  if (checked >= MIN_SCRIPT_SUMMARY_MESSAGES && wrongTotal > rightTotal) {
    const examples = findings
      .slice(0, SCRIPT_SUMMARY_EXAMPLES)
      .map((item) => item.key)
      .join(", ")
    return [
      finding(
        "script",
        "error",
        null,
        `${findings.length} of ${checked} Chinese messages use ${otherName} forms (${wrongTotal} such characters against ${rightTotal}), but the catalog needs ${CHINESE_FORM_NAMES[code]}. Examples: ${examples}.`,
      ),
    ]
  }
  return findings
}

// A run never crosses punctuation, so "LUMO, JESUS, Magdalena" (film titles in
// a list) and the two plural branches "video" and "videos in" make no run.
function wordRuns(text, size) {
  const runs = new Set()
  for (const chunk of text.split(RUN_BREAK)) {
    const words = (chunk.match(WORD) ?? []).map((word) => word.toLowerCase())
    for (let start = 0; start + size <= words.length; start += 1) {
      runs.add(words.slice(start, start + size).join(" "))
    }
  }
  return runs
}

function englishLeftFindings(entries) {
  const findings = []
  for (const { key, englishText, text, value } of entries) {
    const english = wordRuns(englishText, ENGLISH_RUN_WORDS)
    if (english.size === 0) continue
    const kept = [...wordRuns(text, ENGLISH_RUN_WORDS)].find((run) =>
      english.has(run),
    )
    if (kept) {
      findings.push(
        finding(
          "english-left",
          "warning",
          key,
          `Keeps the English words "${kept}".`,
          value,
        ),
      )
    }
  }
  return findings
}

function lengthFindings(entries) {
  const samples = entries
    .map((entry) => ({
      ...entry,
      source: measuredLength(entry.english),
      length: measuredLength(entry.value),
    }))
    .filter((sample) => sample.source >= MIN_LENGTH_SOURCE)
  const ratios = samples
    .filter((sample) => sample.length > 0)
    .map((sample) => sample.length / sample.source)
    .sort((left, right) => left - right)
  if (ratios.length < MIN_LENGTH_SAMPLES) return []
  const median = ratios[Math.floor(ratios.length / 2)]
  const findings = []
  for (const { key, value, source, length } of samples) {
    const factor = length / source / median
    let detail = null
    if (length === 0) detail = "Has no words, but the English has some."
    else if (factor > LENGTH_FACTOR) {
      detail = `${factor.toFixed(1)} times longer than usual for this locale.`
    } else if (factor < 1 / LENGTH_FACTOR) {
      detail = `${(1 / factor).toFixed(1)} times shorter than usual for this locale.`
    }
    if (detail) findings.push(finding("length", "warning", key, detail, value))
  }
  return findings
}

function repeatFindings(locale, entries) {
  const groups = new Map()
  for (const entry of entries) {
    if (!groups.has(entry.english)) groups.set(entry.english, [])
    groups.get(entry.english).push(entry)
  }
  const findings = []
  for (const [english, group] of groups) {
    if (group.length < 2) continue
    const variants = new Set(
      group.map((entry) => comparable(entry.value, locale)),
    )
    if (variants.size < 2) continue
    const listed = group
      .map((entry) => `${entry.key} = "${preview(entry.value)}"`)
      .join("; ")
    findings.push(
      finding(
        "repeat",
        "info",
        group[0].key,
        `"${preview(english)}" has ${variants.size} translations: ${listed}.`,
      ),
    )
  }
  return findings
}

/** Web's translated values for each English text. A value equal to web's
 * English is a pending key, not a translation. */
function webTranslations(web) {
  const byEnglish = new Map()
  for (const [key, english] of Object.entries(web.english)) {
    const value = web.catalog[key]
    if (typeof value !== "string" || value === english) continue
    if (!byEnglish.has(english)) byEnglish.set(english, new Set())
    byEnglish.get(english).add(value)
  }
  return byEnglish
}

function webAgreement(locale, entries, web) {
  if (!web) return null
  const byEnglish = webTranslations(web)
  let compared = 0
  let agreed = 0
  const differences = []
  for (const entry of entries) {
    const webValues = byEnglish.get(entry.english)
    if (!webValues) continue
    compared += 1
    const value = comparable(entry.value, locale)
    if ([...webValues].some((item) => comparable(item, locale) === value)) {
      agreed += 1
    } else {
      differences.push({
        key: entry.key,
        english: entry.english,
        value: entry.value,
        web: [...webValues],
      })
    }
  }
  const rate = compared ? Math.round((agreed / compared) * 1000) / 1000 : null
  return { compared, agreed, rate, differences }
}

function webScriptFinding(locale, web) {
  const code = expectedScript(locale)
  const pattern = code ? SCRIPT_PATTERNS[code] : undefined
  if (!web || !pattern) return null
  const text = [...webTranslations(web).values()]
    .flatMap((values) => [...values])
    .map(readableText)
    .join(" ")
  const letters = countMatches(text, LETTER)
  if (letters < MIN_WEB_SCRIPT_LETTERS) return null
  if (countMatches(text, pattern) / letters >= MIN_SCRIPT_SHARE) return null
  return finding(
    "web-script",
    "warning",
    null,
    `Web's ${locale} catalog is mostly ${dominantScript(text)}, but this check expects ${code}. The app and the website will use different scripts.`,
  )
}

function bySeverityThenKey(left, right) {
  const severity =
    SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity)
  if (severity !== 0) return severity
  return (left.key ?? "").localeCompare(right.key ?? "")
}

/** The checks of one locale. `english` and `translations` are flat maps; a key
 * with no string translation is skipped. `entries` feeds language ID. */
function evaluateLocale({ locale, english, translations, web = null }) {
  const entries = Object.keys(english)
    .filter((key) => typeof translations[key] === "string")
    .map((key) => ({
      key,
      english: english[key],
      value: translations[key],
      englishText: readableText(english[key]),
      text: readableText(translations[key]),
    }))
  const findings = [
    webScriptFinding(locale, web),
    ...scriptFindings(locale, entries),
    ...chineseFormFindings(locale, entries),
    ...englishLeftFindings(entries),
    ...lengthFindings(entries),
    ...repeatFindings(locale, entries),
  ].filter(Boolean)
  return {
    entries,
    result: {
      keys: entries.length,
      expectedScript: expectedScript(locale),
      webAgreement: webAgreement(locale, entries, web),
      findings: findings.sort(bySeverityThenKey),
    },
  }
}

/** The stdin request of language-id.py. Long messages also go one by one. */
function languageIdRequest(entriesByLocale, shipped) {
  const locales = {}
  for (const [locale, entries] of Object.entries(entriesByLocale)) {
    locales[locale] = {
      catalog: entries.map((entry) => oneLine(entry.text)).join(" "),
      messages: Object.fromEntries(
        entries
          .filter(
            (entry) =>
              countMatches(entry.text, LETTER) >= MESSAGE_ID_MIN_LETTERS,
          )
          .map((entry) => [entry.key, oneLine(entry.text)]),
      ),
    }
  }
  return { shipped, locales }
}

function describeTop(top = []) {
  return top.map((item) => `${item.label} ${item.probability}`).join(", ")
}

/** Findings from one locale's language-id.py answer. */
function languageIdFindings(answer, valuesByKey = {}) {
  if (!answer) return []
  const messages = Object.entries(answer.messages ?? {}).filter(
    ([, message]) => message.probability >= MESSAGE_ID_WARNING_PROBABILITY,
  )
  if (answer.verdict === "mismatch") {
    const top = answer.top ?? []
    const own = top
      .filter((item) => item.accepted)
      .reduce((sum, item) => sum + item.probability, 0)
    const sure =
      (top[0]?.probability ?? 0) >= CATALOG_ID_ERROR_TOP_FROM &&
      own < CATALOG_ID_ERROR_EXPECTED_BELOW
    // The catalog finding covers its messages, so they get no finding each.
    const also = messages.length
      ? ` Long messages that also read as another language: ${messages.length}.`
      : ""
    return [
      finding(
        "language",
        sure ? "error" : "warning",
        null,
        `GlotLID reads the catalog as ${describeTop(answer.top)}; expected ${answer.expected}.${also}`,
      ),
    ]
  }
  const findings = []
  if (answer.verdict === "unsupported") {
    findings.push(
      finding(
        "language",
        "info",
        null,
        `GlotLID does not know ${answer.expected ?? "this language"}, so no language check ran. It reads the catalog as ${describeTop(answer.top)}.`,
      ),
    )
  }
  for (const [key, message] of messages) {
    findings.push(
      finding(
        "language",
        "warning",
        key,
        `GlotLID reads this message as ${message.label} ${message.probability}; expected ${answer.expected}.`,
        valuesByKey[key],
      ),
    )
  }
  return findings
}

/** Adds one locale's language-id.py answer to its result, in severity order. */
function addLanguageId(result, answer, valuesByKey) {
  result.findings.push(...languageIdFindings(answer, valuesByKey))
  result.findings.sort(bySeverityThenKey)
  result.languageId = answer
  return result
}

/** Counts for the report and the terminal. */
function summarize(locales) {
  const summary = { locales: 0, error: 0, warning: 0, info: 0, byRule: {} }
  for (const result of Object.values(locales)) {
    summary.locales += 1
    for (const item of result.findings) {
      summary[item.severity] += 1
      summary.byRule[item.rule] = (summary.byRule[item.rule] ?? 0) + 1
    }
  }
  return summary
}

module.exports = {
  SCRIPT_VALUES,
  addLanguageId,
  evaluateLocale,
  expectedScript,
  languageIdFindings,
  languageIdRequest,
  summarize,
}
