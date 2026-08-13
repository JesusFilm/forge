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

export class DevotionalQualityGateError extends Error {
  readonly code = "quality_gate_failed"
  constructor(readonly reasons: string[]) {
    super(
      `devotional text failed the quality gate before audio/video: ${reasons.join("; ")}`,
    )
    this.name = "DevotionalQualityGateError"
  }
}

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

  if (input.checkFidelity && d.reflection.sourceExcerpt) {
    const fidelity = await critiqueReflectionFidelity({
      sourceExcerpt: d.reflection.sourceExcerpt,
      focusReference: input.passageReference ?? d.passage.reference,
      adapted: d.reflection.text,
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
    // Every devo.json written before `sourceExcerpt` existed looks like this, and
    // blocking would make those devotionals permanently unrenderable — there is
    // no migration, `loadCachedDevo` is a raw JSON.parse, and the excerpt cannot
    // be reconstructed after the fact. Refusing to render existing good work is a
    // worse outcome than shipping it with one check unavailable.
    //
    // Freshly generated text always carries the excerpt, so on the path that
    // matters this branch does not fire.
    log(
      "📜 source fidelity: NOT CHECKED — this devotional has no stored source " +
        "excerpt (text generated before the field existed). Regenerate to enable " +
        "the fidelity check.",
    )
  }

  return { blocking }
}
