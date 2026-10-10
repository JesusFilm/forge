/**
 * Mastra Memory primitive — admin Experience-AI chat (U2).
 *
 * Storage choice and rationale: Postgres via `@mastra/pg`, against the
 * same Postgres instance admin already operates. Chosen in the U1
 * fitness spike (see
 * `docs/solutions/platform/admin-chat-mastra-fitness-spike-20260514.md`)
 * over LibSQL because:
 *
 * 1. Operational continuity — admin already runs Postgres on Railway
 *    with backups and monitoring; adding a parallel SQLite-style
 *    storage tier is unjustified at admin's scale.
 * 2. ABAC alignment — keeping memory in the same DB as ABAC-gated
 *    rows simplifies eventual auditing / joining if we ever need it.
 * 3. LibSQL stays documented as a one-line fallback if pool contention
 *    with admin's existing Prisma `connection_limit=10` surfaces.
 *
 * Per-call keying convention (enforced by agent code in U6+, NOT by
 * this module):
 *   - `threadId` = `experienceLocaleId`
 *   - `resourceId` = `principalId`
 *
 * Memory's row-level access is keyed by `resourceId`, so storing the
 * principal id there aligns memory scoping to ABAC by construction.
 * Old chat history is NOT preserved — per origin's "cold cutover"
 * decision, the legacy `experienceChatThread` / `experienceChatMessage`
 * Prisma tables are dropped in plan U10. New threads start in this
 * Mastra-managed storage.
 *
 * Connection-string fallback: `MASTRA_STORAGE_URL` is the explicit
 * pointer; if unset, fall back to `DATABASE_URL` so the default-deploy
 * path works without an extra Doppler entry. The fallback is a
 * deliberate scaffolding-env-var pattern per
 * `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`.
 */

import { createRequire } from "node:module"

import { Memory } from "@mastra/memory"
import { PostgresStore, PgVector } from "@mastra/pg"

import { env } from "@/config/env"

import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "./gateway-constants"

// createRequire shim for the @ai-sdk/openai embedding-model load in
// `buildGatewayEmbedder()` below. Static `import { createOpenAI }` (or
// importing it transitively via `./providers`, which imports the SDK
// statically) gets transformed by the Mastra CLI's Rollup bundle and
// trips the "Cannot determine intended module format" trap — the same
// reason the agent files use this shim. The registry counterpart that
// non-bundled Next.js code can import directly is
// `getJesusFilmEmbeddingModel()` in `./providers`.
const require = createRequire(import.meta.url)

/**
 * Resolve the Mastra storage connection string with documented
 * fallback to admin's primary DATABASE_URL. Exported separately so
 * tests and tooling can probe the resolution without instantiating
 * the full Memory primitive.
 */
export function resolveMastraStorageUrl(): string {
  return env.MASTRA_STORAGE_URL ?? env.DATABASE_URL
}

/**
 * Postgres schema that owns Mastra's memory + agent state tables.
 * Created by `prisma/migrations/0030_mastra_schema/migration.sql`; the
 * `PostgresStore` then handles its own DDL inside the schema on first
 * write. Schema isolation keeps Mastra's tables out of Prisma's
 * migration history — a future reset is `DROP SCHEMA mastra CASCADE`.
 */
const MASTRA_SCHEMA_NAME = "mastra"

/**
 * Pool cap on the shared composite-store (`PostgresStore`) connection
 * pool. Mirrors the `MASTRA_VECTOR_POOL_MAX` rationale: bound Mastra's
 * pg connections so the message/scores/workflow store + the vector
 * store + Prisma's `connection_limit=10` budget keep headroom under
 * concurrent chat load. `PostgresStore`'s `ConnectionStringConfig`
 * exposes the cap as a top-level `max` (NOT the `pgPoolOptions` surface
 * `PgVector` uses); the value is bound there in `buildMastraStorage()`.
 */
const MASTRA_STORAGE_POOL_MAX = 5

