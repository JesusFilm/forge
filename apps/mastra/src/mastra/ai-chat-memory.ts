/**
 * AI-chat lane Memory (feat-198/feat-208) — the seeker agent's (and every
 * future ai-chat agent's) conversation memory, Postgres-persisted in the
 * DEDICATED `ai_chat` schema — plus the lane's per-call memory-keying policy
 * (`aiChatMemoryConfigFor`, feat-241 KTD12 titling scope). Extracted from
 * `./memory.ts` (feat-285), which keeps the experience-chat surface; the two
 * share nothing but the connection string — the two schemas keep ai-chat
 * seeker conversations and experience-chat editor conversations physically
 * separate tables.
 *
 * One shared `PostgresStore` (schema `ai_chat`) for the whole ai-chat lane.
 * Mastra memory threads are keyed by threadId+resourceId with NO agent
 * scoping, so future ai-chat agents (intent routing, etc.) that point at this
 * same storage and are called with the same keys share the thread by
 * construction. Cross-agent routing must stay explicit per-call
 * (`memory: { thread, resource }`) — Agent.network() delegation auto-isolates
 * subagent memory and must not be relied on for shared threads.
 *
 * Backend selection (`resolveAiChatMemoryBackend`): `memory` → a dedicated
 * `InMemoryStore` (local dev/tests, no Postgres needed — and the documented
 * production kill-switch via AI_CHAT_MEMORY_BACKEND); `postgres` → the shared
 * `ai_chat` store. Ownership of a thread is NOT enforced here — Mastra's
 * message path silently adopts an existing thread regardless of the caller's
 * resource — so every ai-chat route MUST enforce ownership via
 * ./ai-chat-thread-ownership.ts first: `authorizeAiChatThreadAccess` on
 * agent-turn (write) paths, `resolveOwnedExistingThread` on read-only
 * surfaces (history replay, feat-284).
 *
 * pg pool arithmetic for this service: the ai-chat storage pool is capped at
 * 5; the service's other pools (runtime store 20, experience-chat storage 5,
 * experience-chat vector 2 — see `./memory.ts`; title-repair sweep 2,
 * run-scoped — see `./workflows/title-repair.ts`) bring the total to ~34
 * potential connections. Keep new pools small.
 *
 * Mirrors the lazy-singleton + `__reset*ForTesting` SHAPE of
 * `apps/admin/src/mastra/memory.ts`. Admin is a reference to copy from,
 * NEVER an import — `apps/mastra` must not import `apps/admin`. Two distinct
 * reasons, two distinct docs:
 *   - copy-not-import convention:
 *     `docs/solutions/architecture-patterns/mastra-seed-baseline-portability-pattern.md`
 *   - the real tsx/ESM cross-package-boundary load-time crash that makes the
 *     import not just disallowed but unsafe:
 *     `docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`
 */

import { InMemoryStore } from "@mastra/core/storage"
import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"

import type { ModelWithRetries } from "@mastra/core/agent"
import type { MastraModelConfig } from "@mastra/core/llm"

import { getMastraDatabaseUrl, resolveAiChatMemoryBackend } from "../config/env"

import { USER_RESOURCE_PREFIX } from "./ai-chat-thread-ownership"
import { buildSeekerModelList } from "./seeker-model-list"

/**
 * Postgres schema owning the ai-chat lane's memory tables (feat-208). SEPARATE
 * from the `mastra` schema (runtime storage + experience-chat memory) so
 * seeker/ai-chat conversations never mix with other agents' data and a future
 * reset is a single `DROP SCHEMA ai_chat CASCADE`. `PostgresStore` runs its
 * own DDL (CREATE SCHEMA + tables) at init.
 */
export const AI_CHAT_SCHEMA_NAME = "ai_chat"

/** Pool cap for the ai-chat store — small; see the header's pool arithmetic. */
const AI_CHAT_STORAGE_POOL_MAX = 5

/**
 * Build the PostgresStore backing ai-chat memory. Pure factory — no
 * connection is opened until first I/O.
 */
export function buildAiChatStorage(): PostgresStore {
  return new PostgresStore({
    id: "ai-chat-storage",
    connectionString: getMastraDatabaseUrl(),
    schemaName: AI_CHAT_SCHEMA_NAME,
    // ConnectionStringConfig takes the pool cap as a top-level `max`.
    max: AI_CHAT_STORAGE_POOL_MAX,
  })
}

let cachedAiChatStorage: PostgresStore | null = null

/**
 * Singleton `ai_chat`-schema PostgresStore, shared by every ai-chat agent so
 * cross-agent thread sharing works by construction. Lazy so build-phase
 * imports never open a pool.
 */
export function getAiChatStorage(): PostgresStore {
  if (cachedAiChatStorage === null) {
    cachedAiChatStorage = buildAiChatStorage()
  }
  return cachedAiChatStorage
}

/**
 * Default title model (feat-405, KTD1): a FUNCTION returning the seeker's own
 * gateway-first fallback chain (`buildSeekerModelList`, U1 leaf module).
 * Gateway-first resolves feat-241's standing "revisit first-party gateway
 * titling" note: when `AI_GATEWAY_SEEKER_ENABLED="true"` and the chat key is
 * set, titles generate on the self-hosted JesusFilm gateway; the free Gemma
 * chain remains the failover tail (and the whole chain when the flag or key
 * is off — still an upgrade over the retired single un-retried
 * `AI_CHAT_TITLE_MODEL` string, since the disabled branch is a two-entry
 * retrying chain).
 *
 * The function form is required, not cosmetic (KTD1): it defers
 * gateway-client construction out of module load, reads
 * `AI_GATEWAY_SEEKER_ENABLED` per turn instead of freezing it at the first
 * `buildAiChatMemory()` call, and removes the module-load half of the KTD2
 * import cycle (`seeker-agent.ts` imports this module).
 *
 * Trust posture, stated plainly: with the gateway flag on, titles send
 * conversation-derived content to the first-party gateway; with it off (or
 * the key unset), they still go to the free-tier third-party Gemma pool —
 * the same coupling the seeker's answer path has. Flipping
 * `AI_GATEWAY_SEEKER_ENABLED` governs both surfaces together.
 */
