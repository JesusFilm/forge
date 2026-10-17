// Pure UI-locale resolution (KTD3). Hermes has no `Intl.Locale`, so the tag
// parsing and the script inference use small tables, not the engine.

export const DEFAULT_LOCALE = "en"

export type LocaleMatch = "exact" | "script" | "inferred_script" | "language"

export type LocaleResolveResult = {
  /** The catalog tag, spelled as the catalog file spells it. */
  tag: string
  match: LocaleMatch | "default"
  /** Index of the phone entry that matched; -1 for the English default. */
  matchedIndex: number
}

type ParsedTag = {
  language: string
  script: string | null
  region: string | null
}

// Older Android releases still report these withdrawn ISO 639 codes.
const LEGACY_LANGUAGE: Readonly<Record<string, string>> = {
  iw: "he",
  in: "id",
  ji: "yi",
}

// Android often sends a region and no script. Keys are `language-REGION`; the
// values follow CLDR likely subtags for regions whose script differs from the
// language's default script.
const REGION_SCRIPT: Readonly<Record<string, string>> = {
  "zh-TW": "Hant",
  "zh-HK": "Hant",
  "zh-MO": "Hant",
  "zh-CN": "Hans",
  "zh-SG": "Hans",
  "zh-MY": "Hans",
  "sr-ME": "Latn",
  "uz-AF": "Arab",
  "pa-PK": "Arab",
  "az-IR": "Arab",
  "sd-IN": "Deva",
  "mn-CN": "Mong",
  "ms-CC": "Arab",
}

// The script of the bare-language catalog, for languages that phones also
// send in another script. A phone in a different script skips that catalog,
// so a `pa-PK` (Shahmukhi) phone reads English, not Gurmukhi.
const CATALOG_SCRIPT: Readonly<Record<string, string>> = {
  az: "Latn",
  bs: "Latn",
  mn: "Cyrl",
  ms: "Latn",
  pa: "Guru",
  sd: "Arab",
  sr: "Cyrl",
  uz: "Latn",
  zh: "Hans",
}

const RTL_SCRIPTS = new Set(["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm"])

// Languages whose default script is right-to-left. A script subtag wins over
// this list, so `sd-Deva` is left-to-right.
const RTL_LANGUAGES = new Set([
  "ar",
  "ckb",
  "dv",
  "fa",
  "he",
  "ks",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
])

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

/** Parses the language, script, and region subtags; null when not a tag. */
function parseTag(raw: string): ParsedTag | null {
  const subtags = raw.trim().replace(/_/g, "-").split("-")
  const first = subtags[0]?.toLowerCase() ?? ""
  if (!/^[a-z]{2,3}$/.test(first)) return null
  const language = LEGACY_LANGUAGE[first] ?? first
  let script: string | null = null
  let region: string | null = null
  let index = 1
  if (/^[a-z]{4}$/i.test(subtags[index] ?? "")) {
    script = titleCase(subtags[index])
    index += 1
  }
  if (/^(?:[a-z]{2}|\d{3})$/i.test(subtags[index] ?? "")) {
    region = subtags[index].toUpperCase()
  }
  return { language, script, region }
}

// The first phone entry that matches any catalog wins. Per entry: the exact
// tag, its script, an inferred script, then the language unless the scripts
// differ (CATALOG_SCRIPT). No match gives en.
export function resolveLocale(
  preferred: readonly string[],
  available: readonly string[],
): LocaleResolveResult {
  const byLowerTag = new Map(available.map((tag) => [tag.toLowerCase(), tag]))
  const lookup = (candidate: string): string | undefined =>
    byLowerTag.get(candidate.toLowerCase())

  for (let index = 0; index < preferred.length; index += 1) {
    const parsed = parseTag(preferred[index])
    if (!parsed) continue
    const { language, script, region } = parsed
    const full = [language, script, region].filter(Boolean).join("-")
    const candidates: [string, LocaleMatch][] = [[full, "exact"]]
    const inferred =
      !script && region ? REGION_SCRIPT[`${language}-${region}`] : undefined
    if (script) {
      candidates.push([`${language}-${script}`, "script"])
    } else if (inferred) {
      candidates.push([`${language}-${inferred}`, "inferred_script"])
    }
    const phoneScript = script ?? inferred
    const catalogScript = CATALOG_SCRIPT[language]
    if (!phoneScript || !catalogScript || phoneScript === catalogScript) {
      candidates.push([language, "language"])
    }
    for (const [candidate, match] of candidates) {
      const tag = lookup(candidate)
      if (tag) return { tag, match, matchedIndex: index }
    }
  }
  return { tag: DEFAULT_LOCALE, match: "default", matchedIndex: -1 }
}

/** True when text in this catalog's language runs right-to-left. */
export function isRtlTag(tag: string): boolean {
  const parsed = parseTag(tag)
  if (!parsed) return false
  if (parsed.script) return RTL_SCRIPTS.has(parsed.script)
  return RTL_LANGUAGES.has(parsed.language)
}
