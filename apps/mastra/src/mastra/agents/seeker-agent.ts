import { Agent } from "@mastra/core/agent"

import { getSeekerMemory } from "../memory"
import { retrieveAnswerTool } from "../tools/retrieve-answer"

/**
 * Seeker agent (feat-170) — the first conversational agent of the planned
 * headless multi-agent "Jesus Film AI Chat" system, here as a Studio-only
 * SKELETON. It proves the chat -> tool-call -> remembered-context shape:
 * placeholder instructions, the stub `retrieveAnswer` tool, and per-agent
 * in-memory `Memory`.
 *
 * Containment is the network/gateway boundary, NOT this code: once registered,
 * Mastra's built-in `/api/agents/*` surface exposes the agent to anyone who can
 * reach the Mastra HTTP endpoint. "Studio-only" means "behind
 * apps/mastra-gateway + Railway networking". Do not promote to a public surface
 * before the deferred guardrail gate AND an explicit gateway access decision.
 */

// GUARDRAIL ATTACH-POINT (R4) — deferred, no logic yet.
// This is where later honesty / fabrication / AI-disclosure /
// doctrinal-uncertainty and crisis-handling checks (suicidal-ideation /
// self-harm / acute distress -> route to a human / helpline; never improvise)
// belong: gating the raw user turn BEFORE any tool call and the assembled
// response on the way out. The actual attach MECHANISM is a deferred design
// choice — Mastra's Agent constructor does not expose separate pre-tool /
// post-response hooks, so this will likely be an input/output wrapper at the
// generate/stream call site or a middleware layer, NOT a constructor field.
// Any config those checks need must be `.optional()` + runtime fallback — the
// skeleton adds ZERO required env vars (KTD5), so a placeholder is never
// promoted to required-at-load and never bricks a Railway deploy.
export const seekerAgent = new Agent({
  id: "seekerAgent",
  name: "Seeker Agent",
  description:
    "Skeleton conversational agent for people exploring Christianity and who Jesus is. Studio-only, non-production prototype.",
  instructions: [
    "You help people who are exploring Christianity and who Jesus is.",
    "Be warm, honest, and humble; meet people where they are and never pressure them.",
    "Use the retrieveAnswer tool to ground factual answers rather than answering factual questions from memory.",
    "SAFETY: You are a non-production prototype exercised only in Mastra Studio. You must not invent scripture, citations, or doctrinal claims — even in Studio. If you do not have a grounded answer, say so plainly.",
  ].join("\n"),
  // OpenRouter via Mastra's built-in `openrouter` model-router provider, which
  // auto-reads `OPENROUTER_API_KEY` (declared `.optional()` in config/env.ts —
  // no new required env var, KTD5 holds). The `openrouter/` prefix selects the
  // provider/endpoint; the model id is OpenRouter's namespaced catalog name.
  // NOTE: only the seeker uses OpenRouter — smokeAgent and webResearchAgent stay
  // on `openai/...` (OPENAI_API_KEY), so both keys are present in this app today.
  // If `OPENROUTER_API_KEY` is unset, the agent errors at generate time in
  // Studio (a runtime error, not a boot crash).
  model: "openrouter/google/gemma-4-31b-it:free",
  tools: {
    retrieveAnswer: retrieveAnswerTool,
  },
  memory: getSeekerMemory(),
})
