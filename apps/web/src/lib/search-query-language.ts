import { detectAll } from "tinyld"

import type { SearchLanguageOption } from "./search-language"

export const MIN_QUERY_LANGUAGE_LETTERS = 3
export const MIN_QUERY_LANGUAGE_TOKENS = 1
export const MIN_DISTINCTIVE_QUERY_LANGUAGE_LETTERS = 1
export const MIN_QUERY_LANGUAGE_SCORE = 0.25
export const MIN_CLEAR_QUERY_LANGUAGE_SCORE = 0.08
export const MIN_QUERY_LANGUAGE_MARGIN = 0
export const MIN_QUERY_LANGUAGE_MARGIN_RATIO = 0.35
export const MIN_CLEAR_QUERY_LANGUAGE_MARGIN_RATIO = 0.5

export type SearchLanguageOptionWithPublicSlug = SearchLanguageOption & {
  publicSlug: string
}

export type QueryLanguageSuggestion = {
  option: SearchLanguageOptionWithPublicSlug
  confidence: number
  margin: number
  source: "script" | "tinyld"
}

export type DetectQueryLanguageSuggestionInput = {
  query: string
  currentLanguageSlug: string | null
  languageOptions: readonly SearchLanguageOption[]
}

type TinyLdCandidate = {
  lang?: unknown
  accuracy?: unknown
}

const PUBLIC_SLUG_BY_DETECTOR_CODE: Readonly<Record<string, string>> =
  Object.freeze({
    ar: "arabic-modern-standard",
    bn: "bangla-2",
    de: "german-standard",
    en: "english",
    es: "spanish-castilian",
    fr: "french",
    hi: "hindi",
    id: "indonesian-isa",
    it: "italian",
    ja: "japanese",
    ko: "korean",
    ms: "malay",
    ne: "nepali",
    nl: "dutch",
    pl: "polish",
    pt: "portuguese-brazil",
    ru: "russian",
    sw: "swahili",
    ta: "tamil",
    te: "telugu",
    th: "thai",
    tl: "tagalog",
    tr: "turkish",
    uk: "ukrainian",
    ur: "urdu",
    vi: "vietnamese",
    zh: "mandarin-china",
  })

const SCRIPT_HINTS: ReadonlyArray<{
  code: string
  pattern: RegExp
  minimumCharacters: number
}> = Object.freeze([
  { code: "ar", pattern: /\p{Script=Arabic}/u, minimumCharacters: 1 },
  { code: "zh", pattern: /\p{Script=Han}/u, minimumCharacters: 1 },
  {
    code: "ja",
    pattern: /\p{Script=Hiragana}|\p{Script=Katakana}/u,
    minimumCharacters: 1,
  },
  { code: "ko", pattern: /\p{Script=Hangul}/u, minimumCharacters: 1 },
  { code: "hi", pattern: /\p{Script=Devanagari}/u, minimumCharacters: 1 },
])

const DISTINCTIVE_LATIN_MARK_PATTERN = /[À-ÖØ-öø-ÿĀ-žƀ-ɏ]/u

export function detectQueryLanguageSuggestion({
  query,
  currentLanguageSlug,
  languageOptions,
}: DetectQueryLanguageSuggestionInput): QueryLanguageSuggestion | null {
  const normalizedQuery = normalizeDetectableQuery(query)
  if (!hasEnoughLanguageSignal(normalizedQuery)) return null

  const scriptSuggestion = detectScriptSuggestion(
    normalizedQuery,
    currentLanguageSlug,
    languageOptions,
  )
  if (scriptSuggestion) return scriptSuggestion

  const candidates = safeDetectAll(normalizedQuery)
  const [top, second] = candidates
  if (!top) return null

  const topOption = findSearchLanguageOptionForDetectorCode(
    top.lang,
    languageOptions,
  )
  const topOptionWithSlug = withPublicSlug(topOption)
  if (!topOptionWithSlug) return null
  if (topOptionWithSlug.publicSlug === currentLanguageSlug) return null

  const confidence = top.accuracy
  const secondScore = second?.accuracy ?? 0
  const margin = confidence - secondScore
  const marginRatio = margin / confidence

  if (!hasReliableTinyLdSignal({ confidence, margin, marginRatio })) {
    return null
  }

  return {
    option: topOptionWithSlug,
    confidence,
    margin,
    source: "tinyld",
  }
}

