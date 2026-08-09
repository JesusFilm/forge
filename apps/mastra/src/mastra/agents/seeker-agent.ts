import { createRequire } from "node:module"

import {
  Agent,
  type AgentConfig,
  type ModelWithRetries,
  type ToolsInput,
} from "@mastra/core/agent"
import type { MastraModelConfig } from "@mastra/core/llm"

import {
  env,
  isAiGatewaySeekerEnabled,
  isSeekerVideoEnabled,
} from "../../config/env"
import { STEP_CAPS } from "../budgets"
import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "../gateway-constants"
import { getAiChatMemory } from "../ai-chat-memory"
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
import {
  buildSeekerProductionIdentity,
  SEEKER_PRODUCTION_GATEWAY_TIMEOUT_MS,
  SEEKER_PRODUCTION_PROMPT,
} from "./seeker-production-config"

export { SEEKER_SYSTEM_PROMPT_FALLBACK, SEEKER_SYSTEM_PROMPT_NAME }

// ESM-compatible `require` for the provider SDK load below. The provider SDK
// requires survive the Mastra CLI Rollup bundle because they target real
// package names; a static `import` of an `@ai-sdk/*` module (including
// transitively via `../providers`) trips the "Cannot determine intended
// module format" trap. Same trick `default-chat-agent.ts` and
// `specialized-agents.ts` use; see `../gateway-constants` for the
// bundle-safety rationale.
const require = createRequire(import.meta.url)

/**
 * Per-attempt wall-clock budget for gateway chat requests (feat-237, KTD9).
 * Mastra's fallback loop advances only on a THROWN error and the AI SDK's
 * default fetch has no timeout, so a gateway that accepts the connection but
 * never responds (Cloudflare's ~100s proxy read timeout exceeds the route's
 * 90s `TIME_BUDGET_MS.chatTurn`) would eat the whole turn instead of failing
 * over to Gemma. The worst-case gateway occupancy is
 * `(maxRetries + 1) * SEEKER_GATEWAY_FETCH_TIMEOUT_MS` — @mastra/core's
 * per-entry retry loop (p-retry) retries ANY non-APICallError, and a timeout
 * abort is a TimeoutError DOMException, so it WOULD be retried if the entry
 * allowed retries (verified in the installed dist; this corrects the plan's
 * "only 408/429/5xx retry" assumption). Both factors are pinned by test so
 * the whole envelope stays strictly below the turn budget —
 * outbound-timeout-shorter-than-caller-budget law.
 *
 * KNOWN TRADE-OFF (review finding): this signal spans the ENTIRE fetch
 * including the streaming body read, so a HEALTHY gateway response still
 * emitting tokens at the deadline is aborted mid-answer and the turn falls
 * over to Gemma — with any already-streamed tokens left in the reply (no
 * model-boundary reset; empirically reproduced pre-merge). The value is 55s,
 * raised from the plan's ~30s after the pre-merge smoke measured healthy
 * gateway turns up to ~27s on routine questions — 55s gives ~2x headroom on
 * the worst observed turn while a hang still leaves the Gemma chain ~35s of
 * the 90s turn budget. If dogfood shows hangs eating that 55s often, the
 * follow-up is a time-to-first-byte + idle-per-chunk guard, not a lower cap.
 */
export const SEEKER_GATEWAY_FETCH_TIMEOUT_MS =
  SEEKER_PRODUCTION_GATEWAY_TIMEOUT_MS

/**
 * Timeout-wrapping fetch for the gateway entry (KTD9). Exported as a factory
 * so the abort MECHANISM is unit-testable (per the repo's test-the-mechanism
 * discipline), with `fetchImpl` injectable for tests; production passes no
 * second argument. `ModelWithRetries.modelSettings` has no `abortSignal`, so
 * the budget must live here in the provider's fetch. Composes with the AI
 * SDK's own per-call signal via `AbortSignal.any` so route-side aborts still
 * win when they fire first.
 */
export function createGatewayFetchWithTimeout(
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return (input, init) =>
    fetchImpl(input, {
      ...init,
      signal:
        init?.signal != null
          ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
    })
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
 * Build the seeker's model fallback array (feat-237). Two branches:
 *
 * DISABLED (default — flag or key unset): exactly today's two-entry chain of
 * free Gemma 4 OpenRouter models, via Mastra's built-in `openrouter`
 * model-router provider, which auto-reads `OPENROUTER_API_KEY` (declared
 * `.optional()` in config/env.ts — no new required env var). The `openrouter/`
 * prefix selects the provider/endpoint; the model id is OpenRouter's
 * namespaced catalog name. If `OPENROUTER_API_KEY` is unset, the agent errors
 * at generate time in Studio (a runtime error, not a boot crash). The
 * free-tier primary errors intermittently (feat-198 residual), so retry it
 * once, then fall through to OpenRouter's other free Gemma 4 model. NOTE:
 * only the seeker uses OpenRouter — smokeAgent and webResearchAgent stay on
 * `openai/...` (OPENAI_API_KEY).
 *
 * ENABLED (`AI_GATEWAY_CHAT_API_KEY` set AND `AI_GATEWAY_SEEKER_ENABLED`
 * exactly `"true"` — KTD5: the key is shared with the experience-agent
 * opt-in, so key presence alone must never flip the seeker): the same chain
 * with the self-hosted JesusFilm gateway chat model prepended
 * (`AI_GATEWAY_CHAT_MODEL ?? "coding"`, no per-entry retries — the Gemma
 * chain IS the retry; see the maxRetries comment on the entry). Any thrown
 * gateway error fails over to today's Gemma behavior; unsetting the flag (or
 * key) restores the disabled branch with no code change (R9). Deliberately
 * gated on its OWN flag, not the experience agents' `AI_GATEWAY_CHAT_ENABLED`
 * — the two surfaces have different risk profiles and roll back
 * independently (KTD1).
 *
 * Exported for direct unit testing; the singleton below consumes it at module
 * load.
 */
