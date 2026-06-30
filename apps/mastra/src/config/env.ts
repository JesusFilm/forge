import { z } from "zod"

import {
  DEFAULT_EMBEDDING_TRANSFORM_VERSION,
  EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS,
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
} from "../services/embedding-provider"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway"
const DEFAULT_OPENROUTER_EMBEDDINGS_BASE_URL = "https://openrouter.ai/api/v1"
const DEFAULT_AI_GATEWAY_EMBEDDINGS_BASE_URL =
  "https://ai-gateway.jesusfilm.org/v1"
const DEFAULT_AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS = "ai-gateway.jesusfilm.org"
const DEFAULT_AI_GATEWAY_EMBEDDINGS_USER_AGENT =
  "forge-mastra-content-embeddings/1.0"
const DEFAULT_AI_GATEWAY_EMBEDDINGS_MODEL = "embeddings"
const DEFAULT_AI_GATEWAY_EMBEDDINGS_PROVIDER = "jesus-film-ai-gateway"
const DEFAULT_AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS = 60_000
const DEFAULT_FIRECRAWL_API_URL = "https://api.firecrawl.dev"
const DEFAULT_FIRECRAWL_ALLOWED_HOSTS = "api.firecrawl.dev"
const DEFAULT_FIRECRAWL_USER_AGENT = "forge-mastra-firecrawl/1.0"
const DEFAULT_FIRECRAWL_TIMEOUT_MS = 60_000
const DEFAULT_FIRECRAWL_MAX_SEARCH_RESULTS = 5
const DEFAULT_FIRECRAWL_MAX_MARKDOWN_CHARS = 16_000
const DEFAULT_SUBTITLE_ENRICHMENT_MODEL = "google/gemini-2.5-flash"
const DEFAULT_SUBTITLE_ENRICHMENT_TIMEOUT_MS = 120_000
const DEFAULT_SUBTITLE_ENRICHMENT_CONCURRENCY = 10
const DEFAULT_JESUSFILM_RAG_USER_AGENT = "forge-mastra-jesusfilm-rag/1.0"
const DEFAULT_JESUSFILM_RAG_TIMEOUT_MS = 5_000
// 2 MiB ceiling on the buffered RAG response body (feat-202). Sized ~8x above a
// generous legitimate topK=5 payload (≈ max passage text × 5 + citation
// overhead) so a valid retrieval is never rejected, while bounding the heap a
// misbehaving upstream can claim before the byte-cap aborts the stream. Override
// via JESUSFILM_RAG_MAX_RESPONSE_BYTES; never required at boot.
const DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES = 2_097_152
const DEFAULT_TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL =
  DEFAULT_SUBTITLE_ENRICHMENT_MODEL
const DEFAULT_TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS =
  DEFAULT_SUBTITLE_ENRICHMENT_TIMEOUT_MS
const DEFAULT_API_BIBLE_BASE_URL = "https://api.scripture.api.bible/v1"
const DEFAULT_API_BIBLE_ALLOWED_HOSTS = "api.scripture.api.bible"
const AI_GATEWAY_FINAL_EMBEDDING_DIMENSIONS =
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS
const AI_GATEWAY_TRANSFORM_VERSION = DEFAULT_EMBEDDING_TRANSFORM_VERSION
const AI_GATEWAY_NEEDS_CLIENT_TRANSFORM =
  EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS !==
  AI_GATEWAY_FINAL_EMBEDDING_DIMENSIONS

export type ContentEmbeddingsProviderMode = "legacy" | "gateway"

export type ContentEmbeddingProviderConfig = {
  apiKey?: string
  baseUrl: string
  model: string
  provider: string
  userAgent?: string
  timeoutMs?: number
  expectedNativeDimensions?: number
  truncateToDimensions?: number
  transformVersion?: string
}

export type FirecrawlConfig = {
  apiKey?: string
  apiUrl: string
  timeoutMs: number
  userAgent: string
  maxSearchResults: number
  maxMarkdownCharacters: number
}

export type JesusfilmRagConfig = {
  baseUrl?: string
  apiKey?: string
  timeoutMs: number
  userAgent: string
  /** Max bytes buffered from the RAG response body before the read aborts. */
  maxResponseBytes: number
}

