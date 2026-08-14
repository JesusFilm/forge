import { checkDevotionalCoherence } from "./devotional-coherence"
import {
  buildCoherenceLlm,
  buildFidelityCriticLlm,
  buildReflectionCriticLlm,
} from "./devotional-models"
import { critiqueReflection } from "./devotional-reflection-critic"
import type { GeneratedDevotional } from "./generate-devotional"
import { critiqueReflectionFidelity } from "./reflection-fidelity-critic"

/**
 * Runs the three text critics as ONE gate, before any audio or video work.
 *
 * These critics only ever read text (title, verse, reflection, conclusion,
 * question, prayer). They used to run at the very end of the render scripts,
 * which meant a devotional with a high-severity problem had already cost a
 * full ElevenLabs narration and a multi-minute Remotion render before anyone
 * found out. Same protection, a fraction of the cost, and it sets up an
 * auto-regenerate-on-failure loop later without touching the render path.
 *
 * A critic that could not RUN (LLM error after its own retry) counts as
 * blocking too: "we didn't check" must never be silently equivalent to "it
 * passed" — that exact confusion already shipped one bad devotional.
 *
 * Each critic is read on THREE axes, in this order:
 *   1. `skipped`  — the check did not run at all.
 *   2. its own VERDICT (`coherent` / `solid` / `faithful`).
 *   3. any issue it marked high-severity.
 *
 * Axis 2 was missing at first, and that hole was wide: the depth critic's hard
 * guardrail (denominational polemic, predestination teaching) is expressed by
 * setting `solid: false` and filing the issue as `obvious` with NO severity
 * requirement — so a guardrail violation reported at medium severity sailed
 * straight through a gate that only scanned for `high`. A critic that returns
 * a negative verdict must block on that verdict alone; if a verdict is ever
 * meant to be advisory, delete it from that critic's return type instead of
 * leaving it here unread.
 */

/** A depth score at or below this blocks even when the critic called it solid.
 *  1 = empty/tautological, 5 = one sharp grounded insight; 2 is "thin enough
 *  that the viewer carries nothing away", which is not shippable. */
const DEPTH_SCORE_FLOOR = 2

/**
 * HOW THIS BLOCKS. It returns a verdict; it does not throw. The caller short
 * circuits, exactly as it already does for the safety gate: the workflow's
 * produce step refuses to hand off to the paid steps while `blocking` is
 * non-empty, and a blocked devotional is a successful run that did not publish
 * rather than a failed one.
 *
 * A throwing entry point was considered and rejected. It would have to be
 * ignorable to be useful (a report-only surface still needs the plain verdict),
 * and nothing in this runtime wants the throw — an unused throwing wrapper is
 * just another exported symbol that looks like enforcement. The enforcement is
 * at the call site, and there is a source-level test pinning it there.
 *
 * An earlier version of this module also exported a
 * `DevotionalQualityGateError` that was constructed nowhere, which read as if
 * the gate could stop a render by itself. It could not, and it did not.
 */
export type DevotionalReview = {
  /** Human-readable reasons the text should not ship. Empty = clean. */
  blocking: string[]
}

export type ReviewDevotionalTextInput = {
  devotional: GeneratedDevotional
  /** Full passage reference for the coherence check, e.g. "Luke 19:1-10". */
  passageReference?: string
  /** Fidelity compares the adaptation against the ENGLISH source excerpt, so
   *  it is meaningless for a localized devotional. */
  checkFidelity: boolean
  log?: (msg: string) => void
  /** Cancellation from the workflow step, forwarded to every critic. The three
   *  run in sequence, so without it a cancelled run keeps paying for the two that
   *  had not started yet. */
  abortSignal?: AbortSignal
}

