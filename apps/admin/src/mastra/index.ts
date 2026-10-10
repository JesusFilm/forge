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
import { MastraEditor } from "@mastra/editor"
// `getMastraMemory` is re-exported below for downstream importers; the
// import sits in this module so the singleton's lifecycle is colocated
// with the memory singleton it depends on.
// `getMastraStorage` provides the composite-store singleton that the
// `chat-thumb-rating` scorer reads/writes via `mastra.getStorage()`.
import { getMastraMemory, getMastraStorage } from "./memory"
import { buildDefaultChatAgent } from "./agents/default-chat-agent"
import { buildSpecializedAgents } from "./agents/specialized-agents"
import { buildAutoEnrichAgent } from "./agents/auto-enrich-agent"
import {
  multiStepDraftWorkflow,
  quickDraftWorkflow,
} from "./workflows/multi-step-draft-workflow"
import {
  CHAT_THUMB_RATING_SCORER_ID,
  chatThumbRatingScorer,
} from "./scorers/chat-thumb-rating"
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
  // Agent ids the chat service dispatches by (in-process fallback path;
  // the standalone @forge/mastra service owns the remote path):
  //   - "experience-default-chat" — the default editor agent.
  //   - "draft-experience" / "add-section" / "rewrite-copy" — the
  //     specialized agents picked via the composer agent-picker.
  //   - "experience-planner" / "experience-critic" / "experience-reviser"
  //     — multi-step draft workflow agents; workflow-only, memory-less
  //     by construction (R12 — no memory writes between steps).
  //   - "auto-enrich" — the background agent (triggered out-of-band).
  //
  // Workflow ids:
  //   - "multi-step-draft" — the plan→draft→critique→revise chain
  //     wrapping a tool-calling agent in "thoughtful mode".
  const specialized = buildSpecializedAgents()
  // Studio prompt-editing surface. Dev-only — Studio edits override the
  // source-code prompt at runtime via the editor's prompt store, so
  // enabling this in production would let an operator silently shadow
  // a code-defined prompt without a git trail.
  const editor =
    process.env.NODE_ENV !== "production" ? new MastraEditor() : undefined
  return new Mastra({
    agents: {
      "experience-default-chat": buildDefaultChatAgent(),
      "draft-experience": specialized["draft-experience"],
      "add-section": specialized["add-section"],
      "rewrite-copy": specialized["rewrite-copy"],
      // Multi-step draft workflow agents (workflow-only; memory-less).
      "experience-planner": specialized["experience-planner"],
      "experience-critic": specialized["experience-critic"],
      "experience-reviser": specialized["experience-reviser"],
      // Two-phase draft workflow agents (workflow-only; memory-less).
      "experience-skeleton": specialized["experience-skeleton"],
      "experience-fill": specialized["experience-fill"],
      "auto-enrich": buildAutoEnrichAgent(),
    },
    workflows: {
      "multi-step-draft": multiStepDraftWorkflow,
      // Speed-mode counterpart of multi-step-draft. Same planner +
      // drafter agents, skips critique + revise — roughly half the
      // wall-clock at the cost of the refinement pass.
      "quick-draft": quickDraftWorkflow,
    },
    // Composite storage shared with `getMastraMemory()`. Exposes the
    // `scores` domain that the `chat-thumb-rating` rating service
    // writes to (`mastra.getStorage().getStore('scores').saveScore`).
    // Same `PostgresStore` instance — single connection pool.
    storage: getMastraStorage(),
    // Registered so Mastra Studio's "Scorers" view recognises the
    // chat-thumb-rating bucket and surfaces the records that the
    // chat-rating service writes to `mastra.mastra_scorers`. The
    // scorer's generateScore step is never invoked — human ratings
    // bypass the eval pipeline entirely (see scorer module).
    //
    // Runtime quirk: Mastra core (chunk-SQ67XNBS) walks
    // `Object.entries(config.scorers)` and calls `this.addScorer(scorer)`
    // directly on each value, expecting a bare `MastraScorer`. The
    // typed `MastraScorerEntry` `{ scorer, sampling }` shape in the
    // .d.ts is what the registry holds AFTER registration, NOT what
    // the constructor accepts. Pass the scorer instance directly.
    //
    // Test guard: vitest runs eagerly rebuild this Mastra instance
    // across cases; registering the scorer there cascades into
    // `ScoresPG.init()` opening additional pg connections per cycle
    // until "too many clients already" trips. Skip registration in
    // test env — the scorer module + chat-rating service are unit-
    // tested separately with `InMemoryStore` and don't need the
    // production Mastra wiring.
    ...(process.env.VITEST
      ? {}
      : {
          scorers: {
            [CHAT_THUMB_RATING_SCORER_ID]: chatThumbRatingScorer,
          },
        }),
    ...(editor && { editor }),
  })
}

let cached: Mastra | null = null

/**
 * Return the shared Mastra runtime instance. Builds on first access.
 *
 * The chat service / draft action import this for the in-process fallback
 * (`getAgentById` / `getWorkflowById`) when the remote-flag is off. Tests
 * should call `__resetMastraForTesting()` between cases to avoid leaking state.
 */
export function getMastra(): Mastra {
  if (cached === null) {
    cached = buildMastraInstance()
  }
  return cached
}

// Eager `mastra` export removed — it triggered agent construction
// (and the env read chain that backs Memory + providers) at module
// load. In build-phase contexts where env is skipValidation-deferred,
// that surfaced as a load-time failure. Call sites that need a
// Mastra-typed value synchronously call `getMastra()` themselves;
// the lazy cache makes that a one-time cost.

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
