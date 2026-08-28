/**
 * Seeker model-list leaf module (feat-405, U1/KTD2). Extracted from
 * `agents/seeker-agent.ts` so BOTH `seeker-agent.ts` and the ai-chat titling
 * path (`ai-chat-memory.ts`, feat-405 U2) plus the title-repair sweep
 * (feat-405 U4) can import the seeker's model chain without an ESM cycle:
 * `seeker-agent.ts` already imports `ai-chat-memory.ts`, and the reverse
 * import would be exercised at module evaluation (`seeker-agent.ts` builds the
 * agent at module scope). This module is a LEAF — it imports only
 * `config/env`, `gateway-constants`, and `agents/seeker-production-config`
 * (itself a leaf over `gateway-constants`); keep it that way.
 *
 * `seeker-agent.ts` re-exports everything here, so existing importers
 * (`seeker-follow-ups-generate.ts`, tests, evals) are untouched.
 */

import { createRequire } from "node:module"

import type { ModelWithRetries } from "@mastra/core/agent"
import type { MastraModelConfig } from "@mastra/core/llm"

import { env, isAiGatewaySeekerEnabled } from "../config/env"
import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "./gateway-constants"
import {
  buildSeekerProductionIdentity,
  SEEKER_PRODUCTION_GATEWAY_TIMEOUT_MS,
} from "./agents/seeker-production-config"

// ESM-compatible `require` for the provider SDK load below. The provider SDK
// requires survive the Mastra CLI Rollup bundle because they target real
// package names; a static `import` of an `@ai-sdk/*` module (including
// transitively via `./providers`) trips the "Cannot determine intended
// module format" trap. Same trick `default-chat-agent.ts` and
// `specialized-agents.ts` use; see `./gateway-constants` for the
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
 * Build the JesusFilm gateway chat entry, or null when `AI_GATEWAY_CHAT_API_KEY`
 * is unset (feat-405 U1, KTD4's key-presence rule). Deliberately does NOT read
 * `AI_GATEWAY_SEEKER_ENABLED`: that flag is feat-237's documented seeker
 * incident-rollback lever, and the title-repair sweep must keep its gateway
 * access during exactly the outage that strands threads. The model id resolves
 * from `AI_GATEWAY_CHAT_MODEL ?? "coding"` — never from the flag-shaped
 * `identity.models.routes[0]`, which holds a free-Gemma id when the seeker
 * flag is off and would silently point gateway calls at a model the gateway
 * does not serve.
 */
export function buildSeekerGatewayModelEntry(): ModelWithRetries | null {
  if (!env.AI_GATEWAY_CHAT_API_KEY) return null

  // JesusFilm AI gateway (OpenAI-compatible). The @ai-sdk/openai SDK is
  // loaded via the createRequire shim (not imported from ./providers) to
  // keep that module's static `@ai-sdk/*` imports out of the Mastra CLI
  // Rollup bundle. The gateway base URL + User-Agent come from the
  // import-free `./gateway-constants` module. The User-Agent dodges
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
  return {
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
      env.AI_GATEWAY_CHAT_MODEL ?? "coding",
    ) as unknown as MastraModelConfig,
    // 0, NOT 1 (deviation from the feat-237 plan's R1, review-verified):
    // Mastra's per-entry retry (p-retry) retries ANY non-APICallError, so a
    // KTD9 timeout abort WOULD be retried — a hanging gateway would burn
    // (retries+1) x the fetch timeout before failover, blowing the intent
    // of the in-budget guarantee. With 0, a hang costs exactly one timeout
    // window and the caller's fallback chain (or the sweep's early stop) IS
    // the retry; a transient gateway 5xx also falls straight through.
    maxRetries: 0,
  }
}

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
 * with the self-hosted JesusFilm gateway chat model prepended (see
 * buildSeekerGatewayModelEntry above for the entry's construction and its
 * maxRetries: 0 rationale). Any thrown gateway error fails over to today's
 * Gemma behavior; unsetting the flag (or key) restores the disabled branch
 * with no code change (R9). Deliberately gated on its OWN flag, not the
 * experience agents' `AI_GATEWAY_CHAT_ENABLED` — the two surfaces have
 * different risk profiles and roll back independently (KTD1).
 *
 * Since feat-405 this chain is also the default TITLE model for ai-chat
 * threads (`buildAiChatMemory`'s function-valued `titleModel`), read per turn
 * — so the flag flip governs titling's gateway tier too.
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
    const gatewayEntry = buildSeekerGatewayModelEntry()
    if (gatewayEntry !== null) {
      return [gatewayEntry, ...gemmaFallbackChain]
    }
  }

  return gemmaFallbackChain
}
