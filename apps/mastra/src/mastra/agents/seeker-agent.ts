import {
  Agent,
  type AgentConfig,
  type ModelWithRetries,
  type ToolsInput,
} from "@mastra/core/agent"

import { isSeekerVideoEnabled } from "../../config/env"
import { STEP_CAPS } from "../budgets"
import { getAiChatMemory } from "../ai-chat-memory"
import {
  buildSeekerModelList,
  buildSeekerGatewayModelEntry,
  createGatewayFetchWithTimeout,
  SEEKER_GATEWAY_FETCH_TIMEOUT_MS,
} from "../seeker-model-list"
import {
  resolveExactManagedPrompt,
  type ExactManagedPromptInput,
} from "../../services/langfuse-prompt-client"
import {
  buildRetrieveAnswerTool,
  retrieveAnswerTool,
  type RetrieveAnswerSearch,
} from "../tools/retrieve-answer"
import { featureVideoTool } from "../tools/feature-video"
import { createSeekerSearchVideosTool } from "../tools/seeker-search-videos"
import {
  SEEKER_SYSTEM_PROMPT_FALLBACK,
  SEEKER_SYSTEM_PROMPT_NAME,
} from "./seeker-prompt"
import { SEEKER_PRODUCTION_PROMPT } from "./seeker-production-config"

export { SEEKER_SYSTEM_PROMPT_FALLBACK, SEEKER_SYSTEM_PROMPT_NAME }

// Model-chain construction moved to the `../seeker-model-list` leaf module
// (feat-405 U1/KTD2) so `ai-chat-memory.ts` and the title-repair sweep can
// import it without an ESM cycle through this module's module-scope agent
// build. Re-exported here so existing importers
// (`seeker-follow-ups-generate.ts`, tests, evals) need no import changes.
export {
  buildSeekerModelList,
  buildSeekerGatewayModelEntry,
  createGatewayFetchWithTimeout,
  SEEKER_GATEWAY_FETCH_TIMEOUT_MS,
}

/**
 * Seeker agent (feat-198, feat-199) — the first conversational agent of the
 * planned headless multi-agent "Jesus Film AI Chat" system, here as a
 * Studio-only agent. It proves the chat -> tool-call -> remembered-context
 * shape: citation-disciplined instructions, the `retrieveAnswer` tool backed by
 * live RAG retrieval (feat-199), and the shared ai-chat lane `Memory`
 * (feat-208 — Postgres-persisted in the `ai_chat` schema).
 *
 * Containment is the network/gateway boundary, NOT this code: once registered,
 * Mastra's built-in `/api/agents/*` surface exposes the agent to anyone who can
 * reach the Mastra HTTP endpoint. "Studio-only" means "behind
 * apps/mastra-gateway + Railway networking". Do not promote to a public surface
 * before the deferred guardrail gate AND an explicit gateway access decision.
 */