const defaultTitleModel = (): ModelWithRetries[] => buildSeekerModelList()

/**
 * Build the ai-chat Memory. Backend-aware (feat-208): `memory` → a dedicated
 * `InMemoryStore` (local dev/tests + the production kill-switch), `postgres` →
 * the shared `ai_chat` store. Storage-only — no vector/embedder/semantic
 * recall yet.
 *
 * BEFORE TURNING ON `semanticRecall` (feat-366 review, 2026-08-20): the
 * follow-ups persist (`seeker-follow-ups-persist.ts`) writes a metadata-ONLY
 * `content` payload — no `content.content`, no text `parts` — and
 * @mastra/memory 1.24.0 treats such a payload as content-cleared whenever a
 * vector store is attached, DELETING the carrier row's embeddings with no
 * re-embed. Storage-only is what keeps that inert today. Enabling semantic
 * recall means fixing the persist first; the coupling is invisible from this
 * switch, which is why it is recorded here.
 *
 * `getBackend` is an injectable seam (same pattern as
 * seeker-route's `getEnabled`/`getModelKey`) so tests flip backends per-case;
 * `titleModel` is the matching seam for title generation so tests can observe
 * the titling path with a mock model.
 *
 * Title generation (feat-241 KTD12, model default feat-405 KTD1): the
 * TOP-LEVEL `generateTitle` option — NEVER the deprecated
 * `threads.generateTitle` nesting, which throws mid-turn at the first
 * merged-config read (not at construction). Semantics, verified against the
 * pinned dist: fire-and-forget AFTER a completed turn (it cannot delay or
 * fail the turn it rides on); fires only for threads whose stored title is
 * still empty — `""` is the untitled sentinel (`createThread` stores
 * `title || ""`) — so a title-model failure leaves `""` and retries on the
 * next turn (and, since feat-405, the daily title-repair sweep heals threads
 * that never get another turn), and the first listing after a first turn may
 * legitimately still show the client's fallback label. Scope: signed-in
 * threads only — the send route passes a per-call
 * `options: { generateTitle: false }` override for non-`user:` resources via
 * `aiChatMemoryConfigFor` below (they are permanently unlistable under R2, so
 * titling them would waste a model call per junk POST).
 */
export function buildAiChatMemory({
  getBackend = resolveAiChatMemoryBackend,
  titleModel = defaultTitleModel,
}: {
  getBackend?: () => "postgres" | "memory"
  titleModel?: MastraModelConfig | (() => ModelWithRetries[])
} = {}): Memory {
  const options = {
    generateTitle: {
      // KTD1 cast, verified 2026-08-27 against the installed @mastra/core:
      // the declared type is the singular DynamicArgument<MastraModelConfig>,
      // but resolveTitleGenerationConfig hands this to Agent.getLLM →
      // resolveModelSelection, which accepts a function returning a
      // ModelWithRetries[] and normalizes it via normalizeModelFallbacks.
      // The pinned-dist-fact test in ai-chat-memory.test.ts guards the shape
      // across @mastra/* bumps — re-verify there on any bump. Known cosmetic
      // effect: MastraMemory.getConfig() drops a function-valued title model
      // from its serialized config, so Studio's memory config reads as if
      // titling were absent; the wiring tests below are the source of truth.
      model: titleModel as MastraModelConfig,
    },
  }
  if (getBackend() === "memory") {
    return new Memory({
      storage: new InMemoryStore({ id: "ai-chat-memory-storage" }),
      options,
    })
  }
  return new Memory({ storage: getAiChatStorage(), options })
}

/**
 * Singleton Memory instance shared by the ai-chat lane's agents (today: the
 * seeker). One instance keeps every read/write on the same store and avoids
 * multiplying pool capacity. Construction is lazy so importing this module in
 * a build-phase context does not eagerly allocate a store.
 */
let cachedAiChatMemory: Memory | null = null

export function getAiChatMemory(): Memory {
  if (cachedAiChatMemory === null) {
    cachedAiChatMemory = buildAiChatMemory()
  }
  return cachedAiChatMemory
}

/**
 * Per-call memory config for an ai-chat agent turn (feat-241 KTD12 scope):
 * signed-in (`user:`) resources title; anonymous/dogfood resources carry
 * `generateTitle: false` (permanently unlistable — titling them wastes a
 * model call per junk POST and sends conversation content to a third-party
 * model). The override uses the TOP-LEVEL `generateTitle` option key,
 * deliberately — the deprecated `threads.generateTitle` nesting throws
 * mid-turn (see `buildAiChatMemory` above). `USER_RESOURCE_PREFIX` is
 * imported from the ownership module (the single mastra-side home of the
 * resource contract) — never re-declared here.
 */
export function aiChatMemoryConfigFor(
  threadId: string,
  resource: string,
):
  | { thread: string; resource: string }
  | { thread: string; resource: string; options: { generateTitle: false } } {
  return resource.startsWith(USER_RESOURCE_PREFIX)
    ? { thread: threadId, resource }
    : { thread: threadId, resource, options: { generateTitle: false } }
}

/**
 * Test-only reset hooks. Production code never resets the singletons — the
 * cached instances are the whole point.
 */
export function __resetAiChatMemoryForTesting(): void {
  cachedAiChatMemory = null
}

export function __resetAiChatStorageForTesting(): void {
  cachedAiChatStorage = null
}
