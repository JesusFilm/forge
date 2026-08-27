/**
 * resolve-language — the #73 corpus-sweep language policy, layered ON TOP of the
 * pure per-document decision (`decide-language.ts`, #74). Where `decideLanguage`
 * answers "what does the content confidently say, else null?", `resolveLanguage`
 * answers the sweep's stronger question: "what language should this document's
 * column actually hold?" — where a `null` is the rare, deliberate exception, not
 * the default.
 *
 * The purpose of the sweep is that EVERY document ends up labelled with the
 * language it is actually in. `decideLanguage` is intentionally cautious and
 * emits `null` whenever it is unsure (below the 500-char floor or the 0.75
 * gate). That caution is right at ingest time, but for a whole-corpus correction
 * pass an unexplained `null` is a document that has silently dropped out of every
 * `language:<code>` filter. So this module keeps `decideLanguage`'s confident
 * verdicts verbatim and, only when it abstains, applies a safe fallback ladder:
 *
 *   1. `detected`             — decideLanguage returned a language (floor + gate
 *                               passed). Trust it verbatim, warning and all. This
 *                               is where the genuine relabels come from (e.g. a
 *                               French `thelife` article stamped `en`).
 *   2. `declared-monolingual` — decideLanguage abstained, but the source declares
 *                               exactly ONE language. A short/ambiguous page on a
 *                               single-language source is almost certainly in that
 *                               language, so fall back to it. (Residual risk: a
 *                               SHORT foreign page on a monolingual source — #73's
 *                               known blind spot — which is why every fallback is
 *                               sampled into the report for a human to eyeball.)
 *   3. `declared-primary`     — decideLanguage abstained (below the gate OR below
 *                               the floor) on a MULTI-language source, but the
 *                               detector's dominant candidate is INSIDE the declared
 *                               set. Take it — even on a short page. The floor
 *                               guards against confidently-wrong short text, but
 *                               every observed such case was OUT-of-set (Hindi on an
 *                               English listing); an in-set call is the best evidence
 *                               and a real label beats a null (#73). Reported for review.
 *   4. `unresolved-null`      — a multi-language source whose detection is OUT of the
 *                               declared set or undetectable (any length). These are
 *                               the genuine misfires; guessing would re-introduce the
 *                               exact `languages[0]` mislabel #73 exists to fix, so we
 *                               honestly leave `null` (LLM-escalation candidates). THIS
 *                               is the documented exception, highlighted at the end of
 *                               every report.
 *
 * Pure: no I/O. The ladder itself (`resolveFromSignals`) is separated from the
 * detector calls so every branch is deterministically unit-testable without
 * depending on tinyld's exact scores. The sweep script owns DB reads, the
 * transaction, the change log and the report; this module only decides.
 */
import { decideLanguage } from "./decide-language.js"
import type { LanguageDecision } from "./decide-language.js"
import { detectLanguage } from "./detect-language.js"
import { DETECTION_FLOOR_CHARS } from "./decide-language.js"
import type { DetectedLanguage } from "../contracts/index.js"

/** How a document's resolved label was arrived at (drives report grouping). */
export type ResolutionBasis =
  | "detected"
  | "declared-monolingual"
  | "declared-primary"
  | "unresolved-null"

export interface LanguageResolution {
  /** The label to store. `null` ONLY for `unresolved-null` (the exception). */
  language: string | null
  /** How we got there — groups the report and flags what needs eyeballing. */
  basis: ResolutionBasis
  /** Raw detector top candidate on the cleaned content (for the report sample),
   *  or `""` when the content was undetectable. Independent of the gate. */
  detected: string
  /** Raw detector confidence in `[0, 1]` (0 when undetectable). */
  confidence: number
  /** Present when a confident detection fell outside the declared set —
   *  passed straight through from `decideLanguage` (registry may be incomplete). */
  warning?: string
  /** Plain-language reason for any fallback or null — printed in the report. */
  note?: string
  /** A short verbatim quote the verdict rests on — populated by the LLM detector
   *  (`resolveFromLlm`), motivating the change in the report + agent review.
   *  Empty for the pure tinyld ladder, which has no per-doc evidence quote. */
  evidence?: string
}

/** True only for a fallback that a human should eyeball (basis 2 & 3). */
export function isFallback(basis: ResolutionBasis): boolean {
  return basis === "declared-monolingual" || basis === "declared-primary"
}