const envSchema = z.object({
  ADMIN_EXPERIENCE_INGEST_URL: z.string().url().optional(),
  ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY: z.string().min(1).optional(),
  ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY: z.string().min(1).optional(),
  ADMIN_SEARCH_EVAL_API_KEY: z.string().min(1).optional(),
  ADMIN_SEARCH_EVAL_CANDIDATES_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_SEARCH_URL: z.string().url().optional(),
  ADMIN_SEARCH_TRACE_SAMPLE_URL: z.string().url().optional(),
  ADMIN_TRANSCRIPT_INGEST_URL: z.string().url().optional(),
  // Standalone chat agent tool callbacks → admin (consolidation U8). Base URL
  // of admin; the client appends `/api/internal/agent-tools/{tool}`. Bearer is
  // the value admin holds in its `ADMIN_AGENT_TOOLS_API_KEYS` receiver CSV. Both
  // optional: unset → the tool degrades to an empty result, never a boot fail.
  ADMIN_AGENT_TOOLS_URL: z.string().url().optional(),
  ADMIN_AGENT_TOOLS_API_KEY: z.string().min(1).optional(),
  // Single-attempt per-tool timeout. Must fit the 90s chatTurn budget with
  // maxSteps:8 — keep it small so several tool round-trips can complete in one
  // turn. Capped at 30s; default 10s.
  ADMIN_AGENT_TOOLS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(10_000),
  ADMIN_AGENT_TOOLS_USER_AGENT: z
    .string()
    .min(1)
    .default("forge-mastra-agent-tools/1.0"),
  // SSRF guard: when set, the admin base host must be in this CSV allowlist
  // before any agent-tool call, so the bearer never bleeds to an unvetted host.
  // Unset → the operator-set ADMIN_AGENT_TOOLS_URL host is trusted and
  // `redirect:"error"` still blocks off-host hops. Mirrors the chat relay's
  // MASTRA_CHAT_ALLOWED_HOSTS.
  ADMIN_AGENT_TOOLS_ALLOWED_HOSTS: z.string().min(1).optional(),
  AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS: z
    .string()
    .min(1)
    .default(DEFAULT_AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS),
  AI_GATEWAY_EMBEDDINGS_API_KEY: z.string().min(1).optional(),
  AI_GATEWAY_EMBEDDINGS_BASE_URL: z
    .string()
    .url()
    .default(DEFAULT_AI_GATEWAY_EMBEDDINGS_BASE_URL),
  AI_GATEWAY_EMBEDDINGS_MODEL: z
    .string()
    .min(1)
    .default(DEFAULT_AI_GATEWAY_EMBEDDINGS_MODEL),
  AI_GATEWAY_EMBEDDINGS_PROVIDER: z
    .string()
    .min(1)
    .default(DEFAULT_AI_GATEWAY_EMBEDDINGS_PROVIDER),
  AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(DEFAULT_AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS),
  AI_GATEWAY_EMBEDDINGS_USER_AGENT: z
    .string()
    .min(1)
    .default(DEFAULT_AI_GATEWAY_EMBEDDINGS_USER_AGENT),
  // --- Chat / draft-authoring providers (consolidated from admin, U2) ---
  // All optional: chat/draft generation is opt-in and flag-gated; the
  // default provider (openrouter) needs none of these. New cross-service
  // scaffolding env vars stay optional so an unprovisioned Railway env boots.
  AI_GATEWAY_CHAT_API_KEY: z.string().min(1).optional(),
  AI_GATEWAY_CHAT_BASE_URL: z.string().url().optional(),
  AI_GATEWAY_CHAT_ENABLED: z.string().optional(),
  AI_GATEWAY_CHAT_MODEL: z.string().min(1).optional(),
  AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED: z
    .enum(["true", "false"])
    .optional()
    .default("false"),
  EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .default(2),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  MASTRA_DEFAULT_PROVIDER: z
    .enum([
      "openrouter",
      "ollama",
      "openai",
      "anthropic",
      "google",
      "jesusfilm",
    ])
    .optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PHASE: z.string().optional(),
  MASTRA_SERVICE_API_KEYS: z.string().min(1).optional(),
  MASTRA_NATIVE_EVAL_ENVIRONMENT: z.string().min(1).optional(),
  MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE: z
    .enum(["legacy", "gateway"])
    .optional(),
  MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT: z
    .enum(["true", "false"])
    .default("false"),
  MASTRA_SEARCH_EVAL_ARTIFACT_DIR: z.string().min(1).optional(),
  MASTRA_STORAGE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  MASTRA_STORAGE_DIR: z.string().min(1).optional(),
  OPENAI_EMBEDDINGS_BASE_URL: z
    .string()
    .url()
    .default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_PAID_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_EMBEDDINGS_BASE_URL: z
    .string()
    .url()
    .default(DEFAULT_OPENROUTER_EMBEDDINGS_BASE_URL),
  RAILWAY_VOLUME_MOUNT_PATH: z.string().min(1).optional(),
  EXPERIENCE_EMBEDDING_MODEL: z
    .string()
    .min(1)
    .default("openai/text-embedding-3-small"),
  EXPERIENCE_EMBEDDING_PROVIDER: z.string().min(1).default("openai"),
  EVAL_QUERY_GENERATION_MODEL: z
    .string()
    .min(1)
    .default("anthropic/claude-haiku-4-5"),
  FIRECRAWL_ALLOWED_HOSTS: z
    .string()
    .min(1)
    .default(DEFAULT_FIRECRAWL_ALLOWED_HOSTS),
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  FIRECRAWL_API_URL: z.string().url().default(DEFAULT_FIRECRAWL_API_URL),
  FIRECRAWL_MAX_MARKDOWN_CHARS: z.coerce
    .number()
    .int()
    .positive()
    .max(100_000)
    .default(DEFAULT_FIRECRAWL_MAX_MARKDOWN_CHARS),
  FIRECRAWL_MAX_SEARCH_RESULTS: z.coerce
    .number()
    .int()
    .positive()
    .max(20)
    .default(DEFAULT_FIRECRAWL_MAX_SEARCH_RESULTS),
  FIRECRAWL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(DEFAULT_FIRECRAWL_TIMEOUT_MS),
  FIRECRAWL_USER_AGENT: z.string().min(1).default(DEFAULT_FIRECRAWL_USER_AGENT),
  INSTAGRAM_DISCOVERY_ARTIFACT_DIR: z.string().min(1).optional(),
  RAILWAY_S3_ENDPOINT: z.string().url().optional(),
  RAILWAY_S3_REGION: z.string().min(1).default("auto"),
  RAILWAY_S3_BUCKET: z.string().min(1).optional(),
  RAILWAY_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  RAILWAY_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // RAG retrieval (feat-199). Fully optional — unset degrades to a runtime
  // `config_missing` result, never a boot failure (ticket "never a boot
  // failure"). The base URL is gated by `JESUSFILM_RAG_ALLOWED_HOSTS` in
  // production (the one RAG-driven boot throw — a security control), but no RAG
  // var is ever pushed into the production `missing` list.
  JESUSFILM_RAG_ALLOWED_HOSTS: z.string().min(1).optional(),
  JESUSFILM_RAG_API_KEY: z.string().min(1).optional(),
  JESUSFILM_RAG_BASE_URL: z.string().url().optional(),
  // Caller-budget rule (docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md):
  // this single-attempt RAG timeout MUST stay strictly below the upstream
  // ceiling — the Mastra agent tool-call budget, well under Railway's request
  // limit. The 30_000 cap is comfortably under that today. If a future
  // mastra-gateway enforces a tighter per-turn budget (e.g. 10 s), lower this
  // cap to match so a misconfigured override can't outlive the caller.
  JESUSFILM_RAG_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(DEFAULT_JESUSFILM_RAG_TIMEOUT_MS),
  JESUSFILM_RAG_USER_AGENT: z
    .string()
    .min(1)
    .default(DEFAULT_JESUSFILM_RAG_USER_AGENT),
  // Byte-cap on the buffered RAG response body (feat-202). `.optional()` with a
  // runtime fallback in `getJesusfilmRagConfig()` — NOT a required-at-boot var
  // (KTD5: stays out of the production `missing` list in assertMastraRuntimeEnv).
  // Unset → DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES (2 MiB). The 16 MiB `.max()`
  // ceiling fails LOUD (boot-time parse error) on an over-range operator typo
  // like "99999999999" rather than silently widening the cap to ~93 GB and
  // defeating the OOM guard this var exists to provide — a fail-open footgun on a
  // safety control. 16 MiB is 8× the default: ample headroom for a legitimate
  // raise if passages grow, while bounding the ~2× transient peak per in-flight
  // read so even the widest sanctioned config stays survivable on the shared
  // process. Mirrors the sibling JESUSFILM_RAG_TIMEOUT_MS `.max(30_000)`.
  JESUSFILM_RAG_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(16_777_216)
    .optional(),
  SEARCH_EVAL_JUDGE_MODEL: z
    .string()
    .min(1)
    .default("anthropic/claude-haiku-4-5"),
  // Default-off gate for the internal `/forge-seeker` SSE service route
  // (feat-204, KTD7). Optional + no default — unset means the route is
  // disabled (returns 404). Read via the repo's string-boolean convention
  // (`=== "true"`, see AI_GATEWAY_CHAT_ENABLED), NOT JS truthiness, so
  // `SEEKER_ROUTE_ENABLED="false"` stays disabled. No new required-at-boot var.
  SEEKER_ROUTE_ENABLED: z.string().optional(),
  SUBTITLE_ENRICHMENT_MODEL: z
    .string()
    .min(1)
    .default(DEFAULT_SUBTITLE_ENRICHMENT_MODEL),
  SUBTITLE_ENRICHMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(DEFAULT_SUBTITLE_ENRICHMENT_TIMEOUT_MS),
  SUBTITLE_ENRICHMENT_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .max(25)
    .default(DEFAULT_SUBTITLE_ENRICHMENT_CONCURRENCY),
  TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL: z
    .string()
    .min(1)
    .default(DEFAULT_TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL),
  TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(DEFAULT_TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS),
  SUBTITLE_VALIDATION_BIBLE_PROVIDER: z.string().min(1).optional(),
  SUBTITLE_VALIDATION_BIBLE_MAP_JSON: z.string().min(2).optional(),
  API_BIBLE_API_KEY: z.string().min(1).optional(),
  API_BIBLE_BASE_URL: z.string().min(1).default(DEFAULT_API_BIBLE_BASE_URL),
  API_BIBLE_ALLOWED_HOSTS: z
    .string()
    .min(1)
    .default(DEFAULT_API_BIBLE_ALLOWED_HOSTS),
  SMART_CROP_IMAGE_URL_ALLOWED_HOSTS: z.string().min(1).optional(),
  SMART_CROP_PLAN_MODEL: z.string().min(1).optional(),
  SMART_CROP_QA_MODEL: z.string().min(1).optional(),
  TRANSCRIPT_EMBEDDING_MODEL: z
    .string()
    .min(1)
    .default("openai/text-embedding-3-small"),
  TRANSCRIPT_EMBEDDING_PROVIDER: z.string().min(1).default("openai"),
})