/**
 * Resolve the seeker's tool set for one invocation (feat-327, plan P1).
 *
 * SINGLE agent: the video capability is gated here, on the ONE registered
 * `seekerAgent`, rather than by registering a second agent. Flag off ⇒ the
 * agent's RESOLVED tool set is exactly today's `{ retrieveAnswer }`.
 *
 * ONE deliberate behavior change with the flag OFF, measured against
 * @mastra/core 1.55.0 (2026-08-03) and pinned by test: making `tools`
 * function-valued removes these tools from Mastra's GLOBAL tool registry.
 * Registration only walks `tools` when it is a plain object
 * (`typeof this.#tools === "object"`), so `mastra.listTools()` no longer lists
 * `retrieveAnswer`, and neither it nor the flag-on video tools are reachable on
 * the built-in `/api/tools/:toolId/execute` surface. That direction is
 * WANTED — it takes a RAG-spending tool, and later an admin-bearer-spending
 * one, off a code-unauthenticated direct-execute surface — so it is documented
 * and pinned rather than reverted. Apart from that registry footprint, the
 * flag-off resolved tool set and per-turn behavior are byte-identical to the
 * pre-feat-327 agent.
 *
 * SCOPE CORRECTION (feat-330): the resolved INSTRUCTIONS are no longer part of
 * that byte-identical claim. The video guidance is now durable prompt content
 * on both prompt sources, so a flag-off agent still SERVES it (phrased
 * tool-conditionally so it degrades to "I can't look up a video right now").
 * What the flag now controls is exactly the tool set below — nothing else.
 *
 * Wired as a function-valued `tools` (Mastra `DynamicArgument`) so the flag is
 * read per invocation and so each turn gets a FRESH `searchVideos` instance —
 * which is what makes that tool's per-turn call cap a closure rather than
 * module state. Mastra invokes this resolver more than once per turn (see
 * `createSeekerSearchVideosTool` for the measured behavior), so keep it cheap
 * and free of side effects beyond constructing tools.
 *
 * CONTAINMENT NOTE (plan P1, honest version): with the flag on, this grows the
 * capability reachable on Mastra's code-unauthenticated `/api/agents/*`
 * surface — `searchVideos` there spends the production
 * `ADMIN_AGENT_TOOLS_API_KEY` bearer per invocation. Agent COUNT is unchanged;
 * reachable capability is not. The binding containment stays the
 * network/gateway boundary. See apps/mastra/CLAUDE.md "Containment".
 */
function resolveSeekerTools(ragSearch?: RetrieveAnswerSearch): ToolsInput {
  const retrieveAnswer =
    ragSearch === undefined
      ? retrieveAnswerTool
      : buildRetrieveAnswerTool({ search: ragSearch })
  if (!isSeekerVideoEnabled()) {
    return { retrieveAnswer }
  }
  return {
    retrieveAnswer,
    searchVideos: createSeekerSearchVideosTool(),
    featureVideo: featureVideoTool,
  }
}

export function buildSeekerTools(): ToolsInput {
  return resolveSeekerTools()
}

export type SeekerAgentOverrides = {
  ragSearch?: RetrieveAnswerSearch
  models?: ModelWithRetries[]
  memory?: AgentConfig["memory"]
  instructions?: AgentConfig["instructions"]
}

/**
 * Dynamic instructions resolve the repository-reviewed exact prompt version
 * and expected hash. A missing, deleted, unauthorized, malformed, or
 * mismatched managed version preserves runtime availability by returning the
 * compiled fallback, but that path is explicitly degraded and emits one
 * critical, body-free alert per resolver. Production never consults a label
 * or stale cache; moving `production` cannot change live traffic.
 */
