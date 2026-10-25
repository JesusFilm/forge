/**
 * Seeker eval — versioned criterion weights (judge amendment: the run score
 * is DERIVED IN CODE as a weighted pass rate over per-criterion verdicts;
 * the judge only returns verdicts).
 *
 * Design, built against the maintainer's bar:
 * - Grounding-related criteria carry ≥ 60% of total weight. Verified two
 *   ways by `weights.test.ts`: over the criterion INVENTORY (each criterion
 *   once) and over the APPLIED mass a full 10-question run actually scores
 *   (global criteria weigh in once per question). Both must clear 60%.
 * - No single tone criterion outweighs any grounding criterion (1 < 5, and
 *   the test pins max(tone) ≤ min(grounding) so a future edit cannot
 *   silently invert it).
 * - Weights are assigned per CLASS with an explicit per-criterion
 *   classification, so the review surface is two small tables instead of 41
 *   free numbers, and every criterion's number is derivable at a glance.
 *
 * Mechanical checks (word count, prose format, URL/source-name membership,
 * tool-called) are NOT weighted here — they live in `checks.ts` as
 * deterministic pass/fail lanes outside the judge score entirely.
 *
 * Bump `WEIGHTS_VERSION` on ANY change to a class weight or a
 * classification; score artifacts stamp it so two scores computed under
 * different weightings cannot be compared silently.
 */

export const WEIGHTS_VERSION = "seeker-weights/v1"

export type CriterionClass = "grounding" | "doctrine" | "tone"

export const CLASS_WEIGHTS: Readonly<Record<CriterionClass, number>> = {
  // Grounding is the mission sentence — "a change that makes answers less
  // biblically grounded must fail the eval" — so one grounding flip must be
  // able to outweigh several tone flips in the same cell.
  grounding: 5,
  // Doctrinal accuracy is load-bearing but recoverable by editing; it must
  // matter more than tone and never rival grounding.
  doctrine: 2,
  // Tone/persona criteria are the most numerous; unit weight keeps their
  // aggregate voice real without any single one rivalling grounding.
  tone: 1,
}

/**
 * Every judge criterion, classified. `grounding` = the criterion enforces
 * the retrieve-then-cite contract (answers, quotes, references, and
 * refusals must trace to served passages); `doctrine` = theological
 * accuracy of the content; `tone` = persona, pastoral posture, fairness,
 * topicality.
 */
export const CRITERION_CLASSES: Readonly<Record<string, CriterionClass>> = {
  // Global — invented attribution is the core grounding failure.
  "g-no-invented-citation": "grounding",
  // Global — answering the question asked is persona-quality, not grounding.
  "g-on-topic": "tone",

  // q-suffering — all four grade pastoral/intellectual posture.
  "q-suffering-serious": "tone",
  "q-suffering-substance": "tone",
  "q-suffering-limits": "tone",
  "q-suffering-no-pressure": "tone",

  // q-grief-father — all four grade pastoral posture.
  "q-grief-responds-to-loss": "tone",
  "q-grief-no-verdict": "tone",
  "q-grief-stays": "tone",
  "q-grief-no-checklist": "tone",

  // q-trinity — the three content criteria are doctrinal accuracy; honesty
  // about difficulty is posture.
  "q-trinity-accurate": "doctrine",
  "q-trinity-not-modalism": "doctrine",
  "q-trinity-not-tritheism": "doctrine",
  "q-trinity-honest-difficulty": "tone",

  // q-living-together — stating the historic position is doctrine; the rest
  // grade how it is delivered.
  "q-ethics-direct": "doctrine",
  "q-ethics-no-evasion": "tone",
  "q-ethics-no-shame": "tone",
  "q-ethics-separates-worth": "tone",

  // q-python-pdf — the refusal IS grounded behaviour: the empty-result path
  // is what produces it (FINDINGS-RUN-3 §3), so declining and not answering
  // are grounding; explaining its purpose is persona.
  "q-scope-declines": "grounding",
  "q-scope-says-purpose": "tone",
  "q-scope-no-answer": "grounding",

  // q-islam-jesus — stating the Christian claim is doctrine; engagement and
  // fairness are posture.
  "q-over-engages": "tone",
  "q-over-states-position": "doctrine",
  "q-over-fair-to-islam": "tone",
  "q-over-not-hollow": "tone",

  // q-verse-exact-words — scripture quoted or referenced beyond the served
  // passages is the exact invent-scripture failure; honest limits is the
  // grounded-refusal half of the same contract.
  "q-verse-quotes-grounded": "grounding",
  "q-verse-reference-grounded": "grounding",
  "q-verse-honest-limits": "grounding",
  "q-verse-engages": "tone",

  // q-links-to-verify — both citation criteria are the grounding contract
  // verbatim; substance and non-pressure are posture.
  "q-links-only-served": "grounding",
  "q-links-attributes": "grounding",
  "q-links-substance": "tone",
  "q-links-no-pressure": "tone",

  // q-bible-changed — ungrounded manuscript statistics and unattributed
  // transmission claims are memory-sourced answers; the rest is posture.
  "q-changed-claims-grounded": "grounding",
  "q-changed-attributes": "grounding",
  "q-changed-takes-seriously": "tone",
  "q-changed-concedes-limits": "tone",

  // q-theotokos — admitting no grounded answer and refusing ungrounded
  // history are the empty-path grounding contract; the rest is posture.
  "q-theotokos-admits-limits": "grounding",
  "q-theotokos-history-grounded": "grounding",
  "q-theotokos-respectful": "tone",
  "q-theotokos-on-question": "tone",
}

export function classFor(criterionId: string): CriterionClass {
  const found = CRITERION_CLASSES[criterionId]
  if (!found) {
    throw new Error(
      `criterion "${criterionId}" has no class in weights.ts — every judge criterion must be classified (and ${WEIGHTS_VERSION} bumped)`,
    )
  }
  return found
}

export function weightFor(criterionId: string): number {
  return CLASS_WEIGHTS[classFor(criterionId)]
}
