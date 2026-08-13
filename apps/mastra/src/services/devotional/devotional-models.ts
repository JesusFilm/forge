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
 * default openai/gpt-4o). Safety is DEVOTIONAL_SAFETY_MODEL. Change a choice by
 * editing this map. Falls back to DEVOTIONAL_MODEL for any unset entry.
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

/** LLM instances keyed to the seams `composeDevotionalContent` uses. */
export type DevotionalAgentLlms = {
  scripture?: DevotionalLlm
  spurgeon?: DevotionalLlm
  modernize?: DevotionalLlm
  pointPicker?: DevotionalLlm
  copy?: DevotionalLlm
  conclusion?: DevotionalLlm
  highlights?: DevotionalLlm
}

function modelFor(agent: DevotionalAgent): string {
  return DEVOTIONAL_AGENT_MODELS[agent] || getDevotionalModel()
}

/** Build one LLM per content agent from the model map (shared OpenRouter key). */
export function buildDevotionalAgentLlms(): Required<DevotionalAgentLlms> {
  return {
    scripture: createDevotionalLlm({ model: modelFor("scripture") }),
    spurgeon: createDevotionalLlm({ model: modelFor("spurgeonRanker") }),
    modernize: createDevotionalLlm({ model: modelFor("modernizer") }),
    pointPicker: createDevotionalLlm({ model: modelFor("pointPicker") }),
    copy: createDevotionalLlm({ model: modelFor("copywriter") }),
    conclusion: createDevotionalLlm({ model: modelFor("conclusionWriter") }),
    highlights: createDevotionalLlm({ model: modelFor("highlighter") }),
  }
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