export function createSeekerInstructionsResolver(
  overrides: Omit<
    ExactManagedPromptInput,
    "name" | "version" | "expectedContentHash"
  > & {
    logSink?: (line: string) => void
    now?: () => number
    failureCooldownMs?: number
    /** Legacy test seam retained for call-site compatibility. */
    cache?: unknown
    pinned?: {
      provider: string
      name: string
      revision: string
      contentHash: string
    }
  } = {},
): () => Promise<string> {
  let criticalAlertEmitted = false
  let cacheEntry: { identity: string; text: string } | null = null
  let failureCooldownUntil = 0
  let inFlight: { identity: string; promise: Promise<string> } | null = null
  return async () => {
    const pinned = overrides.pinned ?? SEEKER_PRODUCTION_PROMPT
    const identityKey = `${pinned.provider}\u0000${pinned.name}\u0000${pinned.revision}\u0000${pinned.contentHash}`
    if (cacheEntry?.identity === identityKey) return cacheEntry.text
    const now = overrides.now?.() ?? Date.now()
    if (now < failureCooldownUntil) return SEEKER_SYSTEM_PROMPT_FALLBACK
    if (inFlight?.identity === identityKey) return inFlight.promise
    // feat-330 (plan P2 end state): the resolved managed text is returned
    // VERBATIM — there is no longer any code-appended block, and this resolver
    // reads no flag. `SEEKER_VIDEO_ENABLED` now gates `buildSeekerTools` only,
    // so the resolved instructions are identical in both flag states and a
    // flag flip can never change what `/api/agents*` serves. The
    // video-featuring guidance lives in the managed prompt (and, as fallback,
    // in SEEKER_SYSTEM_PROMPT_FALLBACK above). Do not reintroduce an append
    // here: it would silently diverge the two prompt sources again.
    const promise = (async () => {
      const resolved = await resolveExactManagedPrompt({
        name: pinned.name,
        version: Number(pinned.revision),
        expectedContentHash: pinned.contentHash,
        config: overrides.config,
        fetchImpl: overrides.fetchImpl,
      })
      if (resolved.ok) {
        cacheEntry = { identity: identityKey, text: resolved.text }
        failureCooldownUntil = 0
        criticalAlertEmitted = false
        return resolved.text
      }

      failureCooldownUntil =
        (overrides.now?.() ?? Date.now()) +
        (overrides.failureCooldownMs ??
          overrides.config?.promptFailureCooldownMs ??
          10_000)

      if (!criticalAlertEmitted) {
        criticalAlertEmitted = true
        ;(overrides.logSink ?? console.error)(
          `[seeker-production-prompt] severity=critical state=degraded_fallback provider=${pinned.provider} name=${pinned.name} revision=${pinned.revision} reason=${resolved.reason}${resolved.detail ? ` detail=${resolved.detail}` : ""}`,
        )
      }
      return SEEKER_SYSTEM_PROMPT_FALLBACK
    })()
    inFlight = { identity: identityKey, promise }
    try {
      return await promise
    } finally {
      if (inFlight?.promise === promise) inFlight = null
    }
  }
}

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
export function buildSeekerAgent(overrides: SeekerAgentOverrides = {}) {
  const tools =
    overrides.ragSearch === undefined
      ? buildSeekerTools
      : () => resolveSeekerTools(overrides.ragSearch)

  return new Agent({
    id: "seekerAgent",
    name: "Seeker Agent",
    description:
      "Skeleton conversational agent for people exploring Christianity and who Jesus is. Studio-only, non-production prototype.",
    // Langfuse-managed system prompt (feat-272): resolved per turn through
    // exact repository-pinned `seeker-system` version and hash, with
    // SEEKER_SYSTEM_PROMPT_FALLBACK served byte-identically whenever Langfuse
    // is unconfigured or unreachable. See createSeekerInstructionsResolver above.
    instructions: overrides.instructions ?? createSeekerInstructionsResolver(),
    // Env-gated fallback chain (feat-237) — see buildSeekerModelList above for
    // both branches. Evaluated once at module load; Mastra's fallback loop
    // walks the resulting array per request.
    model: overrides.models ?? buildSeekerModelList(),

    // Flag-gated tool set (feat-327): function-valued so `SEEKER_VIDEO_ENABLED`
    // is read per invocation and each turn gets a fresh searchVideos instance.
    // Passed BARE — no seam — so the flag-off pin in seeker-agent.test.ts reads
    // the real env source at this call site. See buildSeekerTools above.
    tools,
    // ai-chat lane memory (feat-208): Postgres-persisted in the `ai_chat`
    // schema (or in-memory under the memory backend). Shared with future
    // ai-chat agents; thread access is gated in seeker-route.ts, not here.
    memory: overrides.memory ?? getAiChatMemory(),
    // Step-budget floor (feat-202). The bearer-gated `/forge-seeker` route sets
    // `maxSteps: STEP_CAPS.toolCallingTurn` at its call site, but the built-in,
    // code-unauthenticated `/api/agents/seekerAgent` surface (reachable by any
    // in-network caller) carries no budget. Setting it on `defaultOptions` (the
    // vNext field `.stream()`/`.generate()` deep-merge in, NOT the unused
    // `defaultStreamOptionsLegacy`) gives that path a runaway-loop ceiling.
    // Reuses the route's SAME shared constant so the two paths can't diverge.
    // It is a DEFAULT floor, not an un-overridable ceiling: deep-merge lets an
    // explicit per-call `maxSteps` win — the same property the route's budget has.
    defaultOptions: { maxSteps: STEP_CAPS.toolCallingTurn },
  })
}

export const seekerAgent = buildSeekerAgent()