export const env = envSchema.parse({
  ADMIN_EXPERIENCE_INGEST_URL: emptyToUndefined(
    process.env.ADMIN_EXPERIENCE_INGEST_URL,
  ),
  ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY: emptyToUndefined(
    process.env.ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY,
  ),
  ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY: emptyToUndefined(
    process.env.ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY,
  ),
  ADMIN_SEARCH_EVAL_API_KEY: emptyToUndefined(
    process.env.ADMIN_SEARCH_EVAL_API_KEY,
  ),
  ADMIN_SEARCH_EVAL_CANDIDATES_URL: emptyToUndefined(
    process.env.ADMIN_SEARCH_EVAL_CANDIDATES_URL,
  ),
  ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL: emptyToUndefined(
    process.env.ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL,
  ),
  ADMIN_SEARCH_EVAL_SEARCH_URL: emptyToUndefined(
    process.env.ADMIN_SEARCH_EVAL_SEARCH_URL,
  ),
  ADMIN_SEARCH_TRACE_SAMPLE_URL: emptyToUndefined(
    process.env.ADMIN_SEARCH_TRACE_SAMPLE_URL,
  ),
  ADMIN_TRANSCRIPT_INGEST_URL: emptyToUndefined(
    process.env.ADMIN_TRANSCRIPT_INGEST_URL,
  ),
  ADMIN_AGENT_TOOLS_URL: emptyToUndefined(process.env.ADMIN_AGENT_TOOLS_URL),
  ADMIN_AGENT_TOOLS_API_KEY: emptyToUndefined(
    process.env.ADMIN_AGENT_TOOLS_API_KEY,
  ),
  ADMIN_AGENT_TOOLS_TIMEOUT_MS: emptyToUndefined(
    process.env.ADMIN_AGENT_TOOLS_TIMEOUT_MS,
  ),
  ADMIN_AGENT_TOOLS_USER_AGENT: emptyToUndefined(
    process.env.ADMIN_AGENT_TOOLS_USER_AGENT,
  ),
  ADMIN_AGENT_TOOLS_ALLOWED_HOSTS: emptyToUndefined(
    process.env.ADMIN_AGENT_TOOLS_ALLOWED_HOSTS,
  ),
  AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS: emptyToUndefined(
    process.env.AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS,
  ),
  AI_GATEWAY_EMBEDDINGS_API_KEY: emptyToUndefined(
    process.env.AI_GATEWAY_EMBEDDINGS_API_KEY,
  ),
  AI_GATEWAY_EMBEDDINGS_BASE_URL: emptyToUndefined(
    process.env.AI_GATEWAY_EMBEDDINGS_BASE_URL,
  ),
  AI_GATEWAY_EMBEDDINGS_MODEL: emptyToUndefined(
    process.env.AI_GATEWAY_EMBEDDINGS_MODEL,
  ),
  AI_GATEWAY_EMBEDDINGS_PROVIDER: emptyToUndefined(
    process.env.AI_GATEWAY_EMBEDDINGS_PROVIDER,
  ),
  AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS: emptyToUndefined(
    process.env.AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS,
  ),
  AI_GATEWAY_EMBEDDINGS_USER_AGENT: emptyToUndefined(
    process.env.AI_GATEWAY_EMBEDDINGS_USER_AGENT,
  ),
  AI_GATEWAY_CHAT_API_KEY: emptyToUndefined(
    process.env.AI_GATEWAY_CHAT_API_KEY,
  ),
  AI_GATEWAY_CHAT_BASE_URL: emptyToUndefined(
    process.env.AI_GATEWAY_CHAT_BASE_URL,
  ),
  AI_GATEWAY_CHAT_ENABLED: emptyToUndefined(
    process.env.AI_GATEWAY_CHAT_ENABLED,
  ),
  AI_GATEWAY_CHAT_MODEL: emptyToUndefined(process.env.AI_GATEWAY_CHAT_MODEL),
  AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED: emptyToUndefined(
    process.env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED,
  ),
  EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS: emptyToUndefined(
    process.env.EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS,
  ),
  GOOGLE_GENERATIVE_AI_API_KEY: emptyToUndefined(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  ),
  MASTRA_DEFAULT_PROVIDER: emptyToUndefined(
    process.env.MASTRA_DEFAULT_PROVIDER,
  ),
  OLLAMA_BASE_URL: emptyToUndefined(process.env.OLLAMA_BASE_URL),
  OPENAI_BASE_URL: emptyToUndefined(process.env.OPENAI_BASE_URL),
  DATABASE_URL: emptyToUndefined(process.env.DATABASE_URL),
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PHASE: process.env.NEXT_PHASE,
  MASTRA_SERVICE_API_KEYS: emptyToUndefined(
    process.env.MASTRA_SERVICE_API_KEYS,
  ),
  MASTRA_NATIVE_EVAL_ENVIRONMENT: emptyToUndefined(
    process.env.MASTRA_NATIVE_EVAL_ENVIRONMENT,
  ),
  MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE: emptyToUndefined(
    process.env.MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE,
  ),
  MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT: emptyToUndefined(
    process.env.MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT,
  ),
  MASTRA_SEARCH_EVAL_ARTIFACT_DIR: emptyToUndefined(
    process.env.MASTRA_SEARCH_EVAL_ARTIFACT_DIR,
  ),
  MASTRA_STORAGE_BACKEND: emptyToUndefined(process.env.MASTRA_STORAGE_BACKEND),
  MASTRA_STORAGE_DIR: emptyToUndefined(process.env.MASTRA_STORAGE_DIR),
  OPENAI_EMBEDDINGS_BASE_URL: emptyToUndefined(
    process.env.OPENAI_EMBEDDINGS_BASE_URL,
  ),
  OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
  OPENROUTER_API_PAID_KEY: emptyToUndefined(
    process.env.OPENROUTER_API_PAID_KEY,
  ),
  OPENROUTER_API_KEY: emptyToUndefined(process.env.OPENROUTER_API_KEY),
  OPENROUTER_EMBEDDINGS_BASE_URL: emptyToUndefined(
    process.env.OPENROUTER_EMBEDDINGS_BASE_URL,
  ),
  RAILWAY_VOLUME_MOUNT_PATH: emptyToUndefined(
    process.env.RAILWAY_VOLUME_MOUNT_PATH,
  ),
  EXPERIENCE_EMBEDDING_MODEL: emptyToUndefined(
    process.env.EXPERIENCE_EMBEDDING_MODEL,
  ),
  EXPERIENCE_EMBEDDING_PROVIDER: emptyToUndefined(
    process.env.EXPERIENCE_EMBEDDING_PROVIDER,
  ),
  EVAL_QUERY_GENERATION_MODEL: emptyToUndefined(
    process.env.EVAL_QUERY_GENERATION_MODEL,
  ),
  FIRECRAWL_ALLOWED_HOSTS: emptyToUndefined(
    process.env.FIRECRAWL_ALLOWED_HOSTS,
  ),
  FIRECRAWL_API_KEY: emptyToUndefined(process.env.FIRECRAWL_API_KEY),
  FIRECRAWL_API_URL: emptyToUndefined(process.env.FIRECRAWL_API_URL),
  FIRECRAWL_MAX_MARKDOWN_CHARS: emptyToUndefined(
    process.env.FIRECRAWL_MAX_MARKDOWN_CHARS,
  ),
  FIRECRAWL_MAX_SEARCH_RESULTS: emptyToUndefined(
    process.env.FIRECRAWL_MAX_SEARCH_RESULTS,
  ),
  FIRECRAWL_TIMEOUT_MS: emptyToUndefined(process.env.FIRECRAWL_TIMEOUT_MS),
  FIRECRAWL_USER_AGENT: emptyToUndefined(process.env.FIRECRAWL_USER_AGENT),
  INSTAGRAM_DISCOVERY_ARTIFACT_DIR: emptyToUndefined(
    process.env.INSTAGRAM_DISCOVERY_ARTIFACT_DIR,
  ),
  RAILWAY_S3_ENDPOINT: emptyToUndefined(process.env.RAILWAY_S3_ENDPOINT),
  RAILWAY_S3_REGION: emptyToUndefined(process.env.RAILWAY_S3_REGION),
  RAILWAY_S3_BUCKET: emptyToUndefined(process.env.RAILWAY_S3_BUCKET),
  RAILWAY_S3_ACCESS_KEY_ID: emptyToUndefined(
    process.env.RAILWAY_S3_ACCESS_KEY_ID,
  ),
  RAILWAY_S3_SECRET_ACCESS_KEY: emptyToUndefined(
    process.env.RAILWAY_S3_SECRET_ACCESS_KEY,
  ),
  JESUSFILM_RAG_ALLOWED_HOSTS: emptyToUndefined(
    process.env.JESUSFILM_RAG_ALLOWED_HOSTS,
  ),
  JESUSFILM_RAG_API_KEY: emptyToUndefined(process.env.JESUSFILM_RAG_API_KEY),
  JESUSFILM_RAG_BASE_URL: emptyToUndefined(process.env.JESUSFILM_RAG_BASE_URL),
  JESUSFILM_RAG_TIMEOUT_MS: emptyToUndefined(
    process.env.JESUSFILM_RAG_TIMEOUT_MS,
  ),
  JESUSFILM_RAG_MAX_RESPONSE_BYTES: emptyToUndefined(
    process.env.JESUSFILM_RAG_MAX_RESPONSE_BYTES,
  ),
  JESUSFILM_RAG_USER_AGENT: emptyToUndefined(
    process.env.JESUSFILM_RAG_USER_AGENT,
  ),
  SEARCH_EVAL_JUDGE_MODEL: emptyToUndefined(
    process.env.SEARCH_EVAL_JUDGE_MODEL,
  ),
  SEEKER_ROUTE_ENABLED: emptyToUndefined(process.env.SEEKER_ROUTE_ENABLED),
  SUBTITLE_ENRICHMENT_MODEL: emptyToUndefined(
    process.env.SUBTITLE_ENRICHMENT_MODEL,
  ),
  SUBTITLE_ENRICHMENT_TIMEOUT_MS: emptyToUndefined(
    process.env.SUBTITLE_ENRICHMENT_TIMEOUT_MS,
  ),
  SUBTITLE_ENRICHMENT_CONCURRENCY: emptyToUndefined(
    process.env.SUBTITLE_ENRICHMENT_CONCURRENCY,
  ),
  TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL: emptyToUndefined(
    process.env.TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL,
  ),
  TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS: emptyToUndefined(
    process.env.TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS,
  ),
  SUBTITLE_VALIDATION_BIBLE_PROVIDER: emptyToUndefined(
    process.env.SUBTITLE_VALIDATION_BIBLE_PROVIDER,
  ),
  SUBTITLE_VALIDATION_BIBLE_MAP_JSON: emptyToUndefined(
    process.env.SUBTITLE_VALIDATION_BIBLE_MAP_JSON,
  ),
  API_BIBLE_API_KEY: emptyToUndefined(process.env.API_BIBLE_API_KEY),
  API_BIBLE_BASE_URL: emptyToUndefined(process.env.API_BIBLE_BASE_URL),
  API_BIBLE_ALLOWED_HOSTS: emptyToUndefined(
    process.env.API_BIBLE_ALLOWED_HOSTS,
  ),
  SMART_CROP_IMAGE_URL_ALLOWED_HOSTS: emptyToUndefined(
    process.env.SMART_CROP_IMAGE_URL_ALLOWED_HOSTS,
  ),
  SMART_CROP_PLAN_MODEL: emptyToUndefined(process.env.SMART_CROP_PLAN_MODEL),
  SMART_CROP_QA_MODEL: emptyToUndefined(process.env.SMART_CROP_QA_MODEL),
  TRANSCRIPT_EMBEDDING_MODEL: emptyToUndefined(
    process.env.TRANSCRIPT_EMBEDDING_MODEL,
  ),
  TRANSCRIPT_EMBEDDING_PROVIDER: emptyToUndefined(
    process.env.TRANSCRIPT_EMBEDDING_PROVIDER,
  ),
})

