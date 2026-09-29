import type { DevotionalLang } from "./devotional-locale"
import { checkDevotionalCoherence } from "./devotional-coherence"
import {
  buildCoherenceLlm,
  buildFidelityCriticLlm,
  buildReflectionCriticLlm,
  narrativeEditorModel,
} from "./devotional-models"
import { critiqueReflection } from "./devotional-reflection-critic"
import type { GeneratedDevotional } from "./generate-devotional"
import type { DevotionalLlm } from "./llm"
import { narrativeParagraphs, reviewNarrative } from "./narrative-editor"
import { createAgentLlm } from "../../mastra/agents/devotional/agent-llm"
import { narrativeEditorAgent } from "../../mastra/agents/devotional/narrative-editor-agent"
import { critiqueReflectionFidelity } from "./reflection-fidelity-critic"
import { checkReflectionVoice } from "./reflection-voice-check"

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
  /** The specific findings behind `blocking`, each with the check's own
   *  suggested fix, for a writer to act on (message-first path). */
  problems: string[]
}

export type ReviewDevotionalTextInput = {
  devotional: GeneratedDevotional
  /** Full passage reference for the coherence check, e.g. "Luke 19:1-10". */
  passageReference?: string
  /** Fidelity compares the adaptation against the ENGLISH source excerpt, so
   *  it is meaningless for a localized devotional. */
  checkFidelity: boolean
  /** Which language `devotional` is in. The voice rules are per-language; a
   *  localized run that omits this gets the English patterns and so gets no
   *  check at all. */
  lang?: DevotionalLang
  log?: (msg: string) => void
  /** Override the narrative editor's LLM (tests). Defaults to the Mastra
   *  agent, so Studio-published instruction edits apply. */
  narrativeLlm?: DevotionalLlm
}

/** Narrative findings that mean "not true", the ones a storyteller text is
 *  stopped for; the rest is an editor's advice. */
const FACT_KINDS = new Set([
  "unsupported-claim",
  "contradicts-story",
  "misquote",
  "planted-association",
])

