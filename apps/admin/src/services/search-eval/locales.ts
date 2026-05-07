/**
 * Hard-coded BCP-47 locale list for the semantic-search eval harness.
 *
 * Admin's `/api/search` accepts any locale string; the harness covers
 * a fixed set so baselines stay comparable across runs and the
 * pairwise judge sees a consistent surface. Source-of-truth for the
 * list is the brainstorm:
 * `docs/brainstorms/2026-05-06-semantic-search-eval-harness-requirements.md`
 *
 * The 30 locales were picked by querying Core's
 * `Language.labeledVideoCounts` on 2026-05-06 and taking the top 30
 * after deduping by `bcp47`. Only 20 locales have ≥50 labeled videos
 * and only ~30 reach ≥40 — going deeper just adds queries against
 * thin corpora.
 *
 * To refresh the list: re-run the Core query against
 * api-gateway.central.jesusfilm.org and update HARNESS_LOCALES +
 * LOCALE_TIER. Do NOT add `it`, `nl`, or other languages just because
 * the LLM judge is good at them — the constraint is JFP corpus depth,
 * not judge quality.
 */

export const HARNESS_LOCALES = [
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

export type HarnessLocale = (typeof HARNESS_LOCALES)[number]

/**
 * Quick-mode subset — high-resource locales the LLM judge handles
 * with high confidence. Used by `eval:search:quick` to keep the
 * iteration loop fast (target ~3 min wall time per run).
 */
export const QUICK_LOCALES: readonly HarnessLocale[] = [
  "en",
  "fr",
  "es",
  "de",
  "pt",
  "ja",
] as const

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

export const LOCALE_TIER: Readonly<Record<HarnessLocale, Tier>> = {
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
} as const

export function isHarnessLocale(value: string): value is HarnessLocale {
  return (HARNESS_LOCALES as readonly string[]).includes(value)
}