function csvSet(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

function assertGatewayBaseUrlAllowedForProduction() {
  const baseUrl = new URL(env.AI_GATEWAY_EMBEDDINGS_BASE_URL)
  const allowedHosts = csvSet(env.AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS)
  if (baseUrl.protocol !== "https:" || !allowedHosts.has(baseUrl.hostname)) {
    throw new Error(
      "AI_GATEWAY_EMBEDDINGS_BASE_URL must use https and a host listed in AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS for Mastra production",
    )
  }
}

function assertFirecrawlApiUrlAllowedForProduction() {
  const apiUrl = new URL(env.FIRECRAWL_API_URL)
  const allowedHosts = csvSet(env.FIRECRAWL_ALLOWED_HOSTS)
  if (apiUrl.protocol !== "https:" || !allowedHosts.has(apiUrl.hostname)) {
    throw new Error(
      "FIRECRAWL_API_URL must use https and a host listed in FIRECRAWL_ALLOWED_HOSTS for Mastra production",
    )
  }
}

function assertJesusfilmRagBaseUrlAllowedForProduction() {
  // Conditional on the base URL being set: unconfigured RAG is valid by design
  // (the feature degrades at runtime). When the URL IS set, fail-closed — https
  // AND a non-empty allowlist containing the hostname, else throw. The allowlist
  // has no default (the RAG's deployed hostname is not recorded in its repo), so
  // a base-URL-set-but-allowlist-unset production config throws here. Mirrors
  // `assertFirecrawlApiUrlAllowedForProduction` but guarded on the URL being set.
  if (!env.JESUSFILM_RAG_BASE_URL) return
  const baseUrl = new URL(env.JESUSFILM_RAG_BASE_URL)
  const allowedHosts = env.JESUSFILM_RAG_ALLOWED_HOSTS
    ? csvSet(env.JESUSFILM_RAG_ALLOWED_HOSTS)
    : new Set<string>()
  if (baseUrl.protocol !== "https:" || !allowedHosts.has(baseUrl.hostname)) {
    throw new Error(
      "JESUSFILM_RAG_BASE_URL must use https and a host listed in JESUSFILM_RAG_ALLOWED_HOSTS for Mastra production",
    )
  }
}

function assertGatewayProviderContractAllowedForProduction() {
  if (
    env.AI_GATEWAY_EMBEDDINGS_MODEL !== DEFAULT_AI_GATEWAY_EMBEDDINGS_MODEL ||
    env.AI_GATEWAY_EMBEDDINGS_PROVIDER !==
      DEFAULT_AI_GATEWAY_EMBEDDINGS_PROVIDER
  ) {
    throw new Error(
      "AI_GATEWAY_EMBEDDINGS_MODEL and AI_GATEWAY_EMBEDDINGS_PROVIDER must match the approved production content embedding contract",
    )
  }
}

export function getContentEmbeddingsProviderMode(): ContentEmbeddingsProviderMode {
  if (env.MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE) {
    return env.MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE
  }
  if (env.NODE_ENV === "production" || env.AI_GATEWAY_EMBEDDINGS_API_KEY) {
    return "gateway"
  }
  return "legacy"
}

export function assertMastraRuntimeEnv() {
  if (
    env.NODE_ENV === "production" &&
    env.MASTRA_STORAGE_BACKEND === "memory"
  ) {
    throw new Error(
      "MASTRA_STORAGE_BACKEND=memory is not allowed in production",
    )
  }

  if (env.NODE_ENV !== "production") return

  const missing: Array<[string, unknown]> = [
    [
      "ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY",
      env.ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY,
    ],
    [
      "ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY",
      env.ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY,
    ],
    ["ADMIN_EXPERIENCE_INGEST_URL", env.ADMIN_EXPERIENCE_INGEST_URL],
    ["ADMIN_TRANSCRIPT_INGEST_URL", env.ADMIN_TRANSCRIPT_INGEST_URL],
    ["DATABASE_URL", env.DATABASE_URL],
    ["FIRECRAWL_API_KEY", env.FIRECRAWL_API_KEY],
    ["MASTRA_SERVICE_API_KEYS", env.MASTRA_SERVICE_API_KEYS],
  ]
  assertFirecrawlApiUrlAllowedForProduction()
  // The only RAG-driven boot throw (a security control). A missing
  // JESUSFILM_RAG_API_KEY is deliberately NOT in `missing` above — a key-absent
  // state degrades at runtime via the client's `config_missing` short-circuit,
  // honoring the ticket's "never a boot failure" rule.
  assertJesusfilmRagBaseUrlAllowedForProduction()

  if (getContentEmbeddingsProviderMode() === "gateway") {
    missing.push([
      "AI_GATEWAY_EMBEDDINGS_API_KEY",
      env.AI_GATEWAY_EMBEDDINGS_API_KEY,
    ])
    assertGatewayBaseUrlAllowedForProduction()
    assertGatewayProviderContractAllowedForProduction()
  } else {
    missing.push([
      "OPENROUTER_API_PAID_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY",
      getOpenRouterApiKey() ?? env.OPENAI_API_KEY,
    ])
  }

  const missingNames = missing
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missingNames.length > 0) {
    throw new Error(`${missingNames.join(", ")} required for Mastra production`)
  }
}