/** The detector/decision signals the ladder needs — fabricated freely in tests. */
export interface ResolveSignals {
  /** Output of `decideLanguage` (the cautious per-doc verdict). */
  decision: LanguageDecision
  /** Raw detector top candidate (`""` if undetectable), before the gate. */
  detected: string
  /** Raw detector confidence in `[0, 1]`. */
  confidence: number
  /** Length of the cleaned content, in characters. */
  contentLength: number
  /** The source's declared language set. */
  declared: readonly string[]
}

/**
 * The pure fallback ladder — deterministic in its inputs, no detector calls.
 * Exported so every branch is unit-testable without crafting text that lands on
 * a specific tinyld score.
 */
export function resolveFromSignals(sig: ResolveSignals): LanguageResolution {
  const { decision, detected, confidence, contentLength, declared } = sig

  // 1. Confident detection — trust it verbatim (this is where relabels happen).
  if (decision.language !== null) {
    return {
      language: decision.language,
      basis: "detected",
      detected,
      confidence,
      ...(decision.warning !== undefined && { warning: decision.warning }),
    }
  }

  // decideLanguage abstained (below floor or below gate). Fall back safely.
  const aboveFloor = contentLength >= DETECTION_FLOOR_CHARS

  // 2. Single-language source → its one declared language.
  if (declared.length === 1) {
    return {
      language: declared[0],
      basis: "declared-monolingual",
      detected,
      confidence,
      note:
        `unsure (${aboveFloor ? `low confidence ${confidence.toFixed(2)}` : `only ${contentLength} chars, below the ${DETECTION_FLOOR_CHARS}-char floor`})` +
        ` — fell back to the source's sole declared language '${declared[0]}'`,
    }
  }

  // 3. Multi-language source, detector's dominant candidate is inside the
  //    declared set → take it. This fires BELOW the detection floor too. The
  //    floor exists because short/sparse non-prose can be confidently WRONG — but
  //    every observed confidently-wrong case landed on an OUT-of-set language
  //    (Hindi on a 251-char English listing). An IN-set call is the detector's
  //    best available evidence, and for a corrective sweep a real label beats a
  //    null (#73: "if the detector concluded English, mark it — regardless of the
  //    floor"). The out-of-set / undetectable below-floor cases still fall through
  //    to null below, where the genuine misfires live.
  if (declared.length > 1 && detected !== "" && declared.includes(detected)) {
    return {
      language: detected,
      basis: "declared-primary",
      detected,
      confidence,
      note: aboveFloor
        ? `ambiguous multi-language content; detector leans '${detected}' ` +
          `(confidence ${confidence.toFixed(2)}), within the declared set ` +
          `[${declared.join(", ")}] — took the dominant language`
        : `short page (${contentLength} chars, below the ${DETECTION_FLOOR_CHARS}-char ` +
          `floor) but the detector reads '${detected}' (confidence ${confidence.toFixed(2)}), ` +
          `within the declared set [${declared.join(", ")}] — labelled rather than left null`,
    }
  }

  // 4. Cannot resolve safely → the documented exception. For a multi-language
  //    source this is now ONLY an out-of-set or undetectable call (any length):
  //    the suspicious cases where the detector likely misfired on sparse text —
  //    left null rather than mislabelled (the LLM-escalation candidates, #73).
  return {
    language: null,
    basis: "unresolved-null",
    detected,
    confidence,
    note:
      declared.length === 0
        ? `undetectable and the source declares no language to fall back to — left null`
        : detected === ""
          ? `multi-language source [${declared.join(", ")}] and the content is ` +
            `undetectable — left null for review`
          : `multi-language source [${declared.join(", ")}]; the detector's best guess ` +
            `'${detected}' is outside the declared set — a likely misfire on sparse text, ` +
            `left null rather than mislabelled (LLM-escalation candidate)`,
  }
}

/**
 * What the sweep should DO with one document, given its current label and a fresh
 * resolution. This is the safety policy that keeps the sweep from ever making the
 * corpus worse:
 *
 *   • A CONFIDENT detection (`basis: "detected"`) is authoritative — it may
 *     override an existing label (a real relabel, e.g. `en` → `fr`) or fill a null.
 *   • A WEAK signal (any fallback, or an unresolved null) may only FILL a null.
 *     It never overrides a non-null label and never blanks one to null — a short,
 *     genuinely-English page (below the floor) must keep its `en`, not lose it.
 *   • When a weak signal disagrees with the kept label, the document is flagged
 *     for `review` (the report's eyeball list) — surfaced, never silently changed.
 *
 * Consequence: the sweep only ever ADDS information (fills blanks, fixes confident
 * mislabels). It never removes a label. `final` is `null` only when the document
 * was already null and could not be resolved.
 */
