/**
 * Fixed BCP-47 locale profiles for Admin's search-eval catalog context
 * contract.
 *
 * Admin's `/api/search` accepts any locale string; offline eval generation
 * uses a fixed set so suites stay comparable across runs and the judge sees
 * a consistent surface. Source-of-truth for the list is the brainstorm:
 * `docs/brainstorms/2026-05-06-semantic-search-eval-harness-requirements.md`
 *
 * The 30 locales were picked by querying Core's
 * `Language.labeledVideoCounts` on 2026-05-06 and taking the top 30
 * after deduping by `bcp47`. Only 20 locales have ≥50 labeled videos
 * and only ~30 reach ≥40 — going deeper just adds queries against
 * thin corpora.
 *
 * To refresh the list: re-run the Core query against
 * api-gateway.central.jesusfilm.org and update SEARCH_EVAL_LOCALES +
 * SEARCH_EVAL_LOCALE_TIER. Do NOT add `it`, `nl`, or other languages just because
 * the LLM judge is good at them — the constraint is JFP corpus depth,
 * not judge quality.
 *
 * Refresh command:
 *
 * ```
 * curl -s -X POST https://api-gateway.central.jesusfilm.org/ \
 *   -H "Content-Type: application/json" \
 *   -d '{"query":"{ languages(limit: 500, offset: 0) { bcp47 labeledVideoCounts { seriesCount featureFilmCount shortFilmCount } } }"}' \
 *   | jq -r '.data.languages | map(. + {total: (.labeledVideoCounts.seriesCount + .labeledVideoCounts.featureFilmCount + .labeledVideoCounts.shortFilmCount)}) | sort_by(-.total) | .[0:30] | map(.bcp47)'
 * ```
 *
 * (Repeat with offset=500, 1000, 1500, 2000 to cover the full ~2300
 * languages, dedupe by bcp47 keeping max total, then take top 30.)
 */

export const SEARCH_EVAL_LOCALES = [
  "en",
  "fr",
  "es",
  "ru",
  "ar",
  "pt",
  "de",
  "zh",
  "it",
  "fa",
  "th",
  "hi",
  "vi",
  "tr",
  "ja",
  "es-ES",
  "ko",
  "bn",
  "id",
  "pt-PT",
  "ro",
  "km",
  "zh-hans",
  "yue",
  "ur",
  "fil",
  "te",
  "kk",
  "ta",
  "pl",
] as const

export type SearchEvalLocale = (typeof SEARCH_EVAL_LOCALES)[number]

/**
 * Per-locale judge confidence tier. Surfaced in run output so a
 * regression in Tier-3 isn't read with the same weight as one in
 * Tier-1.
 *
 * Tier 1 — Romance + Germanic, judge is sharp.
 * Tier 2 — major non-Latin scripts, judge is decent.
 * Tier 3 — long-tail / regional variants where Haiku 4.5 may be
 *          unreliable. Calibration should specifically watch these.
 */
export type Tier = 1 | 2 | 3

export const SEARCH_EVAL_LOCALE_TIER = {
  // Tier 1 — Romance/Germanic
  en: 1,
  fr: 1,
  es: 1,
  de: 1,
  pt: 1,
  it: 1,
  // Tier 2 — major non-Latin
  ru: 2,
  ar: 2,
  fa: 2,
  zh: 2,
  ja: 2,
  ko: 2,
  hi: 2,
  th: 2,
  vi: 2,
  id: 2,
  tr: 2,
  // Tier 3 — regional variants + softer-judge
  "es-ES": 3,
  bn: 3,
  "pt-PT": 3,
  ro: 3,
  km: 3,
  "zh-hans": 3,
  yue: 3,
  ur: 3,
  fil: 3,
  te: 3,
  kk: 3,
  ta: 3,
  pl: 3,
} as const satisfies Record<SearchEvalLocale, Tier>

export function isSearchEvalLocale(value: string): value is SearchEvalLocale {
  return (SEARCH_EVAL_LOCALES as readonly string[]).includes(value)
}