export function getMastraDatabaseUrl() {
  return env.DATABASE_URL ?? LOCAL_DATABASE_URL
}

export function getMastraStorageDir() {
  if (env.MASTRA_STORAGE_DIR) return env.MASTRA_STORAGE_DIR
  if (env.RAILWAY_VOLUME_MOUNT_PATH) {
    return `${env.RAILWAY_VOLUME_MOUNT_PATH.replace(/\/$/, "")}/mastra`
  }
  return ".mastra/storage"
}

export function getOpenRouterApiKey(): string | undefined {
  return env.OPENROUTER_API_PAID_KEY ?? env.OPENROUTER_API_KEY
}

/**
 * Whether the internal `/forge-seeker` SSE service route is enabled (feat-204,
 * KTD7). Default-off: the route returns 404 unless this is explicitly set to
 * the string `"true"`. Uses the repo's string-boolean convention (matching
 * `AI_GATEWAY_CHAT_ENABLED`), NOT JS truthiness — `"false"` (or any other
 * value) keeps the route disabled, preserving the safety default.
 */
export function isSeekerRouteEnabled(): boolean {
  return env.SEEKER_ROUTE_ENABLED === "true"
}

export function getFirecrawlConfig(): FirecrawlConfig {
  return {
    apiKey: env.FIRECRAWL_API_KEY,
    apiUrl: env.FIRECRAWL_API_URL,
    timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
    userAgent: env.FIRECRAWL_USER_AGENT,
    maxSearchResults: env.FIRECRAWL_MAX_SEARCH_RESULTS,
    maxMarkdownCharacters: env.FIRECRAWL_MAX_MARKDOWN_CHARS,
  }
}

