/**
 * Per-agent model assignment for devotional CONTENT generation.
 *
 * Different seams need different strengths, so each gets a fit-for-purpose model
 * rather than one model for everything (benchmark-driven, owner decision):
 *   - scripture / highlighter → cheap+capable (trivial extraction).
 *   - spurgeonRanker → mid (ranking judgment).
 *   - modernizer / copywriter → strongest (faithfulness, focus discipline, and
 *     creative quality — these drive reflection accuracy and the title/hook).
 *
 * Translation/adaptation is configured separately (DEVOTIONAL_TRANSLATE_MODEL,
 * default openai/gpt-4o). Safety is DEVOTIONAL_SAFETY_MODEL. Falls back to
 * DEVOTIONAL_MODEL for any unset entry.
 *
 * WHICH ENTRIES ACTUALLY APPLY. Only `coherence`, `reflectionCritic` and
 * `fidelityCritic` are consulted today, through the three builders below. The
 * content seams (scripture, modernizer, copywriter, highlighter, spurgeonRanker)
 * get their model from the workflow instead, which pairs each with a Mastra agent
 * — see contentDependencies in video-first-devotional.ts. `pointPicker` and
 * `conclusionWriter` are consulted by NOBODY: those two seams currently run on
 * the caller's shared LLM, so editing either line here changes nothing until
 * they are given agents of their own. Recorded rather than deleted because the
 * choices are owner decisions with reasons, not defaults.
 *
 * A `buildDevotionalAgentLlms()` that built one LLM per content seam used to sit
 * here. Nothing ever called it, and it read as if this map drove the content
 * pipeline. Removed.
 */
import { getDevotionalModel } from "../../config/env"
import { createDevotionalLlm, type DevotionalLlm } from "./llm"

export type DevotionalAgent =
  | "scripture"
  | "spurgeonRanker"
  | "modernizer"
  | "pointPicker"
  | "copywriter"
  | "conclusionWriter"
  | "highlighter"
  | "coherence"
  | "reflectionCritic"
  | "fidelityCritic"

export const DEVOTIONAL_AGENT_MODELS: Record<DevotionalAgent, string> = {
  scripture: "openai/gpt-4o-mini",
  spurgeonRanker: "openai/gpt-4o",
  modernizer: "anthropic/claude-sonnet-4.5",
  // Which of the commentary's points to build on — a small, structured
  // ranking judgment (same shape as spurgeonRanker, so same model).
  pointPicker: "openai/gpt-4o",
  copywriter: "anthropic/claude-sonnet-4.5",
  // Owner call: try an OpenAI model here — belief that OpenAI models handle
  // short, precise prose (one sentence, tightly constrained) better than
  // Claude for this specific seam. Easy to swap back; it's just this line.
  conclusionWriter: "openai/gpt-4o",
  highlighter: "openai/gpt-4o-mini",
  // Whole-message coherence check (grounding, scripture fit, title, flow).
  coherence: "anthropic/claude-sonnet-4.5",
  // Reflection depth critic (tautology / repetition / obvious / ungrounded).
  reflectionCritic: "anthropic/claude-sonnet-4.5",
  // Source-fidelity critic (invented content / dropped argument / narrative
  // erasure / imprecise theology) — needs the same strength as the modernizer
  // since it's re-deriving the same judgment call in reverse.
  fidelityCritic: "anthropic/claude-sonnet-4.5",
}

function modelFor(agent: DevotionalAgent): string {
  return DEVOTIONAL_AGENT_MODELS[agent] || getDevotionalModel()
}

/** LLM for the whole-message coherence checker. */
export function buildCoherenceLlm(): DevotionalLlm {
  return createDevotionalLlm({ model: modelFor("coherence") })
}

/** LLM for the reflection depth critic. */
export function buildReflectionCriticLlm(): DevotionalLlm {
  return createDevotionalLlm({ model: modelFor("reflectionCritic") })
}

/** LLM for the source-fidelity critic. */
export function buildFidelityCriticLlm(): DevotionalLlm {
  return createDevotionalLlm({ model: modelFor("fidelityCritic") })
}