export type SweepReason =
  | "confirmed" // detected, already matches — no change
  | "relabel" // detected, differs from a non-null label — corrected
  | "filled" // was null, now labelled
  | "still-null" // was null, still unresolvable (the documented exception)
  | "kept" // non-null, only a weak signal — left as-is

export interface SweepDecision {
  /** The label to store. Never null unless the document was already null. */
  final: string | null
  /** Whether `final` differs from the current label (i.e. a DB write is needed). */
  changed: boolean
  reason: SweepReason
  /** Human should eyeball this one (a fallback fill, an unresolved null, or a
   *  kept label the detector disagrees with — #73's short-doc blind spot). */
  review: boolean
}

/** Decide the sweep action for one document. Pure; unit-tested per branch. */
export function decideSweep(
  oldLang: string | null,
  res: LanguageResolution,
): SweepDecision {
  // Confident detection — authoritative. May override or fill. (Guard: a
  // "detected" basis should always carry a language; if a malformed resolution
  // ever pairs it with null, fall through to the weak-signal path rather than
  // ever writing a null over an existing label.)
  if (res.basis === "detected" && res.language !== null) {
    const final = res.language
    if (final === oldLang)
      return { final, changed: false, reason: "confirmed", review: false }
    return {
      final,
      changed: true,
      reason: oldLang === null ? "filled" : "relabel",
      review: false,
    }
  }

  // Weak signal (fallback or unresolved). Only allowed to fill a null.
  if (oldLang === null) {
    if (res.language === null) {
      return { final: null, changed: false, reason: "still-null", review: true }
    }
    return {
      final: res.language,
      changed: true,
      reason: "filled",
      review: isFallback(res.basis),
    }
  }

  // Non-null label + weak signal → keep it. Never override, never blank.
  const disagrees = res.detected !== "" && res.detected !== oldLang
  return { final: oldLang, changed: false, reason: "kept", review: disagrees }
}

/**
 * Resolve the `documents.language` label for one document's CLEANED content.
 * `declared` is the source's declared language set (registry `languages`).
 * Thin wrapper: run the detector + decision, then apply the pure ladder.
 */
export function resolveLanguage(
  content: string,
  opts: { declared: readonly string[] },
): LanguageResolution {
  const raw = detectLanguage(content)
  const decision = decideLanguage(content, { declared: opts.declared })
  return resolveFromSignals({
    decision,
    detected: raw.language,
    confidence: raw.confidence,
    contentLength: content.length,
    declared: opts.declared,
  })
}

/**
 * Map an LLM detector verdict (`DetectedLanguage`, from the `LanguageDetector`
 * port) into the sweep's `LanguageResolution` — the LLM path for #84, replacing
 * the tinyld ladder in `resolveLanguage`. Pure: takes the already-fetched
 * detection so every branch is unit-testable without hitting the network.
 *
 * The decisive difference from `resolveFromSignals`: **there is NO length floor.**
 * tinyld needs the 500-char floor because it is confidently wrong on sparse text;
 * the LLM is accurate on short prose and honestly ABSTAINS (returns `null`) when
 * it can't tell, so its own abstention is the safety valve the floor used to be.
 * A non-null verdict is therefore authoritative (`basis: "detected"`) at any
 * length — this is what lets the sweep relabel a short French page stamped `en`,
 * exactly the case #73/#84 exist to fix. `decideSweep` still guarantees a weak
 * signal never blanks a label, so trusting the verdict can only add information.
 */
export function resolveFromLlm(
  det: DetectedLanguage,
  opts: { declared: readonly string[] },
): LanguageResolution {
  // Confident verdict — authoritative regardless of length (the #84 fix).
  if (det.language !== null) {
    const outOfSet =
      opts.declared.length > 0 && !opts.declared.includes(det.language)
    return {
      language: det.language,
      basis: "detected",
      detected: det.language,
      confidence: det.confidence,
      evidence: det.evidence,
      ...(outOfSet && {
        warning:
          `LLM detected '${det.language}' (confidence ${det.confidence.toFixed(2)}) ` +
          `outside the declared set [${opts.declared.join(", ")}] — content wins; ` +
          `the registry declaration may be incomplete`,
      }),
    }
  }

  // The model genuinely could not determine a language → the documented
  // exception, left null (never a guess). `decideSweep` keeps any existing label.
  return {
    language: null,
    basis: "unresolved-null",
    detected: "",
    confidence: 0,
    evidence: det.evidence,
    note:
      opts.declared.length === 0
        ? `the language detector could not determine a language and the source ` +
          `declares none to fall back to — left null`
        : `the language detector could not confidently determine a language for a ` +
          `[${opts.declared.join(", ")}] source — left null for review`,
  }
}