export function getJesusfilmRagConfig(): JesusfilmRagConfig {
  return {
    baseUrl: env.JESUSFILM_RAG_BASE_URL,
    apiKey: env.JESUSFILM_RAG_API_KEY,
    timeoutMs: env.JESUSFILM_RAG_TIMEOUT_MS,
    userAgent: env.JESUSFILM_RAG_USER_AGENT,
    // `.optional()` schema + runtime fallback: keeps the knob out of the
    // boot-time `missing` list while always handing the client a concrete cap.
    maxResponseBytes:
      env.JESUSFILM_RAG_MAX_RESPONSE_BYTES ??
      DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES,
  }
}

export type AdminAgentToolsConfig = {
  baseUrl?: string
  apiKey?: string
  timeoutMs: number
  userAgent: string
  allowedHosts?: string
}

/**
 * Config for the standalone chat agent's tool callbacks to admin
 * (consolidation U8). `baseUrl`/`apiKey` are optional — absent means the tool
 * degrades to an empty result at runtime, never a boot failure.
 */
export function getAdminAgentToolsConfig(): AdminAgentToolsConfig {
  return {
    baseUrl: env.ADMIN_AGENT_TOOLS_URL,
    apiKey: env.ADMIN_AGENT_TOOLS_API_KEY,
    timeoutMs: env.ADMIN_AGENT_TOOLS_TIMEOUT_MS,
    userAgent: env.ADMIN_AGENT_TOOLS_USER_AGENT,
    allowedHosts: env.ADMIN_AGENT_TOOLS_ALLOWED_HOSTS,
  }
}

