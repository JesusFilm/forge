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
 */

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
  log(`🔎 coherence: ${coherence.coherent ? "OK" : "ISSUES FOUND"} — ${coherence.summary}`)
  for (const i of coherence.issues) {
    log(`   ⚠️ [${i.severity}/${i.area}] ${i.problem}\n      → ${i.suggestion}`)
  }
  if (coherence.skipped) blocking.push("coherence check could not run")
  else if (coherence.issues.some((i) => i.severity === "high")) {
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
  else if (depth.issues.some((i) => i.severity === "high")) {
    blocking.push("depth: high-severity issue")
  }

  if (input.checkFidelity && d.reflection.sourceExcerpt) {
    const fidelity = await critiqueReflectionFidelity({
      sourceExcerpt: d.reflection.sourceExcerpt,
      focusReference: input.passageReference ?? d.passage.reference,
      adapted: d.reflection.text,
      llm: buildFidelityCriticLlm(),
    })
    log(`📜 source fidelity: ${fidelity.faithful ? "OK" : "ISSUES FOUND"} — ${fidelity.summary}`)
    for (const i of fidelity.issues) {
      log(`   ⚠️ [${i.severity}/${i.kind}] ${i.problem}\n      → ${i.suggestion}`)
    }
    if (fidelity.skipped) blocking.push("fidelity check could not run")
    else if (fidelity.issues.some((i) => i.severity === "high")) {
      blocking.push("fidelity: high-severity issue")
    }
  }

  return { blocking }
}