/**
 * Build the PostgresStore that backs both Mastra Memory AND the
 * Mastra-instance-level storage (scores, workflows, etc.). Pure
 * factory — does not open a connection at construction time. The
 * pool is established on the first storage read/write.
 *
 * Why shared across Memory + Mastra: `PostgresStore` owns the pg
 * connection pool internally. Constructing one instance for Memory
 * and a second for `new Mastra({ storage })` would double pool
 * capacity against admin's `connection_limit=10` Prisma budget for
 * no benefit. A single `PostgresStore` singleton serves every
 * composite-store domain (memory, scores, workflows, …) from one
 * pool.
 */
export function buildMastraStorage(): PostgresStore {
  return new PostgresStore({
    id: "admin-chat-storage",
    connectionString: resolveMastraStorageUrl(),
    schemaName: MASTRA_SCHEMA_NAME,
    // Cap the pool (mirrors the PgVector cap rationale — see
    // MASTRA_STORAGE_POOL_MAX). `PostgresStore`'s ConnectionStringConfig
    // takes the cap as a top-level `max`, not `pgPoolOptions`.
    max: MASTRA_STORAGE_POOL_MAX,
  })
}

let cachedStorage: PostgresStore | null = null

/**
 * Singleton PostgresStore shared by `getMastraMemory()` and the
 * `new Mastra({ storage })` configuration in `./index.ts`. Both
 * call sites must read this same instance so they share the pool.
 *
 * Lazy construction: the connection pool is established on the
 * first storage I/O, not at module load — matches the lazy
 * construction discipline `getMastra()` follows in `./index.ts`.
 */
export function getMastraStorage(): PostgresStore {
  if (cachedStorage === null) {
    cachedStorage = buildMastraStorage()
  }
  return cachedStorage
}

// ---------------------------------------------------------------------------
// Semantic recall — JesusFilm gateway embeddings (Qwen3-Embedding-8B)
// ---------------------------------------------------------------------------

const MASTRA_VECTOR_POOL_MAX = 2
// Gateway base URL + User-Agent fallbacks now live in the import-free
// `./gateway-constants` module (shared with providers.ts + the agent
// files); see that file's header for the Rollup-safety rationale.
const GATEWAY_EMBEDDING_MODEL_FALLBACK = "embeddings"
const SEMANTIC_RECALL_TOP_K = 5
const SEMANTIC_RECALL_MESSAGE_RANGE = 2

/**
 * Resolve the API key used for gateway embedding calls. The gateway's
 * keys are MODEL-SCOPED: the chat (`coding`) key is rejected by the
 * `embeddings` model with `AI_APICallError: key can only access
 * models=['coding']`. So there is deliberately NO fallback to the chat
 * key — embeddings require the embeddings-scoped key explicitly. (An
 * earlier version fell back to the chat key "for a future combined
 * key"; that premature flexibility silently enabled recall with a
 * coding-only key and made every embed call 403 — see
 * `./providers` for the matching resolver.)
 */
function resolveGatewayEmbeddingApiKey(): string | undefined {
  return env.AI_GATEWAY_EMBEDDINGS_API_KEY
}

/**
 * Whether semantic recall is enabled. Gated on the presence of the
 * gateway EMBEDDING key specifically — NOT the chat key — so:
 *   - default deploy (no key) → memory is storage-only, unchanged;
 *   - chat key only → still storage-only (the chat key can't embed);
 *   - embedding key set → recall on, embedding via the embeddings model.
 */
export function isSemanticRecallEnabled(): boolean {
  return resolveGatewayEmbeddingApiKey() !== undefined
}

let cachedVector: PgVector | null = null

/**
 * Singleton PgVector store backing semantic recall, or null when no
 * gateway embedding key is configured. Lives in the same `mastra`
 * Postgres schema as the message store and shares the same connection
 * string, but owns its own pool — capped at `MASTRA_VECTOR_POOL_MAX` so
 * the message-store pool + Prisma's `connection_limit=10` budget keep
 * headroom.
 *
 * Mastra Memory auto-creates the vector index at the dimension it
 * detects from the embedder's first output (4096 for Qwen3-Embedding-8B),
 * so no DDL is managed here. That index is isolated from admin's other
 * pgvector spaces (scene/transcript 1536d, experience 2048d) by both
 * schema and table — never mix vectors across them.
 */
