/**
 * Mastra Memory primitives for the standalone service.
 *
 * Two independent memory surfaces live here:
 *   1. AI-chat lane memory (feat-198/feat-208) — the seeker agent's (and every
 *      future ai-chat agent's) conversation memory, Postgres-persisted in the
 *      DEDICATED `ai_chat` schema (this header).
 *   2. Experience-AI chat memory (consolidation U3) — Postgres-persisted in
 *      the `mastra` schema, in the clearly-delimited section at the bottom.
 * They share nothing but this module and the connection string: the two
 * schemas keep ai-chat seeker conversations and experience-chat editor
 * conversations physically separate tables.
 *
 * --- 1. AI-chat lane Memory (feat-208) ---
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
 * pg pool arithmetic for this service: runtime store (index.ts) defaults to
 * max 20, experience-chat storage 5, experience-chat vector 2, ai-chat
 * storage 5 → ~32 potential connections total. Keep new pools small.
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

import { createRequire } from "node:module"

import { InMemoryStore } from "@mastra/core/storage"
import { Memory } from "@mastra/memory"
import { PgVector, PostgresStore } from "@mastra/pg"

import type { MastraModelConfig } from "@mastra/core/llm"

import {
  env,
  getMastraDatabaseUrl,
  resolveAiChatMemoryBackend,
} from "../config/env"

import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "./gateway-constants"

// createRequire shim for the @ai-sdk/openai embedding-model load in
// `buildExperienceChatEmbedder()` below. A static `import { createOpenAI }`
// (or importing it transitively via `./providers`, which imports the SDK
// statically) gets transformed by the Mastra CLI's Rollup bundle and trips
// the "Cannot determine intended module format" trap — the same reason the
// agent files use this shim and the same reason `./gateway-constants` stays
// import-free. The non-bundled counterpart that ordinary code can import
// directly is `getJesusFilmEmbeddingModel()` in `./providers`.
const require = createRequire(import.meta.url)

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
 * LLM thread titles (feat-241, KTD12): the model-router string for Mastra's
 * `generateTitle` — the free Gemma tier the seeker's fallback chain already
 * uses, as a PLAIN string (a static `@ai-sdk/*` import would trip the Mastra
 * CLI bundler; `generateTitle: true` would instead burn the paid gateway model
 * whenever feat-237's flag is on). Titling rides the same `OPENROUTER_API_KEY`
 * the Gemma chain requires; an absent key degrades to a benign no-op.
 *
 * Trust posture, stated plainly: titles send conversation-derived content to a
 * free-tier third-party model. Accepted for the signed-in dogfood roster;
 * revisit (first-party gateway titling) when feat-237's gateway flag is on.
 */
export const AI_CHAT_TITLE_MODEL = "openrouter/google/gemma-4-26b-a4b-it:free"

/**
 * Build the ai-chat Memory. Backend-aware (feat-208): `memory` → a dedicated
 * `InMemoryStore` (local dev/tests + the production kill-switch), `postgres` →
 * the shared `ai_chat` store. Storage-only — no vector/embedder/semantic
 * recall yet. `getBackend` is an injectable seam (same pattern as
 * seeker-route's `getEnabled`/`getModelKey`) so tests flip backends per-case;
 * `titleModel` is the matching seam for title generation so tests can observe
 * the titling path with a mock model.
 *
 * Title generation (feat-241, KTD12): the TOP-LEVEL `generateTitle` option —
 * NEVER the deprecated `threads.generateTitle` nesting, which throws mid-turn
 * at the first merged-config read (not at construction). Semantics, verified
 * against the pinned dist: fire-and-forget AFTER a completed turn (it cannot
 * delay or fail the turn it rides on); fires only for threads whose stored
 * title is still empty — `""` is the untitled sentinel (`createThread` stores
 * `title || ""`) — so a title-model failure leaves `""` and retries on the
 * next turn, and the first listing after a first turn may legitimately still
 * show the client's fallback label. Scope: signed-in threads only — the send
 * route passes a per-call `options: { generateTitle: false }` override for
 * non-`user:` resources (they are permanently unlistable under R2, so titling
 * them would waste a model call per junk POST).
 */