export async function reviewDevotionalText(
  input: ReviewDevotionalTextInput,
): Promise<DevotionalReview> {
  const d = input.devotional
  const log = input.log ?? (() => {})
  const blocking: string[] = []
  const problems: string[] = []

  // Deterministic voice rules FIRST: they cost nothing, they never flake, and
  // a run that trips them is going to be regenerated anyway — no reason to buy
  // three critic calls to find that out. The critics judge whether the text is
  // good; this only judges whether it obeys the owner's standing rules, which
  // is not a matter of opinion and so should not be left to a model.
  const voice = checkReflectionVoice(d.reflection.text, {
    scriptureText: d.scripture.text,
    conclusion: d.conclusion,
    ...(input.lang ? { lang: input.lang } : {}),
  })
  for (const f of voice) {
    log(`   ⛔ [voice/${f.rule}] ${f.why}\n      “${f.sentence}”`)
    problems.push(`voice/${f.rule}: “${f.sentence}”. ${f.why}`)
  }
  if (voice.length > 0) {
    const rules = [...new Set(voice.map((f) => f.rule))].join(", ")
    blocking.push(
      `voice (${rules}): ${voice.length} sentence(s) break a standing rule, ` +
        `first is “${voice[0].sentence}”`,
    )
  }

  // Storyteller texts (owner, 2026-09-29) keep the standing rules and the
  // fact check; the coherence, depth and fidelity critics were dropped from
  // that path (the depth score flipped 4/5 to 2/5 on the same text).
  const storyteller = d.textPipeline === "storyteller"
  if (!storyteller) {
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
      log(
        `   ⚠️ [${i.severity}/${i.area}] ${i.problem}\n      → ${i.suggestion}`,
      )
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
      ...(d.clipTranscript ? { clipTranscript: d.clipTranscript } : {}),
      llm: buildReflectionCriticLlm(),
    })
    log(
      `🔬 reflection depth ${depth.depthScore}/5 (${depth.solid ? "solid" : "THIN"}) — ${depth.summary}`,
    )
    for (const i of depth.issues) {
      log(
        `   ⚠️ [${i.severity}/${i.kind}] ${i.problem}\n      → ${i.suggestion}`,
      )
      if (i.severity === "high")
        problems.push(`depth/${i.kind}: ${i.problem} Fix: ${i.suggestion}`)
    }
    if (depth.skipped) blocking.push("depth check could not run")
    else if (!depth.solid || depth.depthScore <= DEPTH_SCORE_FLOOR) {
      blocking.push(`depth ${depth.depthScore}/5: ${depth.summary}`)
    } else if (depth.issues.some((i) => i.severity === "high")) {
      blocking.push("depth: high-severity issue")
    }
  }

  // NARRATIVE EDITOR — the whole piece as a listener hears it, and every
  // credited paragraph's claims against its own source (see
  // narrative-editor.ts). Advisory below high severity: its medium/low
  // findings are an editor's suggestions, logged with the exact fix.
  const paragraphs = narrativeParagraphs(
    d.reflection.paragraphs?.length
      ? d.reflection.paragraphs
      : d.reflection.text
          .split(/\n{2,}/)
          .map((text) => ({ text: text.trim() }))
          .filter((p) => p.text),
  )
  const narrative = await reviewNarrative({
    sceneTitle: d.clip.title,
    scripture: { reference: d.scripture.reference, text: d.scripture.text },
    paragraphs,
    conclusion: d.conclusion,
    question: d.question,
    prayer: d.prayer,
    ...(d.message ? { message: d.message } : {}),
    llm:
      input.narrativeLlm ??
      createAgentLlm(narrativeEditorAgent, narrativeEditorModel()),
  })
  log(`✍️  narrative: ${narrative.summary}`)
  if (narrative.throughline) log(`   line: ${narrative.throughline}`)
  for (const i of narrative.issues) {
    // Medium tangents and repetitions go back too: they are the editor's
    // clearest calls, and a writer that never hears them repeats them.
    if (
      i.severity === "high" ||
      (i.severity === "medium" &&
        (i.kind === "tangent" || i.kind === "repetition"))
    )
      problems.push(
        `narrative/${i.kind} in paragraph ${i.paragraph}: “${i.quote}”. Fix: ${i.fix === "cut" ? "cut it" : `replace with “${i.replacement}”`} (${i.why})`,
      )
    log(
      `   ${i.severity === "high" ? "⛔" : "✂️"} [${i.severity}/${i.kind}] ¶${i.paragraph}: “${i.quote}”\n` +
        `      → ${i.fix === "cut" ? "cut" : `“${i.replacement}”`} (${i.why})`,
    )
  }
  if (narrative.skipped) blocking.push("narrative review could not run")
  else if (
    narrative.issues.some(
      (i) => i.severity === "high" && (!storyteller || FACT_KINDS.has(i.kind)),
    )
  ) {
    const high = narrative.issues.filter(
      (i) => i.severity === "high" && (!storyteller || FACT_KINDS.has(i.kind)),
    )
    blocking.push(
      `narrative: ${high.length} high-severity issue(s), first is ${high[0].kind} “${high[0].quote}”`,
    )
  }

  // An authored devotional credits several sources; the commentary excerpt
  // covers only the paragraphs under ITS credit. Checking the history and
  // language notes against Ryle would flag every one of them as invented.
  // When the writer tagged its paragraphs, only those that retell the
  // commentator are his: a credit carries forward on screen, but the writer's
  // own application after it is not Ryle's and must not be judged as if it were.
  const fidelityText = d.reflection.paragraphs?.some((p) => p.role)
    ? d.reflection.paragraphs
        .filter((p) => p.role === "classic")
        .map((p) => p.text)
        .join("\n\n")
    : d.reflection.paragraphs?.some((p) => p.mark)
      ? paragraphs
          .filter((p) => p.evidence === d.reflection.sourceExcerpt)
          .map((p) => p.text)
          .join("\n\n")
      : d.reflection.text
  if (
    !storyteller &&
    input.checkFidelity &&
    d.reflection.sourceExcerpt &&
    fidelityText
  ) {
    const fidelity = await critiqueReflectionFidelity({
      sourceExcerpt: d.reflection.sourceExcerpt,
      focusReference: input.passageReference ?? d.passage.reference,
      adapted: fidelityText,
      llm: buildFidelityCriticLlm(),
    })
    log(
      `📜 source fidelity: ${fidelity.faithful ? "OK" : "ISSUES FOUND"} — ${fidelity.summary}`,
    )
    for (const i of fidelity.issues) {
      if (i.severity === "high")
        problems.push(`fidelity/${i.kind}: ${i.problem} Fix: ${i.suggestion}`)
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
  } else if (input.checkFidelity && !storyteller) {
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

  return { blocking, problems }
}