export function getMastraVectorStore(): PgVector | null {
  if (!isSemanticRecallEnabled()) return null
  if (cachedVector === null) {
    cachedVector = new PgVector({
      id: "admin-chat-vector",
      connectionString: resolveMastraStorageUrl(),
      schemaName: MASTRA_SCHEMA_NAME,
      pgPoolOptions: { max: MASTRA_VECTOR_POOL_MAX },
    })
  }
  return cachedVector
}

/**
 * Build the JesusFilm gateway embedder (Qwen3-Embedding-8B) as an AI SDK
 * embedding model. Loaded via the createRequire shim (see the
 * top-of-file note) and only ever called when a gateway embedding key is
 * present. The explicit User-Agent dodges Cloudflare's 403 on missing /
 * odd UAs in front of the gateway.
 */
function buildGatewayEmbedder() {
  const apiKey = resolveGatewayEmbeddingApiKey()
  // Callers gate on isSemanticRecallEnabled(); this guard keeps the
  // function honest if it is ever called directly.
  if (!apiKey) {
    throw new Error(
      "buildGatewayEmbedder called without a gateway embedding key",
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
    env.AI_GATEWAY_EMBEDDINGS_MODEL ?? GATEWAY_EMBEDDING_MODEL_FALLBACK,
  )
}

/**
 * Build the Mastra Memory instance for admin's Experience-AI chat.
 * Pure factory — does not open a connection at construction time.
 * The pool is established on the first storage read/write.
 *
 * When a gateway embedding key is configured (`isSemanticRecallEnabled()`),
 * Memory is built WITH semantic recall: the gateway embedder + the
 * PgVector store + recall options. Otherwise it is storage-only and
 * behaviour-identical to the pre-gateway wiring. The decision is made
 * once per build (singleton), so flipping the env var takes effect on the
 * next process start — acceptable for a deploy-time configuration knob.
 */
export function buildMastraMemory(): Memory {
  const vector = getMastraVectorStore()
  if (vector === null) {
    return new Memory({ storage: getMastraStorage() })
  }
  return new Memory({
    storage: getMastraStorage(),
    vector,
    // Cast absorbs the AI SDK EmbeddingModel V2/V3 peer-version churn
    // between @ai-sdk/openai's EmbeddingModelV3 and Mastra's bundled
    // copy — the same `as` discipline the agent model configs use.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedder: buildGatewayEmbedder() as any,
    options: {
      semanticRecall: {
        topK: SEMANTIC_RECALL_TOP_K,
        messageRange: SEMANTIC_RECALL_MESSAGE_RANGE,
        scope: "thread",
      },
    },
  })
}

/**
 * Singleton Memory instance shared by all admin chat agents.
 *
 * Why a singleton: Mastra's Memory primitive owns its own connection
 * pool internally; constructing multiple instances would multiply
 * pool capacity unnecessarily. Agents and workflows that need memory
 * import this same instance.
 *
 * Construction is lazy (deferred to first access) so that importing
 * the surrounding module in a build-phase context (where env may be
 * empty) does not open a doomed connection pool.
 */
let cached: Memory | null = null

export function getMastraMemory(): Memory {
  if (cached === null) {
    cached = buildMastraMemory()
  }
  return cached
}

/**
 * Test-only reset hook. Production code never resets the singleton —
 * the cached instance is the whole point. Tests use this to swap the
 * Memory + Mastra layers between cases.
 *
 * Intentionally does NOT reset `cachedStorage`: rebuilding the
 * PostgresStore on every test reset triggers `ScoresPG.init()` again,
 * which opens fresh connections and exhausts the pg pool across the
 * test suite ("too many clients already"). The storage layer is
 * idempotent across rebuilt Mastra instances, so reusing the same
 * `PostgresStore` (and its connection pool) between tests is safe
 * and avoids the pool-exhaustion noise.
 *
 * `__resetMastraStorageForTesting` is exported separately for the
 * narrow case where a test genuinely needs a fresh storage pool.
 */
export function __resetMastraMemoryForTesting(): void {
  cached = null
}

export function __resetMastraStorageForTesting(): void {
  cachedStorage = null
}

/**
 * Test-only reset hook for the semantic-recall vector singleton. Tests
 * that toggle the gateway embedding key between cases must reset this so
 * `getMastraVectorStore()` re-evaluates the enablement gate.
 */
export function __resetMastraVectorStoreForTesting(): void {
  cachedVector = null
}