export function buildAiChatMemory({
  getBackend = resolveAiChatMemoryBackend,
  titleModel = AI_CHAT_TITLE_MODEL,
}: {
  getBackend?: () => "postgres" | "memory"
  titleModel?: MastraModelConfig
} = {}): Memory {
  const options = { generateTitle: { model: titleModel } }
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
 * Test-only reset hooks. Production code never resets the singletons — the
 * cached instances are the whole point.
 */
export function __resetAiChatMemoryForTesting(): void {
  cachedAiChatMemory = null
}

export function __resetAiChatStorageForTesting(): void {
  cachedAiChatStorage = null
}

// ===========================================================================
// Experience-AI chat Memory (U3) — Postgres-persisted, standalone service
// ===========================================================================
//
// Ported (rebuilt, not copied) from `apps/admin/src/mastra/memory.ts`. This is
// the chat agent's conversation memory, distinct from the seeker's in-memory
// store above: the experience-chat surface persists threads across process
// restarts so an editor's in-progress chat survives a deploy.
//
// Storage choice: Postgres via `@mastra/pg`, against the SAME Postgres the
// standalone Mastra runtime already uses (`getMastraDatabaseUrl()` →
// `DATABASE_URL ?? LOCAL_DATABASE_URL`) inside a dedicated `mastra` schema.
// Admin made the same LibSQL-vs-Postgres call (operational continuity); here
// the standalone service already runs a `PostgresStore` for its own runtime
// storage (see `./index.ts`), so reusing the same DB + schema keeps Mastra's
// tables in one place. The connection string resolves with the documented
// `DATABASE_URL` fallback so an unprovisioned local/test env still constructs
// without throwing (per the optional-scaffolding-env-var learning).
//
// Per-call keying convention (enforced by agent/route code in U9, NOT here):
//   - `threadId`   = `experienceLocaleId`
//   - `resourceId` = `principalId`
// Memory's row-level access is keyed by `resourceId`, so storing the principal
// id there aligns memory scoping by construction.

/**
 * Postgres schema that owns Mastra's experience-chat memory + vector tables.
 * The same `mastra` schema the standalone runtime's `PostgresStore` uses in
 * `./index.ts`; `PostgresStore`/`PgVector` handle their own DDL inside the
 * schema on first write. Schema isolation keeps a future reset to a single
 * `DROP SCHEMA mastra CASCADE`.
 */
const EXPERIENCE_CHAT_SCHEMA_NAME = "mastra"

/**
 * Pool cap on the experience-chat `PostgresStore` connection pool. Small by
 * design (admin used 5): the standalone runtime already operates its own
 * `PostgresStore` pool, so bounding this one keeps total pg connections under
 * control under concurrent chat load. `PostgresStore`'s
 * `ConnectionStringConfig` exposes the cap as a top-level `max` (NOT the
 * `pgPoolOptions` surface `PgVector` uses).
 */
const EXPERIENCE_CHAT_STORAGE_POOL_MAX = 5

/**
 * Pool cap on the semantic-recall `PgVector` pool. Even smaller than the
 * message store (admin used 2): recall is a read-mostly side path, so it needs
 * less concurrency headroom than the message/thread store.
 */
const EXPERIENCE_CHAT_VECTOR_POOL_MAX = 2

const EXPERIENCE_CHAT_EMBEDDING_MODEL_FALLBACK = "embeddings"
const EXPERIENCE_CHAT_SEMANTIC_RECALL_TOP_K = 5
const EXPERIENCE_CHAT_SEMANTIC_RECALL_MESSAGE_RANGE = 2

/**
 * Resolve the experience-chat storage connection string. Reuses the
 * standalone runtime's `getMastraDatabaseUrl()` (`DATABASE_URL ??`
 * `LOCAL_DATABASE_URL`) so memory shares the runtime's database rather than
 * introducing a second connection-string env var. Exported so tests and
 * tooling can probe resolution without instantiating the full Memory.
 */
export function resolveExperienceChatStorageUrl(): string {
  return getMastraDatabaseUrl()
}

/**
 * Build the PostgresStore that backs the experience-chat Memory. Pure
 * factory — does not open a connection at construction time; the pool is
 * established on the first read/write.
 */
export function buildExperienceChatStorage(): PostgresStore {
  return new PostgresStore({
    id: "experience-chat-storage",
    connectionString: resolveExperienceChatStorageUrl(),
    schemaName: EXPERIENCE_CHAT_SCHEMA_NAME,
    // `PostgresStore`'s ConnectionStringConfig takes the pool cap as a
    // top-level `max`, not `pgPoolOptions` (that surface is PgVector's).
    max: EXPERIENCE_CHAT_STORAGE_POOL_MAX,
  })
}

let cachedExperienceChatStorage: PostgresStore | null = null

/**
 * Singleton PostgresStore for experience-chat Memory. Lazy construction so
 * importing this module in a build-phase context does not eagerly open a
 * connection pool.
 */
export function getExperienceChatStorage(): PostgresStore {
  if (cachedExperienceChatStorage === null) {
    cachedExperienceChatStorage = buildExperienceChatStorage()
  }
  return cachedExperienceChatStorage
}

// ---------------------------------------------------------------------------
// Semantic recall — JesusFilm gateway embeddings (Qwen3-Embedding-8B)
// ---------------------------------------------------------------------------

/**
 * Resolve the API key for gateway embedding calls. The gateway's keys are
 * MODEL-SCOPED: the chat (`coding`) key is rejected by the `embeddings` model
 * (`AI_APICallError: key can only access models=['coding']`). So there is
 * deliberately NO fallback to the chat key — embeddings require the
 * embeddings-scoped key explicitly (mirrors `./providers`'
 * `resolveJesusFilmEmbeddingApiKey`).
 */
function resolveExperienceChatEmbeddingApiKey(): string | undefined {
  return env.AI_GATEWAY_EMBEDDINGS_API_KEY
}

/**
 * Whether experience-chat semantic recall is enabled. Gated on the gateway
 * EMBEDDING key specifically — NOT the chat key — so:
 *   - default deploy (no key) → memory is storage-only, unchanged;
 *   - chat key only → still storage-only (the chat key can't embed);
 *   - embedding key set → recall on, embedding via the embeddings model.
 */
export function isExperienceChatSemanticRecallEnabled(): boolean {
  return resolveExperienceChatEmbeddingApiKey() !== undefined
}

let cachedExperienceChatVector: PgVector | null = null

/**
 * Singleton PgVector store backing experience-chat semantic recall, or null
 * when no gateway embedding key is configured. Lives in the same `mastra`
 * schema and shares the same connection string as the message store, but owns
 * its own pool (capped at `EXPERIENCE_CHAT_VECTOR_POOL_MAX`).
 *
 * Mastra Memory auto-creates the vector index at the dimension it detects from
 * the embedder's first output (4096 for Qwen3-Embedding-8B), so no DDL is
 * managed here. That index is isolated by both schema and table from any other
 * pgvector space — never mix vectors across them.
 */
export function getExperienceChatVectorStore(): PgVector | null {
  if (!isExperienceChatSemanticRecallEnabled()) return null
  if (cachedExperienceChatVector === null) {
    cachedExperienceChatVector = new PgVector({
      id: "experience-chat-vector",
      connectionString: resolveExperienceChatStorageUrl(),
      schemaName: EXPERIENCE_CHAT_SCHEMA_NAME,
      pgPoolOptions: { max: EXPERIENCE_CHAT_VECTOR_POOL_MAX },
    })
  }
  return cachedExperienceChatVector
}

/**
 * Build the JesusFilm gateway embedder (Qwen3-Embedding-8B) as an AI SDK
 * embedding model. Loaded via the createRequire shim (see the top-of-file
 * note) and only ever called when a gateway embedding key is present. The
 * explicit User-Agent dodges Cloudflare's 403 on missing / odd UAs in front
 * of the gateway.
 */
function buildExperienceChatEmbedder() {
  const apiKey = resolveExperienceChatEmbeddingApiKey()
  // Callers gate on isExperienceChatSemanticRecallEnabled(); this guard keeps
  // the function honest if it is ever called directly.
  if (!apiKey) {
    throw new Error(
      "buildExperienceChatEmbedder called without a gateway embedding key",
    )
  }
  const { createOpenAI } =
    require("@ai-sdk/openai") as typeof import("@ai-sdk/openai")
  const provider = createOpenAI({
    apiKey,
    baseURL:
      env.AI_GATEWAY_EMBEDDINGS_BASE_URL ??
      env.AI_GATEWAY_CHAT_BASE_URL ??
      DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
    name: "jesusfilm-embeddings",
    headers: { "User-Agent": AI_GATEWAY_USER_AGENT },
  })
  return provider.textEmbeddingModel(
    env.AI_GATEWAY_EMBEDDINGS_MODEL ?? EXPERIENCE_CHAT_EMBEDDING_MODEL_FALLBACK,
  )
}

/**
 * Build the Mastra Memory instance for the experience-AI chat agent. Pure
 * factory — does not open a connection at construction time.
 *
 * When a gateway embedding key is configured
 * (`isExperienceChatSemanticRecallEnabled()`), Memory is built WITH semantic
 * recall: the gateway embedder + the PgVector store + recall options.
 * Otherwise it is storage-only and behaviour-identical to the pre-gateway
 * wiring. The decision is made once per build (singleton), so flipping the env
 * var takes effect on the next process start — acceptable for a deploy-time
 * configuration knob.
 */
export function buildExperienceChatMemory(): Memory {
  const vector = getExperienceChatVectorStore()
  if (vector === null) {
    return new Memory({ storage: getExperienceChatStorage() })
  }
  return new Memory({
    storage: getExperienceChatStorage(),
    vector,
    // Cast absorbs the AI SDK EmbeddingModel V2/V3 peer-version churn between
    // @ai-sdk/openai's EmbeddingModelV3 and Mastra's bundled copy — the same
    // `as` discipline the agent model configs use.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedder: buildExperienceChatEmbedder() as any,
    options: {
      semanticRecall: {
        topK: EXPERIENCE_CHAT_SEMANTIC_RECALL_TOP_K,
        messageRange: EXPERIENCE_CHAT_SEMANTIC_RECALL_MESSAGE_RANGE,
        scope: "thread",
      },
    },
  })
}

let cachedExperienceChatMemory: Memory | null = null

/**
 * Singleton Memory instance shared by the experience-chat agent.
 *
 * Why a singleton: Mastra's Memory primitive owns its own connection pool
 * internally; constructing multiple instances would multiply pool capacity
 * unnecessarily. Construction is lazy (deferred to first access) so importing
 * the surrounding module in a build-phase context (where env may be empty)
 * does not open a doomed connection pool.
 */
export function getExperienceChatMemory(): Memory {
  if (cachedExperienceChatMemory === null) {
    cachedExperienceChatMemory = buildExperienceChatMemory()
  }
  return cachedExperienceChatMemory
}

/**
 * Test-only reset hook for the experience-chat Memory singleton.
 *
 * Intentionally does NOT reset `cachedExperienceChatStorage`: rebuilding the
 * PostgresStore on every reset reopens connections and can exhaust the pg pool
 * across a test suite. The storage layer is idempotent across rebuilt Memory
 * instances, so reusing the same `PostgresStore` between tests is safe.
 * `__resetExperienceChatStorageForTesting` is exported separately for the
 * narrow case where a test genuinely needs a fresh storage pool.
 */
export function __resetExperienceChatMemoryForTesting(): void {
  cachedExperienceChatMemory = null
}

export function __resetExperienceChatStorageForTesting(): void {
  cachedExperienceChatStorage = null
}

/**
 * Test-only reset hook for the semantic-recall vector singleton. Tests that
 * toggle the gateway embedding key between cases must reset this so
 * `getExperienceChatVectorStore()` re-evaluates the enablement gate.
 */
export function __resetExperienceChatVectorStoreForTesting(): void {
  cachedExperienceChatVector = null
}