export async function reviewDevotionalText(
  input: ReviewDevotionalTextInput,
): Promise<DevotionalReview> {
  const d = input.devotional
  const log = input.log ?? (() => {})
  const blocking: string[] = []

  const coherence = await checkDevotionalCoherence({
    sceneTitle: d.clip.title,
    scriptureReference: d.scripture.reference,
    scriptureText: d.scripture.text,
    title: d.title,
    reflection: d.reflection.text,
    conclusion: d.conclusion,
    question: d.question,
    prayer: d.prayer,
    passageReference: input.passageReference,
    abortSignal: input.abortSignal,
    llm: buildCoherenceLlm(),
  })
  log(
    `🔎 coherence: ${coherence.coherent ? "OK" : "ISSUES FOUND"} — ${coherence.summary}`,
  )
  for (const i of coherence.issues) {
    log(`   ⚠️ [${i.severity}/${i.area}] ${i.problem}\n      → ${i.suggestion}`)
  }
  // The critic suggests a better-fitting verse when the chosen one is a poor
  // match. It used to be computed and dropped on the floor; surface it, since
  // it is the one piece of advice that tells the operator WHAT to change.
  if (coherence.suggestedScriptureReference) {
    log(
      `   💡 better-fitting scripture: ${coherence.suggestedScriptureReference}`,
    )
  }
  if (coherence.skipped) blocking.push("coherence check could not run")
  else if (!coherence.coherent) {
    blocking.push(`coherence: ${coherence.summary}`)
  } else if (coherence.issues.some((i) => i.severity === "high")) {
    blocking.push("coherence: high-severity issue")
  }

  const depth = await critiqueReflection({
    sceneTitle: d.clip.title,
    reflection: d.reflection.text,
    conclusion: d.conclusion,
    abortSignal: input.abortSignal,
    llm: buildReflectionCriticLlm(),
  })
  log(
    `🔬 reflection depth ${depth.depthScore}/5 (${depth.solid ? "solid" : "THIN"}) — ${depth.summary}`,
  )
  for (const i of depth.issues) {
    log(`   ⚠️ [${i.severity}/${i.kind}] ${i.problem}\n      → ${i.suggestion}`)
  }
  if (depth.skipped) blocking.push("depth check could not run")
  else if (!depth.solid || depth.depthScore <= DEPTH_SCORE_FLOOR) {
    blocking.push(`depth ${depth.depthScore}/5: ${depth.summary}`)
  } else if (depth.issues.some((i) => i.severity === "high")) {
    blocking.push("depth: high-severity issue")
  }

  // Trimmed, not truthy. A whitespace-only excerpt is truthy, so the plain
  // truthiness test sent a blank source to the critic, which then had nothing to
  // compare against and reported the adaptation faithful — a false PASS. An
  // absent excerpt is the safe direction (it warns, below); a blank one was not.
  const sourceExcerpt = d.reflection.sourceExcerpt?.trim()
  if (input.checkFidelity && sourceExcerpt) {
    const fidelity = await critiqueReflectionFidelity({
      sourceExcerpt,
      // The SOURCE's own passage, not the film's. A Spurgeon selection is picked
      // by theme, so its reference can be a different book entirely — this critic
      // was being asked whether an adaptation of Isaiah was faithful to Luke.
      // Coherence above keeps the film passage, which is the verse on screen.
      focusReference:
        d.reflection.sourceReference ??
        input.passageReference ??
        d.passage.reference,
      adapted: d.reflection.text,
      abortSignal: input.abortSignal,
      llm: buildFidelityCriticLlm(),
    })
    log(
      `📜 source fidelity: ${fidelity.faithful ? "OK" : "ISSUES FOUND"} — ${fidelity.summary}`,
    )
    for (const i of fidelity.issues) {
      log(
        `   ⚠️ [${i.severity}/${i.kind}] ${i.problem}\n      → ${i.suggestion}`,
      )
    }
    if (fidelity.skipped) blocking.push("fidelity check could not run")
    else if (!fidelity.faithful) {
      blocking.push(`fidelity: ${fidelity.summary}`)
    } else if (fidelity.issues.some((i) => i.severity === "high")) {
      blocking.push("fidelity: high-severity issue")
    }
  } else if (input.checkFidelity) {
    // Asked to check fidelity but there is nothing to check against.
    //
    // WARN, do not block. This is deliberately weaker than the `skipped` case
    // above, and the distinction matters: `skipped` means a check that SHOULD
    // have run failed, whereas this means the input it needs was never recorded.
    // What reaches this branch in THIS runtime: a devotional read back from an
    // attempt artifact written before the field existed. Blocking those would
    // make already-approved work permanently unrenderable, and the excerpt cannot
    // be reconstructed after the fact — refusing to render existing good work is
    // worse than shipping it with one check unavailable.
    //
    // An earlier version of this comment justified the branch with "every
    // devo.json written before sourceExcerpt existed" and named `loadCachedDevo`.
    // Neither exists here: that was the old branch's on-disk cache, which this
    // runtime is explicitly forbidden to have. The reasoning survived the port
    // while its mechanism did not, so the branch looked better-founded than it
    // was.
    //
    // Freshly composed text always carries the excerpt, so on the path that
    // matters this branch does not fire.
    //
    // KNOWN GAP: `DevotionalReview` is `{ blocking }` only, so "fidelity was not
    // checked" reaches no caller — it lives in this log line and nowhere else. A
    // caller that wanted to treat it as a soft signal could not.
    log(
      "📜 source fidelity: NOT CHECKED — this devotional has no stored source " +
        "excerpt (text generated before the field existed). Regenerate to enable " +
        "the fidelity check.",
    )
  }

  return { blocking }
}