function hasReliableTinyLdSignal({
  confidence,
  margin,
  marginRatio,
}: {
  confidence: number
  margin: number
  marginRatio: number
}): boolean {
  if (confidence >= MIN_QUERY_LANGUAGE_SCORE) {
    return (
      margin >= MIN_QUERY_LANGUAGE_MARGIN &&
      marginRatio >= MIN_QUERY_LANGUAGE_MARGIN_RATIO
    )
  }

  return (
    confidence >= MIN_CLEAR_QUERY_LANGUAGE_SCORE &&
    margin >= MIN_QUERY_LANGUAGE_MARGIN &&
    marginRatio >= MIN_CLEAR_QUERY_LANGUAGE_MARGIN_RATIO
  )
}

export function findSearchLanguageOptionForDetectorCode(
  detectorCode: string,
  options: readonly SearchLanguageOption[],
): SearchLanguageOption | null {
  const code = detectorCode.trim().toLowerCase()
  if (code.length === 0) return null

  const preferredSlug = PUBLIC_SLUG_BY_DETECTOR_CODE[code]
  if (preferredSlug) {
    const preferred = options.find(
      (option) => option.publicSlug === preferredSlug,
    )
    if (preferred) return preferred
  }

  const matches = options.filter((option) => {
    const primary = option.bcp47?.split("-")[0]?.toLowerCase()
    return primary === code
  })
  return matches.length === 1 ? (matches[0] ?? null) : null
}

function normalizeDetectableQuery(query: string): string {
  return query.normalize("NFKC").replace(/\s+/g, " ").trim()
}

function hasEnoughLanguageSignal(query: string): boolean {
  if (SCRIPT_HINTS.some((hint) => scriptCharacterCount(query, hint) > 0)) {
    return true
  }

  const letterCount = query.match(/\p{Letter}/gu)?.length ?? 0
  if (
    letterCount >= MIN_DISTINCTIVE_QUERY_LANGUAGE_LETTERS &&
    DISTINCTIVE_LATIN_MARK_PATTERN.test(query)
  ) {
    return true
  }

  if (letterCount < MIN_QUERY_LANGUAGE_LETTERS) return false

  return languageTokens(query).length >= MIN_QUERY_LANGUAGE_TOKENS
}

function languageTokens(query: string): string[] {
  return query.split(/[^\p{Letter}]+/u).filter((token) => token.length >= 2)
}

function detectScriptSuggestion(
  query: string,
  currentLanguageSlug: string | null,
  languageOptions: readonly SearchLanguageOption[],
): QueryLanguageSuggestion | null {
  for (const hint of SCRIPT_HINTS) {
    if (scriptCharacterCount(query, hint) < hint.minimumCharacters) continue
    const option = findSearchLanguageOptionForDetectorCode(
      hint.code,
      languageOptions,
    )
    const optionWithSlug = withPublicSlug(option)
    if (!optionWithSlug || optionWithSlug.publicSlug === currentLanguageSlug) {
      return null
    }
    return {
      option: optionWithSlug,
      confidence: 1,
      margin: 1,
      source: "script",
    }
  }

  return null
}

function scriptCharacterCount(
  query: string,
  hint: (typeof SCRIPT_HINTS)[number],
): number {
  return [...query].filter((character) => hint.pattern.test(character)).length
}

function withPublicSlug(
  option: SearchLanguageOption | null,
): SearchLanguageOptionWithPublicSlug | null {
  return option?.publicSlug
    ? { ...option, publicSlug: option.publicSlug }
    : null
}

function safeDetectAll(
  query: string,
): Array<{ lang: string; accuracy: number }> {
  try {
    return (detectAll(query) as TinyLdCandidate[])
      .map((candidate) => ({
        lang:
          typeof candidate.lang === "string"
            ? candidate.lang.trim().toLowerCase()
            : "",
        accuracy:
          typeof candidate.accuracy === "number" ? candidate.accuracy : 0,
      }))
      .filter(
        (candidate) =>
          candidate.lang.length > 0 && Number.isFinite(candidate.accuracy),
      )
      .sort((a, b) => b.accuracy - a.accuracy)
  } catch {
    return []
  }
}