function getLegacyEmbeddingProviderConfig(
  model: string,
  provider: string,
): ContentEmbeddingProviderConfig {
  const openRouterApiKey = getOpenRouterApiKey()
  if (openRouterApiKey) {
    return {
      apiKey: openRouterApiKey,
      baseUrl: env.OPENROUTER_EMBEDDINGS_BASE_URL,
      model,
      provider,
    }
  }

  return {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_EMBEDDINGS_BASE_URL,
    model,
    provider,
  }
}

function getGatewayEmbeddingProviderConfig(): ContentEmbeddingProviderConfig {
  return {
    apiKey: env.AI_GATEWAY_EMBEDDINGS_API_KEY,
    baseUrl: env.AI_GATEWAY_EMBEDDINGS_BASE_URL,
    model: env.AI_GATEWAY_EMBEDDINGS_MODEL,
    provider: env.AI_GATEWAY_EMBEDDINGS_PROVIDER,
    userAgent: env.AI_GATEWAY_EMBEDDINGS_USER_AGENT,
    timeoutMs: env.AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS,
    expectedNativeDimensions: EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS,
    ...(AI_GATEWAY_NEEDS_CLIENT_TRANSFORM
      ? {
          truncateToDimensions: AI_GATEWAY_FINAL_EMBEDDING_DIMENSIONS,
          transformVersion: AI_GATEWAY_TRANSFORM_VERSION,
        }
      : {}),
  }
}

function getContentEmbeddingProviderConfig(
  model: string,
  provider: string,
): ContentEmbeddingProviderConfig {
  if (getContentEmbeddingsProviderMode() === "gateway") {
    return getGatewayEmbeddingProviderConfig()
  }
  return getLegacyEmbeddingProviderConfig(model, provider)
}

export function getTranscriptEmbeddingProviderConfig() {
  return getContentEmbeddingProviderConfig(
    env.TRANSCRIPT_EMBEDDING_MODEL,
    env.TRANSCRIPT_EMBEDDING_PROVIDER,
  )
}

export function getExperienceEmbeddingProviderConfig() {
  return getContentEmbeddingProviderConfig(
    env.EXPERIENCE_EMBEDDING_MODEL,
    env.EXPERIENCE_EMBEDDING_PROVIDER,
  )
}
