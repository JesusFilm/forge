/**
 * Mastra runtime singleton for admin's Experience-AI chat (U2).
 *
 * The shared entrypoint that route handlers, server actions, and
 * background workflows import to access Mastra agents, tools, and
 * workflows. At U2 the singleton is foundation-only — no agents
 * registered yet. U6 (default tool-calling agent) is the first unit
 * that populates `agents`.
 *
 * Why a registry-style singleton, rather than per-route construction:
 * - Mastra's Memory primitive owns a connection pool internally
 *   (`getMastraMemory()` in `./memory.ts`). Multiple Mastra instances
 *   would multiply pool capacity for no benefit.
 * - Route handlers in Next.js App Router invoke this on every request;
 *   constructing fresh would re-read provider config each time.
 * - Mastra's recommended Next.js usage pattern is a module-level
 *   singleton exported from `apps/<app>/src/mastra/index.ts`. We follow
 *   that convention so future agents/tools/workflows attach by adding
 *   a side-effect import here.
 *
 * Lazy construction: the cached `Mastra` instance is built on first
 * access, NOT at module load. Build-phase imports (where env may be
 * empty) therefore don't crash; the singleton is realised when actual
 * runtime traffic reaches it.
 *
 * NOTE — agent / workflow registration:
 *
 * As subsequent plan units add agents (`U6` default tool-calling,
 * `U7` multi-step workflow, `U8` specialised agents, `U9` background
 * agent), their definitions land under `./agents/` and `./workflows/`
 * and get registered in `buildMastraInstance` below. Each addition
 * extends the singleton without changing this file's public surface.
 */

import { Mastra } from "@mastra/core"
// `getMastraMemory` is re-exported below for downstream importers; the
// import sits in this module so the singleton's lifecycle is colocated
// with the memory singleton it depends on.
import { getMastraMemory } from "./memory"
import { buildDefaultChatAgent } from "./agents/default-chat-agent"
import { buildSpecializedAgents } from "./agents/specialized-agents"
import { buildAutoEnrichAgent } from "./agents/auto-enrich-agent"
import { multiStepDraftWorkflow } from "./workflows/multi-step-draft-workflow"
void getMastraMemory

// ---------------------------------------------------------------------------
// Build + cache the singleton
// ---------------------------------------------------------------------------

/**
 * Construct a fresh Mastra instance. Pure factory — does not open
 * downstream connections at construction. Used by `getMastra()` for
 * the singleton; exposed separately for tests that want isolation.
 *
 * The registry shape below is intentionally empty at U2. Agent / tool
 * / workflow registrations land here in U6+ via side-effect imports
 * from `./agents/...` and `./workflows/...`.
 */
export function buildMastraInstance(): Mastra {
  // Registry populated by U6 / U7 / U8 / U9.
  //
  // Agent ids surface to the streaming-bridge dispatch:
  //   - "experience-default-chat" — the default editor agent.
  //   - "draft-experience" / "add-section" / "rewrite-copy" — the
  //     specialized agents picked via the composer agent-picker.
  //   - "auto-enrich" — the background agent (triggered out-of-band).
  //
  // Workflow ids:
  //   - "multi-step-draft" — the plan→draft→critique→revise chain
  //     wrapping a tool-calling agent in "thoughtful mode".
  const specialized = buildSpecializedAgents()
  return new Mastra({
    agents: {
      "experience-default-chat": buildDefaultChatAgent(),
      "draft-experience": specialized["draft-experience"],
      "add-section": specialized["add-section"],
      "rewrite-copy": specialized["rewrite-copy"],
      "auto-enrich": buildAutoEnrichAgent(),
    },
    workflows: {
      "multi-step-draft": multiStepDraftWorkflow,
    },
  })
}

let cached: Mastra | null = null

/**
 * Return the shared Mastra runtime instance. Builds on first access.
 *
 * Route handlers import this and call `mastra.getAgent(agentId).stream(...)`
 * (or the streaming-bridge wrapper from U3). Tests should call
 * `__resetMastraForTesting()` between cases to avoid leaking state.
 */
export function getMastra(): Mastra {
  if (cached === null) {
    cached = buildMastraInstance()
  }
  return cached
}

/**
 * Eager-loaded singleton convenience export.
 *
 * Most call sites should prefer `getMastra()` (lazy), but some
 * downstream Mastra APIs (e.g. `handleChatStream({ mastra, agentId, params })`)
 * expect a Mastra-typed value to be available synchronously at the
 * import boundary. This export accommodates that without forcing
 * each call site to wrap `getMastra()` themselves.
 *
 * NOTE: this triggers `buildMastraInstance()` at module load. In the
 * U2 foundation-only config that's effectively a no-op — no connections
 * open, no agents instantiate beyond their constructors. Once U6+
 * registers agents, evaluate whether the eager export still pays its
 * weight, and consider moving to `getMastra()` everywhere.
 */
export const mastra: Mastra = getMastra()

// ---------------------------------------------------------------------------
// Test-only hooks
// ---------------------------------------------------------------------------

/**
 * Test-only reset. Production code never calls this. Tests use it to
 * swap the cached Mastra instance between cases without leaking state
 * across them.
 */
export function __resetMastraForTesting(): void {
  cached = null
}

// ---------------------------------------------------------------------------
// Convenience re-exports
// ---------------------------------------------------------------------------

export { getMastraMemory } from "./memory"
export {
  getProvider,
  DEFAULT_PROVIDER_ID,
  ProviderNotConfiguredError,
  UnknownProviderError,
  type ProviderId,
  type ModelFactory,
} from "./providers"