export function buildSeekerModelList(): ModelWithRetries[] {
  const gatewayEnabled = Boolean(
    env.AI_GATEWAY_CHAT_API_KEY && isAiGatewaySeekerEnabled(),
  )
  const identity = buildSeekerProductionIdentity({
    gatewayEnabled,
    gatewayModel: env.AI_GATEWAY_CHAT_MODEL,
    gatewayBaseUrl: env.AI_GATEWAY_CHAT_BASE_URL,
  })
  const gemmaFallbackChain: ModelWithRetries[] = identity.models.routes
    .filter((route) => route.provider === "openrouter")
    .map((route) => ({
      model: `openrouter/${route.model}`,
      maxRetries: route.maxRetries,
    }))

  if (gatewayEnabled) {
    // JesusFilm AI gateway (OpenAI-compatible). The @ai-sdk/openai SDK is
    // loaded via the createRequire shim (not imported from ../providers) to
    // keep that module's static `@ai-sdk/*` imports out of the Mastra CLI
    // Rollup bundle. The gateway base URL + User-Agent come from the
    // import-free `../gateway-constants` module. The User-Agent dodges
    // Cloudflare's 403 on missing/odd UAs.
    const { createOpenAI } =
      require("@ai-sdk/openai") as typeof import("@ai-sdk/openai")
    const gateway = createOpenAI({
      apiKey: env.AI_GATEWAY_CHAT_API_KEY,
      baseURL: env.AI_GATEWAY_CHAT_BASE_URL ?? DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
      name: "jesusfilm",
      headers: {
        "User-Agent": AI_GATEWAY_USER_AGENT,
      },
      // KTD9 per-attempt timeout — see createGatewayFetchWithTimeout above.
      fetch: createGatewayFetchWithTimeout(SEEKER_GATEWAY_FETCH_TIMEOUT_MS),
    })
    return [
      {
        // `.chat()` pins the chat-completions endpoint. The bare callable
        // `gateway(id)` defaults to the Responses API in @ai-sdk/openai v3,
        // which crashes the gateway's vLLM backend on multi-turn tool
        // conversations (`KeyError: 'role'`). Chat-completions handles the
        // same tool history fine. Cast per the repo's established discipline
        // (KTD8): the provider-returned model's LanguageModelV2 shape drifts
        // across AI SDK peer-version copies, so it is not directly assignable
        // to Mastra's MastraModelConfig union; the runtime contract is fine —
        // same drift default-chat-agent.ts / specialized-agents.ts absorb.
        model: gateway.chat(
          identity.models.routes[0]?.model ?? "coding",
        ) as unknown as MastraModelConfig,
        // 0, NOT 1 (deviation from the plan's R1, review-verified): Mastra's
        // per-entry retry (p-retry) retries ANY non-APICallError, so a KTD9
        // timeout abort WOULD be retried — a hanging gateway would burn
        // (retries+1) x the fetch timeout before failover, blowing the intent
        // of the in-budget guarantee. With 0, a hang costs exactly one
        // timeout window and the Gemma chain below IS the retry; a transient
        // gateway 5xx also falls straight to Gemma, today's behavior anyway.
        maxRetries: 0,
      },
      ...gemmaFallbackChain,
    ]
  }

  return gemmaFallbackChain
}

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
    /** Legacy test seam; exact resolution is intentionally uncached. */
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
  return async () => {
    const pinned = overrides.pinned ?? SEEKER_PRODUCTION_PROMPT
    // feat-330 (plan P2 end state): the resolved managed text is returned
    // VERBATIM — there is no longer any code-appended block, and this resolver
    // reads no flag. `SEEKER_VIDEO_ENABLED` now gates `buildSeekerTools` only,
    // so the resolved instructions are identical in both flag states and a
    // flag flip can never change what `/api/agents*` serves. The
    // video-featuring guidance lives in the managed prompt (and, as fallback,
    // in SEEKER_SYSTEM_PROMPT_FALLBACK above). Do not reintroduce an append
    // here: it would silently diverge the two prompt sources again.
    const resolved = await resolveExactManagedPrompt({
      name: pinned.name,
      version: Number(pinned.revision),
      expectedContentHash: pinned.contentHash,
      config: overrides.config,
      fetchImpl: overrides.fetchImpl,
    })
    if (resolved.ok) return resolved.text

    if (!criticalAlertEmitted) {
      criticalAlertEmitted = true
      ;(overrides.logSink ?? console.error)(
        `[seeker-production-prompt] severity=critical state=degraded_fallback provider=${pinned.provider} name=${pinned.name} revision=${pinned.revision} reason=${resolved.reason}${resolved.detail ? ` detail=${resolved.detail}` : ""}`,
      )
    }
    return SEEKER_SYSTEM_PROMPT_FALLBACK
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
