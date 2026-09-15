/**
 * detect-language — content-based language detection for a document's cleaned
 * text. Pure, in-process, zero-I/O, free (no cloud/LLM). Wraps `tinyld`
 * (trigram/script detector), chosen by experiment over `franc` — see
 * ADR-0006: native ISO 639-1 output (matches `documents.language` directly, no
 * 639-3→639-1 map) and a *graded* confidence the gate can use.
 *
 * This module is the pure detection primitive only. The detection floor +
 * confidence gate + declared-set cross-check (what to do when there is too
 * little text, confidence is low, or the detected language falls outside
 * `source.languages`) lives in `decide-language.ts`, which owns the
 * `documents.language` decision (#74). If an LLM escalation is ever added for
 * genuinely ambiguous docs, that is I/O and MUST enter behind a
 * `LanguageDetector` port wired in `main.ts` — never imported here
 * (architecture §5). Detection stays a pure function in `indexing`.
 */
import { detectAll } from "tinyld"

/** Trigram detectors need a reasonable sample; more than this adds latency, not
 * accuracy, on article-length prose. We detect on the leading window. */
const MAX_DETECT_CHARS = 2000

export interface LanguageDetection {
  /** ISO 639-1 code (`en`, `es`, `fr`, `zh`), or `""` when undetectable. */
  language: string
  /** Detector confidence in `[0, 1]`; `0` when undetectable. */
  confidence: number
}

/**
 * Detect the dominant language of `text`. Returns the top candidate and its
 * confidence. Empty/blank/undetectable input yields `{ language: "", confidence: 0 }`
 * so the caller's gate can fall back to the source's declared language.
 */
export function detectLanguage(text: string): LanguageDetection {
  const sample = text.slice(0, MAX_DETECT_CHARS).trim()
  if (!sample) return { language: "", confidence: 0 }

  // detectAll → candidates sorted by descending accuracy; [] if undetectable.
  const [top] = detectAll(sample)
  if (!top) return { language: "", confidence: 0 }

  return { language: top.lang, confidence: top.accuracy }
}
