/**
 * decide-language — the per-document `documents.language` decision (#74;
 * thresholds + null policy recorded as ADR-0007, which supersedes ADR-0006's
 * low-confidence fallback). Pure policy over the pure detector, kept as its own primitive so
 * every consumer of the decision — the ingest path (normalize.ts) and the #73
 * corpus audit / null-backfill pass — shares one tested implementation instead
 * of re-encoding the thresholds.
 *
 * The decision, in order:
 *   1. cleaned content shorter than the detection floor → null. The only regime
 *      where tinyld is *confidently wrong* is sparse non-prose (name/title/date
 *      lists, nav) — every observed case < 260 chars; 500 clears them all.
 *   2. detector confidence below the gate → null (honestly unsure).
 *   3. otherwise trust the verdict — even OUTSIDE the source's declared
 *      `languages` (content wins). An out-of-set detection is still stored and
 *      carries a warning: the registry declaration is incomplete, or the
 *      detector misfired — either way an actionable operator signal.
 *
 * `null` always means "not confidently detected", never a guess: a blank row
 * stays fully retrievable unfiltered, is simply excluded from `language:<code>`
 * filters, and forms #73's worklist (`WHERE language IS NULL`).
 */
import { detectLanguage } from "./detect-language.js"

/**
 * Detection floor: below this many chars of cleaned content there is too little
 * prose to trust a verdict. Distinct from `crawl.minContentLength` (the "worth
 * storing?" ingest floor) — this one asks "enough prose to trust a language
 * verdict?". #74 default; tuned by #73's corpus audit.
 */
export const DETECTION_FLOOR_CHARS = 500

/**
 * Confidence gate: tinyld verdicts below this are not trusted. Evidence
 * (lang-detect-bench sweep, 2026-07-13): verdicts at/above the gate were 99.7%
 * correct (700/702). #74 default; tuned by #73's corpus audit.
 */
export const CONFIDENCE_GATE = 0.75

export interface LanguageDecision {
  /** ISO 639-1 code, or null = "not confidently detected" (never a guess). */
  language: string | null
  /** Set when a confident detection falls outside the source's declared set. */
  warning?: string
}

/**
 * Decide the `documents.language` label for one document's CLEANED content
 * (detect on what a future re-ingest would produce, per ADR-0006 — never the
 * raw snapshot). `declared` is the source's declared/expected language set,
 * used only for the out-of-set warning — it never overrides the content.
 */
export function decideLanguage(
  content: string,
  opts: { declared: readonly string[] },
): LanguageDecision {
  if (content.length < DETECTION_FLOOR_CHARS) return { language: null }

  const { language, confidence } = detectLanguage(content)
  if (!language || confidence < CONFIDENCE_GATE) return { language: null }

  if (!opts.declared.includes(language)) {
    return {
      language,
      warning:
        `detected language '${language}' (confidence ${confidence.toFixed(2)}) ` +
        `is outside the declared set [${opts.declared.join(", ")}] — ` +
        `registry declaration incomplete, or a detector misfire`,
    }
  }
  return { language }
}
