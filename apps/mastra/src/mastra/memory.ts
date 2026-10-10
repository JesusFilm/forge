/**
 * Mastra Memory primitives for the standalone service — the experience-AI
 * chat surface (consolidation U3), Postgres-persisted in the `mastra` schema.
 *
 * The ai-chat lane's memory (feat-198/feat-208) lives in
 * `./ai-chat-memory.ts` (extracted in feat-285). The two surfaces share
 * nothing but the connection string: the two schemas keep experience-chat
 * editor conversations and ai-chat seeker conversations physically separate
 * tables.
 *
 * pg pool arithmetic for this service: runtime store (index.ts) defaults to
 * max 20, experience-chat storage 5, experience-chat vector 2; the ai-chat
 * storage pool (max 5 — see `./ai-chat-memory.ts`) brings the total to ~32
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

import { createRequire } from "node:module"

import { Memory } from "@mastra/memory"
import { PgVector, PostgresStore } from "@mastra/pg"

import { env, getMastraDatabaseUrl } from "../config/env"

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

// ===========================================================================
// Experience-AI chat Memory (U3) — Postgres-persisted, standalone service
// ===========================================================================
//
// Ported (rebuilt, not copied) from `apps/admin/src/mastra/memory.ts`. This is
// the chat agent's conversation memory, distinct from the ai-chat lane's
// seeker memory (`./ai-chat-memory.ts`): the experience-chat surface persists
// threads across process restarts so an editor's in-progress chat survives a
// deploy.
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
