import { z } from "zod"

import {
  DEFAULT_EMBEDDING_TRANSFORM_VERSION,
  EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS,
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
} from "../services/embedding-provider"
import { parseServiceApiKeys } from "../server/service-bearer"

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
const DEFAULT_DEVOTIONAL_MODEL = "anthropic/claude-haiku-4-5"
const DEFAULT_DEVOTIONAL_WORKSPACE_PREFIX = "devotional"
const DEFAULT_DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX = 3
const DEFAULT_YOUTUBE_ALLOWED_HOSTS = "www.googleapis.com"
const DEFAULT_HELP_SCOUT_API_URL = "https://api.helpscout.net/v2"
const DEFAULT_HELP_SCOUT_AUTH_URL = "https://api.helpscout.net/v2/oauth2/token"
const DEFAULT_LINEAR_API_URL = "https://api.linear.app/graphql"
const DEFAULT_SUPPORT_RESEARCH_MODEL = "openai/gpt-5.4-mini"
const DEFAULT_SUPPORT_RESEARCH_TIMEOUT_MS = 15_000
const DEFAULT_SUPPORT_RESEARCH_MAX_RESPONSE_BYTES = 1_048_576
const DEFAULT_SUPPORT_RESEARCH_MAX_CONVERSATIONS = 200
const DEFAULT_SUPPORT_RESEARCH_MAX_ACTIONS = 5
const DEFAULT_SUPPORT_RESEARCH_RETENTION_DAYS = 90
const DEFAULT_DATADOG_TRIAGE_MODEL = "openai/gpt-5.4-mini"
const DEFAULT_DATADOG_TRIAGE_SITE = "datadoghq.com"
const DEFAULT_DATADOG_TRIAGE_SERVICES = "forge-mobile"
const DEFAULT_DATADOG_TRIAGE_MAX_CANDIDATES_PER_RUN = 200
const DEFAULT_DATADOG_TRIAGE_MAX_TICKETS_PER_DAY = 5
const DEFAULT_DATADOG_TRIAGE_TIMEOUT_MS = 15_000
// The judge is an LLM generation, not an HTTP GET. Reusing the Datadog/Linear
// budget aborted routine generations, and every abort withholds the candidate
// and re-judges it next hour. Sibling single-call LLM surfaces use 120s.
const DEFAULT_DATADOG_TRIAGE_JUDGE_TIMEOUT_MS = 60_000
// A POLICY ceiling, not a derived bound: a 100-issue page with long stack
// messages measures in the low hundreds of kB, so this leaves ~10x headroom.
// Over-cap aborts the stream onto the existing graceful-failure path.
const DEFAULT_DATADOG_TRIAGE_MAX_RESPONSE_BYTES = 4_194_304
const DEFAULT_DATADOG_TRIAGE_OVERLAP_MS = 300_000
const DEFAULT_DATADOG_TRIAGE_LAG_MS = 180_000
// How far back a service's FIRST covered run reads to record its standing
// issue set (F3). One hour would baseline only what happened in that hour and
// make every older standing error look new on the second run.
const DEFAULT_DATADOG_TRIAGE_BASELINE_LOOKBACK_MS = 604_800_000
const DEFAULT_DATADOG_TRIAGE_CONFIDENCE = 0.7
const DEFAULT_DATADOG_TRIAGE_ACTIONABILITY = 0.6
const DEFAULT_DATADOG_TRIAGE_MIN_OCCURRENCES = 3
const DEFAULT_DATADOG_TRIAGE_REGRESSION_MULTIPLIER = 3
const DEFAULT_DATADOG_TRIAGE_MONITOR_COOLDOWN_MS = 21_600_000
const DEFAULT_DATADOG_TRIAGE_SPIKE_MULTIPLIER = 3
// Release-session discriminator (R17/KTD4), pinned against the live
// 2026-08-19 `forge-mobile` sample: store builds carry semver, dev-session
// noise carries ad-hoc tags like `fixcheck-20260805`.
const DEFAULT_DATADOG_TRIAGE_RELEASE_VERSION_PATTERN =
  "^\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?$"
const DEFAULT_DATADOG_TRIAGE_DEV_SESSION_MARKERS =
  "127.0.0.1,localhost,10.0.2.2,dev=true,exp://,expo-development-client"
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
// 2 MiB ceiling on the buffered admin agent-tools response body (feat-327).
//
// This is a POLICY ceiling, not a derived contract bound — say so plainly,
// because the derivation does not close: admin's search-videos projection
// truncates neither `snippet` (a raw catalog description) nor `title`, and the
// shared client's own input schema admits `limit` up to 20, not just the
// seeker's pinned 8. So no upstream invariant caps the honest worst case.
//
// What the number IS sized against, in BYTES: a plausible large legitimate
// response — 20 rows × a generous 8,000 UTF-16 units of snippet at the repo's
// 3-bytes-per-unit worst case ≈ 480 kB plus envelope. 2 MiB leaves ~4x headroom
// over that while still bounding what a misbehaving upstream can push onto the
// heap of the single process running every Mastra agent and workflow. Over-cap
// is not an outage: it aborts the stream and rides the existing
// `parse_error` → empty-result path. Raise the knob if a real payload ever
// trips it; do not remove the cap.
//
// Override via ADMIN_AGENT_TOOLS_MAX_RESPONSE_BYTES; never required at boot.
const DEFAULT_ADMIN_AGENT_TOOLS_MAX_RESPONSE_BYTES = 2_097_152
const DEFAULT_LANGFUSE_USER_AGENT = "forge-mastra-langfuse/1.0"
const DEFAULT_LANGFUSE_TIMEOUT_MS = 3_000
// Separate budget for the feat-336 trace-retention sweep: its caller is a
// daily timer, not a chat turn, and the live DELETE was MEASURED at ~3.4 s
// for a 2-id batch (2026-08-11) — over the prompt-tuned 3 s default the sweep
// previously inherited. 15 s ≈ 4× observed; 50-id batches are unmeasured.
const DEFAULT_LANGFUSE_TRACE_RETENTION_TIMEOUT_MS = 15_000
// 256 KiB ceiling on the buffered Langfuse prompt response body. Prompt
// payloads are small (a system prompt plus metadata), so this bounds the heap a
// misbehaving upstream can claim before the byte-cap aborts the stream while
// leaving generous headroom for any legitimate prompt. Override via
// LANGFUSE_MAX_RESPONSE_BYTES; never required at boot.
const DEFAULT_LANGFUSE_MAX_RESPONSE_BYTES = 262_144
const DEFAULT_LANGFUSE_PROMPT_CACHE_TTL_MS = 60_000
const DEFAULT_LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS = 10_000
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

export type InstagramSiteIngestConfig = {
  url: string
  token: string
}

export type JesusfilmRagConfig = {
  baseUrl?: string
  apiKey?: string
  timeoutMs: number
  userAgent: string
  /** Max bytes buffered from the RAG response body before the read aborts. */
  maxResponseBytes: number
}

export type LangfuseConfig = {
  baseUrl?: string
  publicKey?: string
  secretKey?: string
  timeoutMs: number
  userAgent: string
  /** Max bytes buffered from the Langfuse response body before the read aborts. */
  maxResponseBytes: number
  promptDefaultLabel?: string
  promptCacheTtlMs: number
  /** Clamped to promptCacheTtlMs — the smaller value always wins. */
  promptFailureCooldownMs: number
}

const envSchema = z.object({
  ADMIN_EXPERIENCE_INGEST_URL: z.string().url().optional(),
  ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY: z.string().min(1).optional(),
  ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY: z.string().min(1).optional(),
  ADMIN_SEARCH_EVAL_API_KEY: z.string().min(1).optional(),
  ADMIN_SEARCH_EVAL_CANDIDATES_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_SEARCH_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_SERVING_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_SERVING_API_KEY: z.string().min(1).optional(),
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
  // Byte-cap on the buffered agent-tools response body (feat-327). `.optional()`
  // with a runtime fallback in `getAdminAgentToolsConfig()` — mirrors
  // JESUSFILM_RAG_MAX_RESPONSE_BYTES: stays out of the boot-time `missing` list
  // while the 16 MiB `.max()` ceiling fails LOUD (boot-time parse error) on an
  // over-range operator typo rather than silently widening the cap and defeating
  // the OOM guard this var exists to provide.
  ADMIN_AGENT_TOOLS_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(16_777_216)
    .optional(),
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
  // Default-off gate prepending the JesusFilm gateway chat model to the seeker
  // agent's fallback chain (feat-237). Deliberately SEPARATE from
  // AI_GATEWAY_CHAT_ENABLED (which routes the experience chat/draft agents):
  // the two surfaces have different risk profiles and must roll back
  // independently. Optional + no default — unset keeps today's Gemma-only
  // chain. Read via the repo's string-boolean convention (`=== "true"`), NOT
  // JS truthiness, so `"false"` stays disabled. No new required-at-boot var.
  AI_GATEWAY_SEEKER_ENABLED: z.string().optional(),
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
  // Human devotional approval lane. Must be disjoint from the shared service
  // pool; unset keeps resume fail-closed until mastra-gateway is provisioned.
  DEVOTIONAL_APPROVAL_API_KEYS: z.string().min(1).optional(),
  // Read-only devotional status/artifact playback lane. Kept disjoint from
  // both mutation pools so the human review surface cannot start/cancel/retry.
  DEVOTIONAL_PLAYBACK_API_KEYS: z.string().min(1).optional(),
  // Emergency architecture-exception kill switch. False blocks new canonical
  // starts and retries while status, playback, approval, and cancel stay live.
  DEVOTIONAL_NEW_RUNS_ENABLED: z.enum(["true", "false"]).default("false"),
  // Dedicated bearer allowlist for the ai-chat history read routes (feat-241,
  // KTD2) — NOT the shared MASTRA_SERVICE_API_KEYS pool. Bulk conversation read
  // is scoped to its one intended holder (the chat service) so pool keys
  // (admin/manager pipelines) never silently gain transcript access.
  // `.optional()`: unset = empty allowlist = the history routes fail closed
  // (401) until provisioned; no new required-at-boot var.
  AI_CHAT_SERVICE_API_KEYS: z.string().min(1).optional(),
  MASTRA_NATIVE_EVAL_ENVIRONMENT: z.string().min(1).optional(),
  MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE: z
    .enum(["legacy", "gateway"])
    .optional(),
  MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT: z
    .enum(["true", "false"])
    .default("false"),
  MASTRA_SEARCH_EVAL_ARTIFACT_DIR: z.string().min(1).optional(),
  // Optional per-surface override for the ai-chat lane's Memory backend
  // (feat-208). Unset → follows MASTRA_STORAGE_BACKEND. `.optional()` so the
  // kill-switch adds zero required-at-boot env vars.
  AI_CHAT_MEMORY_BACKEND: z.enum(["postgres", "memory"]).optional(),
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
  DEVOTIONAL_SITE_INGEST_URL: z.string().url().optional(),
  DEVOTIONAL_SITE_INGEST_API_KEY: z.string().min(1).optional(),
  DEVOTIONAL_PARTNER_DOMAINS: z.string().min(1).optional(),
  DEVOTIONAL_DEFAULT_VIDEO_ID: z.string().min(1).optional(),
  DEVOTIONAL_MODEL: z.string().min(1).default(DEFAULT_DEVOTIONAL_MODEL),
  DEVOTIONAL_SAFETY_MODEL: z.string().min(1).default(DEFAULT_DEVOTIONAL_MODEL),
  DEVOTIONAL_ARTIFACT_DIR: z.string().min(1).optional(),
  DEVOTIONAL_MUSIC_LIBRARY_DIR: z.string().min(1).optional(),
  // Dedicated devotional content plane. These credentials intentionally do
  // not reuse the generic RAILWAY_S3_* subtitle/artifact tuple.
  DEVOTIONAL_WORKSPACE_S3_ENDPOINT: z.string().url().optional(),
  DEVOTIONAL_WORKSPACE_S3_REGION: z.string().min(1).optional(),
  DEVOTIONAL_WORKSPACE_S3_BUCKET: z.string().min(1).optional(),
  DEVOTIONAL_WORKSPACE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  DEVOTIONAL_WORKSPACE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  DEVOTIONAL_WORKSPACE_PREFIX: z
    .string()
    .min(1)
    .default(DEFAULT_DEVOTIONAL_WORKSPACE_PREFIX),
  DEVOTIONAL_WORKSPACE_LOCAL_DIR: z.string().min(1).optional(),
  // Three direct SQL connections plus one PgVector connection keep the new
  // data plane inside a four-connection service budget.
  DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX: z.coerce
    .number()
    .int()
    .min(2)
    .max(DEFAULT_DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX)
    .default(DEFAULT_DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX),
  // Dedicated heavy-media boundary for video-first devotionals. Optional so
  // unprovisioned environments still boot; the render step fails with a typed
  // config error at runtime instead of running ffmpeg/Chromium in Mastra.
  SHORTS_WORKER_BASE_URL: z.string().url().optional(),
  SHORTS_WORKER_API_KEY: z.string().min(1).optional(),
  AZURE_SPEECH_KEY: z.string().min(1).optional(),
  AZURE_SPEECH_REGION: z.string().min(1).optional(),
  DEVOTIONAL_VOICE: z.string().min(1).default("en-US-AndrewMultilingualNeural"),
  DEVOTIONAL_VOICE_STYLE: z.string().min(1).optional(),
  // ElevenLabs (voiceover + music). Absent key => audio steps skipped, not failed.
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  // Default narration voice — "Voice D" from the audition (deep, emotive male).
  // Override to swap voice (e.g. per language) without code changes.
  ELEVENLABS_VOICE_ID: z.string().min(1).default("HKFOb9iktHA85uKXydRT"),
  ELEVENLABS_TTS_MODEL: z.string().min(1).default("eleven_multilingual_v2"),
  ELEVENLABS_MUSIC_MODEL: z.string().min(1).default("music_v1"),
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
  INSTAGRAM_DISCOVERY_SITE_INGEST_URL: z.string().min(1).optional(),
  INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN: z.string().min(1).optional(),
  DISCOVERY_SOURCES_URL: z.string().min(1).optional(),
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
  // Langfuse prompt retrieval (2026-07-20 prompt-helper plan, U1). Fully
  // optional — unset degrades the helper to the caller-supplied fallback
  // prompt at runtime, never a boot failure. The base URL is gated by
  // `LANGFUSE_ALLOWED_HOSTS` in production (the one Langfuse-driven boot
  // throw — a security control), but no LANGFUSE_* var is ever pushed into the
  // production `missing` list (KTD5).
  LANGFUSE_ALLOWED_HOSTS: z.string().min(1).optional(),
  // No default base URL: Langfuse cloud keys are region-bound, so a hardcoded
  // region default yields confusing 401s. Unset means unconfigured — the same
  // posture as JESUSFILM_RAG_BASE_URL.
  LANGFUSE_BASE_URL: z.string().url().optional(),
  // Unlike the Bearer-token siblings in this file, this key pair feeds HTTP
  // Basic auth (`base64(public:secret)`) — Langfuse's documented auth scheme.
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
  // Default-off gate for Langfuse tracing (feat-321). Unlike the prompt
  // helper (a read), tracing WRITES raw seeker conversation content to
  // Langfuse, so credential presence alone must never turn it on — the
  // key pair was provisioned for prompt reads (feat-296) and already
  // exists in Railway. Only the literal string "true" enables the
  // exporter; unset/"false" keeps today's local-DuckDB-only posture.
  LANGFUSE_TRACING_ENABLED: z.string().optional(),
  // Caller-budget rule (docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md):
  // this single-attempt prompt-fetch timeout must stay strictly inside any
  // future chat-turn budget. The 10_000 cap keeps even the widest override
  // well below the 90 s chatTurn ceiling.
  LANGFUSE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(DEFAULT_LANGFUSE_TIMEOUT_MS),
  // The trace-retention sweep's own single-attempt timeout (feat-336
  // follow-up, 2026-08-11). Deliberately NOT the prompt timeout above: the
  // sweep's caller budget is a daily timer, and the live batch-DELETE was
  // measured at ~3.4 s — over the prompt-tuned default. The 60 s cap bounds
  // an operator typo while staying trivially inside the daily interval.
  LANGFUSE_TRACE_RETENTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(60_000)
    .default(DEFAULT_LANGFUSE_TRACE_RETENTION_TIMEOUT_MS),
  LANGFUSE_USER_AGENT: z.string().min(1).default(DEFAULT_LANGFUSE_USER_AGENT),
  // Byte-cap on the buffered Langfuse prompt response body. `.optional()` with
  // a runtime fallback in `getLangfuseConfig()` — mirrors
  // JESUSFILM_RAG_MAX_RESPONSE_BYTES: stays out of the boot-time `missing`
  // list while the 5 MiB `.max()` ceiling fails LOUD (boot-time parse error)
  // on an over-range operator typo rather than silently widening the cap and
  // defeating the OOM guard this var exists to provide. 5 MiB is 20× the
  // 256 KiB default — ample headroom for a legitimately huge prompt while
  // bounding the shared process.
  LANGFUSE_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(5_242_880)
    .optional(),
  // Optional default for label-based candidate intake and health comparison.
  // Production Seeker traffic never reads this selector: it resolves the
  // exact repository pin in seeker-production-config.ts. The `production`
  // label is an alert-only deployment marker.
  LANGFUSE_PROMPT_DEFAULT_LABEL: z.string().min(1).optional(),
  LANGFUSE_PROMPT_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(3_600_000)
    .default(DEFAULT_LANGFUSE_PROMPT_CACHE_TTL_MS),
  LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(DEFAULT_LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS),
  // Opt-in live smoke gate: only the literal "1" enables it. Any other
  // non-empty value fails loud at parse rather than silently half-enabling.
  LANGFUSE_PROMPT_SMOKE_TEST: z.enum(["1"]).optional(),
  // Same posture for the feat-336 trace-retention smoke (list/delete/requery
  // against the live API on a backdated sentinel — see
  // langfuse-trace-retention.smoke.test.ts).
  LANGFUSE_TRACE_RETENTION_SMOKE_TEST: z.enum(["1"]).optional(),
  // Same posture for the feat-337 erasure smoke, which seeds and erases real
  // rows against a CALLER-SUPPLIED throwaway `DATABASE_URL` (see
  // ai-chat-erasure.smoke.test.ts). Test-only gate, never runtime config.
  AI_CHAT_ERASURE_SMOKE_TEST: z.enum(["1"]).optional(),
  // Same posture for the feat-337 Langfuse READ smoke: a strictly read-only
  // listing suite against the real `forge-mastra` project (GET only, zero
  // delete-quota spend — see ai-chat-erasure.langfuse.smoke.test.ts).
  AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST: z.enum(["1"]).optional(),
  // Same posture for the feat-366 follow-ups live trace smoke
  // (seeker-follow-ups-tracing.smoke.test.ts — local-dev Langfuse pair only).
  SEEKER_FOLLOWUPS_TRACE_SMOKE_TEST: z.enum(["1"]).optional(),
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
  // Default-off gate for the seeker's video capability (feat-327, plan D6):
  // the `searchVideos` + `featureVideo` tools and — through them — the
  // declared-video projection on the `/forge-seeker` terminal result frame.
  // Since feat-330 it gates the TOOLS ONLY: the video-featuring guidance is
  // durable content in the Langfuse-managed `seeker-system` prompt and in
  // SEEKER_SYSTEM_PROMPT_FALLBACK, served in BOTH flag states and phrased
  // tool-conditionally, so unset means the resolved TOOL SET matches the
  // pre-feat-327 agent while the resolved PROMPT does not. Optional + no
  // default. Read via the repo's string-boolean convention (`=== "true"`,
  // matching SEEKER_ROUTE_ENABLED), NOT JS truthiness, so
  // `SEEKER_VIDEO_ENABLED="false"` stays disabled. No new required-at-boot var.
  SEEKER_VIDEO_ENABLED: z.string().optional(),
  // Default-off gate for the seeker's suggested follow-up questions
  // (feat-366, KTD8): post-hoc generation, the `followUps` terminal-frame
  // field, and the metadata persist. Replay of already-stored questions is
  // deliberately NOT gated (KD1 — mirrors the PR #1836 ruling). Optional + no
  // default. Read via the repo's string-boolean convention (`=== "true"`,
  // matching SEEKER_ROUTE_ENABLED), NOT JS truthiness, so
  // `SEEKER_FOLLOWUPS_ENABLED="false"` — and every retired prototype
  // SEEKER_FOLLOWUPS_MODE value ("post"/"tool"/"heuristic") — stays disabled.
  // No new required-at-boot var.
  SEEKER_FOLLOWUPS_ENABLED: z.string().optional(),
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
  SUPPORT_RESEARCH_ENABLED: z.enum(["true", "false"]).default("false"),
  SUPPORT_RESEARCH_PROVIDER_APPROVED: z
    .enum(["true", "false"])
    .default("false"),
  SUPPORT_RESEARCH_MODEL: z
    .string()
    .min(1)
    .default(DEFAULT_SUPPORT_RESEARCH_MODEL),
  SUPPORT_RESEARCH_WATCH_ALLOWED_HOSTS: z.string().min(1).optional(),
  SUPPORT_RESEARCH_MAX_CONVERSATIONS: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000)
    .default(DEFAULT_SUPPORT_RESEARCH_MAX_CONVERSATIONS),
  SUPPORT_RESEARCH_MAX_ACTIONS: z.coerce
    .number()
    .int()
    .positive()
    .max(25)
    .default(DEFAULT_SUPPORT_RESEARCH_MAX_ACTIONS),
  SUPPORT_RESEARCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(DEFAULT_SUPPORT_RESEARCH_TIMEOUT_MS),
  SUPPORT_RESEARCH_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(10_485_760)
    .default(DEFAULT_SUPPORT_RESEARCH_MAX_RESPONSE_BYTES),
  SUPPORT_RESEARCH_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .max(365)
    .default(DEFAULT_SUPPORT_RESEARCH_RETENTION_DAYS),
  HELP_SCOUT_CLIENT_ID: z.string().min(1).optional(),
  HELP_SCOUT_CLIENT_SECRET: z.string().min(1).optional(),
  HELP_SCOUT_MAILBOX_IDS: z.string().min(1).optional(),
  HELP_SCOUT_API_URL: z.string().url().default(DEFAULT_HELP_SCOUT_API_URL),
  HELP_SCOUT_AUTH_URL: z.string().url().default(DEFAULT_HELP_SCOUT_AUTH_URL),
  LINEAR_SUPPORT_RESEARCH_API_KEY: z.string().min(1).optional(),
  LINEAR_SUPPORT_RESEARCH_API_URL: z
    .string()
    .url()
    .default(DEFAULT_LINEAR_API_URL),
  LINEAR_SUPPORT_RESEARCH_TEAM_ID: z.string().min(1).optional(),
  LINEAR_SUPPORT_RESEARCH_PROJECT_ID: z.string().min(1).optional(),
  LINEAR_SUPPORT_RESEARCH_CONFIRMED_BUG_LABEL_ID: z.string().min(1).optional(),
  LINEAR_SUPPORT_RESEARCH_NEEDS_VALIDATION_LABEL_ID: z
    .string()
    .min(1)
    .optional(),
  LINEAR_SUPPORT_RESEARCH_UX_LABEL_ID: z.string().min(1).optional(),
  DATADOG_TRIAGE_ENABLED: z.enum(["true", "false"]).default("false"),
  DATADOG_TRIAGE_SITE: z.string().min(1).default(DEFAULT_DATADOG_TRIAGE_SITE),
  DATADOG_TRIAGE_API_KEY: z.string().min(1).optional(),
  DATADOG_TRIAGE_APP_KEY: z.string().min(1).optional(),
  DATADOG_TRIAGE_SERVICES: z
    .string()
    .min(1)
    .default(DEFAULT_DATADOG_TRIAGE_SERVICES),
  DATADOG_TRIAGE_SERVICE_PROFILES_JSON: z.string().min(2).optional(),
  DATADOG_TRIAGE_MODEL: z.string().min(1).default(DEFAULT_DATADOG_TRIAGE_MODEL),
  DATADOG_TRIAGE_MAX_CANDIDATES_PER_RUN: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000)
    .default(DEFAULT_DATADOG_TRIAGE_MAX_CANDIDATES_PER_RUN),
  DATADOG_TRIAGE_MAX_TICKETS_PER_DAY: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(25)
    .default(DEFAULT_DATADOG_TRIAGE_MAX_TICKETS_PER_DAY),
  DATADOG_TRIAGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(DEFAULT_DATADOG_TRIAGE_TIMEOUT_MS),
  DATADOG_TRIAGE_JUDGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(DEFAULT_DATADOG_TRIAGE_JUDGE_TIMEOUT_MS),
  DATADOG_TRIAGE_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(16_777_216)
    .default(DEFAULT_DATADOG_TRIAGE_MAX_RESPONSE_BYTES),
  DATADOG_TRIAGE_OVERLAP_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(3_600_000)
    .default(DEFAULT_DATADOG_TRIAGE_OVERLAP_MS),
  DATADOG_TRIAGE_LAG_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(3_600_000)
    .default(DEFAULT_DATADOG_TRIAGE_LAG_MS),
  DATADOG_TRIAGE_BASELINE_LOOKBACK_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(2_592_000_000)
    .default(DEFAULT_DATADOG_TRIAGE_BASELINE_LOOKBACK_MS),
  DATADOG_TRIAGE_CONFIDENCE_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(DEFAULT_DATADOG_TRIAGE_CONFIDENCE),
  DATADOG_TRIAGE_ACTIONABILITY_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(DEFAULT_DATADOG_TRIAGE_ACTIONABILITY),
  DATADOG_TRIAGE_MIN_OCCURRENCES: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(DEFAULT_DATADOG_TRIAGE_MIN_OCCURRENCES),
  DATADOG_TRIAGE_REGRESSION_MULTIPLIER: z.coerce
    .number()
    .min(1)
    .max(1_000)
    .default(DEFAULT_DATADOG_TRIAGE_REGRESSION_MULTIPLIER),
  DATADOG_TRIAGE_MONITOR_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(604_800_000)
    .default(DEFAULT_DATADOG_TRIAGE_MONITOR_COOLDOWN_MS),
  DATADOG_TRIAGE_SPIKE_MULTIPLIER: z.coerce
    .number()
    .min(1)
    .max(1_000)
    .default(DEFAULT_DATADOG_TRIAGE_SPIKE_MULTIPLIER),
  DATADOG_TRIAGE_RELEASE_VERSION_PATTERN: z
    .string()
    .min(1)
    .max(500)
    .default(DEFAULT_DATADOG_TRIAGE_RELEASE_VERSION_PATTERN),
  DATADOG_TRIAGE_DEV_SESSION_MARKERS: z
    .string()
    .min(1)
    .default(DEFAULT_DATADOG_TRIAGE_DEV_SESSION_MARKERS),
  DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST: z.literal("1").optional(),
  LINEAR_DATADOG_TRIAGE_API_KEY: z.string().min(1).optional(),
  LINEAR_DATADOG_TRIAGE_API_URL: z
    .string()
    .url()
    .default(DEFAULT_LINEAR_API_URL),
  LINEAR_DATADOG_TRIAGE_TEAM_ID: z.string().min(1).optional(),
  LINEAR_DATADOG_TRIAGE_PROJECT_ID: z.string().min(1).optional(),
  LINEAR_DATADOG_TRIAGE_BUG_LABEL_ID: z.string().min(1).optional(),
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  YOUTUBE_ALLOWED_HOSTS: z
    .string()
    .min(1)
    .default(DEFAULT_YOUTUBE_ALLOWED_HOSTS),
  YOUTUBE_API_BASE_URL: z
    .string()
    .url()
    .default("https://www.googleapis.com/youtube/v3"),
  YOUTUBE_SEARCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(30_000),
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
  ADMIN_SEARCH_EVAL_SERVING_URL: emptyToUndefined(
    process.env.ADMIN_SEARCH_EVAL_SERVING_URL,
  ),
  ADMIN_SEARCH_EVAL_SERVING_API_KEY: emptyToUndefined(
    process.env.ADMIN_SEARCH_EVAL_SERVING_API_KEY,
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
  ADMIN_AGENT_TOOLS_MAX_RESPONSE_BYTES: emptyToUndefined(
    process.env.ADMIN_AGENT_TOOLS_MAX_RESPONSE_BYTES,
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
  AI_GATEWAY_SEEKER_ENABLED: emptyToUndefined(
    process.env.AI_GATEWAY_SEEKER_ENABLED,
  ),
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
  DEVOTIONAL_APPROVAL_API_KEYS: emptyToUndefined(
    process.env.DEVOTIONAL_APPROVAL_API_KEYS,
  ),
  DEVOTIONAL_PLAYBACK_API_KEYS: emptyToUndefined(
    process.env.DEVOTIONAL_PLAYBACK_API_KEYS,
  ),
  DEVOTIONAL_NEW_RUNS_ENABLED: emptyToUndefined(
    process.env.DEVOTIONAL_NEW_RUNS_ENABLED,
  ),
  AI_CHAT_SERVICE_API_KEYS: emptyToUndefined(
    process.env.AI_CHAT_SERVICE_API_KEYS,
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
  AI_CHAT_MEMORY_BACKEND: emptyToUndefined(process.env.AI_CHAT_MEMORY_BACKEND),
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
  DEVOTIONAL_SITE_INGEST_URL: emptyToUndefined(
    process.env.DEVOTIONAL_SITE_INGEST_URL,
  ),
  DEVOTIONAL_SITE_INGEST_API_KEY: emptyToUndefined(
    process.env.DEVOTIONAL_SITE_INGEST_API_KEY,
  ),
  DEVOTIONAL_PARTNER_DOMAINS: emptyToUndefined(
    process.env.DEVOTIONAL_PARTNER_DOMAINS,
  ),
  DEVOTIONAL_DEFAULT_VIDEO_ID: emptyToUndefined(
    process.env.DEVOTIONAL_DEFAULT_VIDEO_ID,
  ),
  DEVOTIONAL_MODEL: emptyToUndefined(process.env.DEVOTIONAL_MODEL),
  DEVOTIONAL_SAFETY_MODEL: emptyToUndefined(
    process.env.DEVOTIONAL_SAFETY_MODEL,
  ),
  DEVOTIONAL_ARTIFACT_DIR: emptyToUndefined(
    process.env.DEVOTIONAL_ARTIFACT_DIR,
  ),
  DEVOTIONAL_MUSIC_LIBRARY_DIR: emptyToUndefined(
    process.env.DEVOTIONAL_MUSIC_LIBRARY_DIR,
  ),
  DEVOTIONAL_WORKSPACE_S3_ENDPOINT: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_S3_ENDPOINT,
  ),
  DEVOTIONAL_WORKSPACE_S3_REGION: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_S3_REGION,
  ),
  DEVOTIONAL_WORKSPACE_S3_BUCKET: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_S3_BUCKET,
  ),
  DEVOTIONAL_WORKSPACE_S3_ACCESS_KEY_ID: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_S3_ACCESS_KEY_ID,
  ),
  DEVOTIONAL_WORKSPACE_S3_SECRET_ACCESS_KEY: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_S3_SECRET_ACCESS_KEY,
  ),
  DEVOTIONAL_WORKSPACE_PREFIX: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_PREFIX,
  ),
  DEVOTIONAL_WORKSPACE_LOCAL_DIR: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_LOCAL_DIR,
  ),
  DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX: emptyToUndefined(
    process.env.DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX,
  ),
  SHORTS_WORKER_BASE_URL: emptyToUndefined(process.env.SHORTS_WORKER_BASE_URL),
  SHORTS_WORKER_API_KEY: emptyToUndefined(process.env.SHORTS_WORKER_API_KEY),
  AZURE_SPEECH_KEY: emptyToUndefined(process.env.AZURE_SPEECH_KEY),
  AZURE_SPEECH_REGION: emptyToUndefined(process.env.AZURE_SPEECH_REGION),
  DEVOTIONAL_VOICE: emptyToUndefined(process.env.DEVOTIONAL_VOICE),
  DEVOTIONAL_VOICE_STYLE: emptyToUndefined(process.env.DEVOTIONAL_VOICE_STYLE),
  ELEVENLABS_API_KEY: emptyToUndefined(process.env.ELEVENLABS_API_KEY),
  ELEVENLABS_VOICE_ID: emptyToUndefined(process.env.ELEVENLABS_VOICE_ID),
  ELEVENLABS_TTS_MODEL: emptyToUndefined(process.env.ELEVENLABS_TTS_MODEL),
  ELEVENLABS_MUSIC_MODEL: emptyToUndefined(process.env.ELEVENLABS_MUSIC_MODEL),
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
  INSTAGRAM_DISCOVERY_SITE_INGEST_URL: emptyToUndefined(
    process.env.INSTAGRAM_DISCOVERY_SITE_INGEST_URL,
  ),
  INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN: emptyToUndefined(
    process.env.INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN,
  ),
  DISCOVERY_SOURCES_URL: emptyToUndefined(process.env.DISCOVERY_SOURCES_URL),
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
  LANGFUSE_ALLOWED_HOSTS: emptyToUndefined(process.env.LANGFUSE_ALLOWED_HOSTS),
  LANGFUSE_BASE_URL: emptyToUndefined(process.env.LANGFUSE_BASE_URL),
  LANGFUSE_PUBLIC_KEY: emptyToUndefined(process.env.LANGFUSE_PUBLIC_KEY),
  LANGFUSE_SECRET_KEY: emptyToUndefined(process.env.LANGFUSE_SECRET_KEY),
  LANGFUSE_TRACING_ENABLED: emptyToUndefined(
    process.env.LANGFUSE_TRACING_ENABLED,
  ),
  LANGFUSE_TIMEOUT_MS: emptyToUndefined(process.env.LANGFUSE_TIMEOUT_MS),
  LANGFUSE_TRACE_RETENTION_TIMEOUT_MS: emptyToUndefined(
    process.env.LANGFUSE_TRACE_RETENTION_TIMEOUT_MS,
  ),
  LANGFUSE_USER_AGENT: emptyToUndefined(process.env.LANGFUSE_USER_AGENT),
  LANGFUSE_MAX_RESPONSE_BYTES: emptyToUndefined(
    process.env.LANGFUSE_MAX_RESPONSE_BYTES,
  ),
  LANGFUSE_PROMPT_DEFAULT_LABEL: emptyToUndefined(
    process.env.LANGFUSE_PROMPT_DEFAULT_LABEL,
  ),
  LANGFUSE_PROMPT_CACHE_TTL_MS: emptyToUndefined(
    process.env.LANGFUSE_PROMPT_CACHE_TTL_MS,
  ),
  LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS: emptyToUndefined(
    process.env.LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS,
  ),
  LANGFUSE_PROMPT_SMOKE_TEST: emptyToUndefined(
    process.env.LANGFUSE_PROMPT_SMOKE_TEST,
  ),
  LANGFUSE_TRACE_RETENTION_SMOKE_TEST: emptyToUndefined(
    process.env.LANGFUSE_TRACE_RETENTION_SMOKE_TEST,
  ),
  AI_CHAT_ERASURE_SMOKE_TEST: emptyToUndefined(
    process.env.AI_CHAT_ERASURE_SMOKE_TEST,
  ),
  AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST: emptyToUndefined(
    process.env.AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST,
  ),
  SEEKER_FOLLOWUPS_TRACE_SMOKE_TEST: emptyToUndefined(
    process.env.SEEKER_FOLLOWUPS_TRACE_SMOKE_TEST,
  ),
  SEARCH_EVAL_JUDGE_MODEL: emptyToUndefined(
    process.env.SEARCH_EVAL_JUDGE_MODEL,
  ),
  SEEKER_ROUTE_ENABLED: emptyToUndefined(process.env.SEEKER_ROUTE_ENABLED),
  SEEKER_VIDEO_ENABLED: emptyToUndefined(process.env.SEEKER_VIDEO_ENABLED),
  SEEKER_FOLLOWUPS_ENABLED: emptyToUndefined(
    process.env.SEEKER_FOLLOWUPS_ENABLED,
  ),
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
  SUPPORT_RESEARCH_ENABLED: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_ENABLED,
  ),
  SUPPORT_RESEARCH_PROVIDER_APPROVED: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_PROVIDER_APPROVED,
  ),
  SUPPORT_RESEARCH_MODEL: emptyToUndefined(process.env.SUPPORT_RESEARCH_MODEL),
  SUPPORT_RESEARCH_WATCH_ALLOWED_HOSTS: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_WATCH_ALLOWED_HOSTS,
  ),
  SUPPORT_RESEARCH_MAX_CONVERSATIONS: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_MAX_CONVERSATIONS,
  ),
  SUPPORT_RESEARCH_MAX_ACTIONS: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_MAX_ACTIONS,
  ),
  SUPPORT_RESEARCH_TIMEOUT_MS: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_TIMEOUT_MS,
  ),
  SUPPORT_RESEARCH_MAX_RESPONSE_BYTES: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_MAX_RESPONSE_BYTES,
  ),
  SUPPORT_RESEARCH_RETENTION_DAYS: emptyToUndefined(
    process.env.SUPPORT_RESEARCH_RETENTION_DAYS,
  ),
  HELP_SCOUT_CLIENT_ID: emptyToUndefined(process.env.HELP_SCOUT_CLIENT_ID),
  HELP_SCOUT_CLIENT_SECRET: emptyToUndefined(
    process.env.HELP_SCOUT_CLIENT_SECRET,
  ),
  HELP_SCOUT_MAILBOX_IDS: emptyToUndefined(process.env.HELP_SCOUT_MAILBOX_IDS),
  HELP_SCOUT_API_URL: emptyToUndefined(process.env.HELP_SCOUT_API_URL),
  HELP_SCOUT_AUTH_URL: emptyToUndefined(process.env.HELP_SCOUT_AUTH_URL),
  LINEAR_SUPPORT_RESEARCH_API_KEY: emptyToUndefined(
    process.env.LINEAR_SUPPORT_RESEARCH_API_KEY,
  ),
  LINEAR_SUPPORT_RESEARCH_API_URL: emptyToUndefined(
    process.env.LINEAR_SUPPORT_RESEARCH_API_URL,
  ),
  LINEAR_SUPPORT_RESEARCH_TEAM_ID: emptyToUndefined(
    process.env.LINEAR_SUPPORT_RESEARCH_TEAM_ID,
  ),
  LINEAR_SUPPORT_RESEARCH_PROJECT_ID: emptyToUndefined(
    process.env.LINEAR_SUPPORT_RESEARCH_PROJECT_ID,
  ),
  LINEAR_SUPPORT_RESEARCH_CONFIRMED_BUG_LABEL_ID: emptyToUndefined(
    process.env.LINEAR_SUPPORT_RESEARCH_CONFIRMED_BUG_LABEL_ID,
  ),
  LINEAR_SUPPORT_RESEARCH_NEEDS_VALIDATION_LABEL_ID: emptyToUndefined(
    process.env.LINEAR_SUPPORT_RESEARCH_NEEDS_VALIDATION_LABEL_ID,
  ),
  LINEAR_SUPPORT_RESEARCH_UX_LABEL_ID: emptyToUndefined(
    process.env.LINEAR_SUPPORT_RESEARCH_UX_LABEL_ID,
  ),
  DATADOG_TRIAGE_ENABLED: emptyToUndefined(process.env.DATADOG_TRIAGE_ENABLED),
  DATADOG_TRIAGE_SITE: emptyToUndefined(process.env.DATADOG_TRIAGE_SITE),
  DATADOG_TRIAGE_API_KEY: emptyToUndefined(process.env.DATADOG_TRIAGE_API_KEY),
  DATADOG_TRIAGE_APP_KEY: emptyToUndefined(process.env.DATADOG_TRIAGE_APP_KEY),
  DATADOG_TRIAGE_SERVICES: emptyToUndefined(
    process.env.DATADOG_TRIAGE_SERVICES,
  ),
  DATADOG_TRIAGE_SERVICE_PROFILES_JSON: emptyToUndefined(
    process.env.DATADOG_TRIAGE_SERVICE_PROFILES_JSON,
  ),
  DATADOG_TRIAGE_MODEL: emptyToUndefined(process.env.DATADOG_TRIAGE_MODEL),
  DATADOG_TRIAGE_MAX_CANDIDATES_PER_RUN: emptyToUndefined(
    process.env.DATADOG_TRIAGE_MAX_CANDIDATES_PER_RUN,
  ),
  DATADOG_TRIAGE_MAX_TICKETS_PER_DAY: emptyToUndefined(
    process.env.DATADOG_TRIAGE_MAX_TICKETS_PER_DAY,
  ),
  DATADOG_TRIAGE_TIMEOUT_MS: emptyToUndefined(
    process.env.DATADOG_TRIAGE_TIMEOUT_MS,
  ),
  DATADOG_TRIAGE_JUDGE_TIMEOUT_MS: emptyToUndefined(
    process.env.DATADOG_TRIAGE_JUDGE_TIMEOUT_MS,
  ),
  DATADOG_TRIAGE_MAX_RESPONSE_BYTES: emptyToUndefined(
    process.env.DATADOG_TRIAGE_MAX_RESPONSE_BYTES,
  ),
  DATADOG_TRIAGE_OVERLAP_MS: emptyToUndefined(
    process.env.DATADOG_TRIAGE_OVERLAP_MS,
  ),
  DATADOG_TRIAGE_LAG_MS: emptyToUndefined(process.env.DATADOG_TRIAGE_LAG_MS),
  DATADOG_TRIAGE_BASELINE_LOOKBACK_MS: emptyToUndefined(
    process.env.DATADOG_TRIAGE_BASELINE_LOOKBACK_MS,
  ),
  DATADOG_TRIAGE_CONFIDENCE_THRESHOLD: emptyToUndefined(
    process.env.DATADOG_TRIAGE_CONFIDENCE_THRESHOLD,
  ),
  DATADOG_TRIAGE_ACTIONABILITY_THRESHOLD: emptyToUndefined(
    process.env.DATADOG_TRIAGE_ACTIONABILITY_THRESHOLD,
  ),
  DATADOG_TRIAGE_MIN_OCCURRENCES: emptyToUndefined(
    process.env.DATADOG_TRIAGE_MIN_OCCURRENCES,
  ),
  DATADOG_TRIAGE_REGRESSION_MULTIPLIER: emptyToUndefined(
    process.env.DATADOG_TRIAGE_REGRESSION_MULTIPLIER,
  ),
  DATADOG_TRIAGE_MONITOR_COOLDOWN_MS: emptyToUndefined(
    process.env.DATADOG_TRIAGE_MONITOR_COOLDOWN_MS,
  ),
  DATADOG_TRIAGE_SPIKE_MULTIPLIER: emptyToUndefined(
    process.env.DATADOG_TRIAGE_SPIKE_MULTIPLIER,
  ),
  DATADOG_TRIAGE_RELEASE_VERSION_PATTERN: emptyToUndefined(
    process.env.DATADOG_TRIAGE_RELEASE_VERSION_PATTERN,
  ),
  DATADOG_TRIAGE_DEV_SESSION_MARKERS: emptyToUndefined(
    process.env.DATADOG_TRIAGE_DEV_SESSION_MARKERS,
  ),
  DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST: emptyToUndefined(
    process.env.DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST,
  ),
  LINEAR_DATADOG_TRIAGE_API_KEY: emptyToUndefined(
    process.env.LINEAR_DATADOG_TRIAGE_API_KEY,
  ),
  LINEAR_DATADOG_TRIAGE_API_URL: emptyToUndefined(
    process.env.LINEAR_DATADOG_TRIAGE_API_URL,
  ),
  LINEAR_DATADOG_TRIAGE_TEAM_ID: emptyToUndefined(
    process.env.LINEAR_DATADOG_TRIAGE_TEAM_ID,
  ),
  LINEAR_DATADOG_TRIAGE_PROJECT_ID: emptyToUndefined(
    process.env.LINEAR_DATADOG_TRIAGE_PROJECT_ID,
  ),
  LINEAR_DATADOG_TRIAGE_BUG_LABEL_ID: emptyToUndefined(
    process.env.LINEAR_DATADOG_TRIAGE_BUG_LABEL_ID,
  ),
  YOUTUBE_API_KEY: emptyToUndefined(process.env.YOUTUBE_API_KEY),
  YOUTUBE_ALLOWED_HOSTS: emptyToUndefined(process.env.YOUTUBE_ALLOWED_HOSTS),
  YOUTUBE_API_BASE_URL: emptyToUndefined(process.env.YOUTUBE_API_BASE_URL),
  YOUTUBE_SEARCH_TIMEOUT_MS: emptyToUndefined(
    process.env.YOUTUBE_SEARCH_TIMEOUT_MS,
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

function assertYouTubeBaseUrlAllowedForProduction() {
  const baseUrl = new URL(env.YOUTUBE_API_BASE_URL)
  const allowedHosts = csvSet(env.YOUTUBE_ALLOWED_HOSTS)
  if (baseUrl.protocol !== "https:" || !allowedHosts.has(baseUrl.hostname)) {
    throw new Error(
      "YOUTUBE_API_BASE_URL must use https and a host listed in YOUTUBE_ALLOWED_HOSTS for Mastra production",
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

function assertAdminAgentToolsBaseUrlAllowedForProduction() {
  // feat-327. Conditional on the base URL being set: an unprovisioned
  // agent-tools pair is valid by design (every tool degrades to an empty
  // result at runtime, never a boot failure). When the URL IS set, fail-closed
  // — https AND a non-empty allowlist containing the hostname, else throw.
  //
  // Why the enforcement point moved here NOW (repo law: the fail-closed
  // enforcement point follows ROLLBACK CAPABILITY, not severity): this pair is
  // a credentialed egress that feat-327 puts on a user-facing conversational
  // path for the first time. The rollout runbook already sets
  // ADMIN_AGENT_TOOLS_ALLOWED_HOSTS in the same step it sets the URL and key,
  // so no planned deploy path acquires a new prerequisite — an env that has
  // the URL without the allowlist was already misconfigured, it just failed
  // silently.
  //
  // ROLLBACK CAPABILITY — the premise, stated as a premise. This assert runs at
  // module load, BEFORE the server is constructed, so a throw means the port
  // never opens; `apps/mastra/railway.toml` declares
  // `healthcheckPath = "/health"`, which would turn that into a REFUSED
  // PROMOTION (old deployment keeps serving) rather than an outage. But that
  // toml's own header says Railway reads it only when the service's
  // Config-as-code Path points at it — otherwise the dashboard is canonical and
  // this file is inert. Nothing in this repo can observe which is true, and the
  // repo has a recorded instance of dashboard config shadowing a railway.toml
  // (docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md).
  // So: OPERATOR PRECONDITION, not a code guarantee — before this ships,
  // confirm the mastra service actually has a healthcheck path configured, and
  // that ADMIN_AGENT_TOOLS_URL is either unset in production or already paired
  // with a matching allowlist. The three sibling guards below/above carry the
  // same unstated dependency; this one names it because it is new.
  //
  // BLAST RADIUS, stated: this also covers the experience-authoring agents,
  // which share the same pair. That tightening is intended.
  if (!env.ADMIN_AGENT_TOOLS_URL) return
  const baseUrl = new URL(env.ADMIN_AGENT_TOOLS_URL)
  const allowedHosts = env.ADMIN_AGENT_TOOLS_ALLOWED_HOSTS
    ? csvSet(env.ADMIN_AGENT_TOOLS_ALLOWED_HOSTS)
    : new Set<string>()
  if (baseUrl.protocol !== "https:" || !allowedHosts.has(baseUrl.hostname)) {
    throw new Error(
      "ADMIN_AGENT_TOOLS_URL must use https and a host listed in ADMIN_AGENT_TOOLS_ALLOWED_HOSTS for Mastra production",
    )
  }
}

function assertLangfuseBaseUrlAllowedForProduction() {
  // Conditional on the base URL being set: unconfigured Langfuse is valid by
  // design (the prompt helper degrades to the caller-supplied fallback). When
  // the URL IS set, fail-closed — https AND a non-empty allowlist containing
  // the hostname, else throw. The allowlist has no default (Langfuse cloud is
  // region-bound and self-hosting is supported, so no single host is
  // canonical), so a base-URL-set-but-allowlist-unset production config throws
  // here. Mirrors `assertJesusfilmRagBaseUrlAllowedForProduction`.
  if (!env.LANGFUSE_BASE_URL) return
  const baseUrl = new URL(env.LANGFUSE_BASE_URL)
  const allowedHosts = env.LANGFUSE_ALLOWED_HOSTS
    ? csvSet(env.LANGFUSE_ALLOWED_HOSTS)
    : new Set<string>()
  if (baseUrl.protocol !== "https:" || !allowedHosts.has(baseUrl.hostname)) {
    throw new Error(
      "LANGFUSE_BASE_URL must use https and a host listed in LANGFUSE_ALLOWED_HOSTS for Mastra production",
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

/**
 * Boot-time disjointness assertion between the shared service-bearer pool and
 * the ai-chat lane bearer CSV (feat-241, KTD2; admin's assertBearerCsvsDisjoint
 * precedent). A key value present in both CSVs would silently grant every pool
 * holder bulk conversation-read access — refuse to boot instead. Runs in every
 * environment via assertMastraRuntimeEnv(); parameters are injectable so tests
 * exercise the overlap branch without mutating the parsed env.
 */
export function assertAiChatServiceKeysDisjoint(
  poolCsv: string | undefined = env.MASTRA_SERVICE_API_KEYS,
  laneCsv: string | undefined = env.AI_CHAT_SERVICE_API_KEYS,
): void {
  const pool = new Set(parseServiceApiKeys(poolCsv))
  if (parseServiceApiKeys(laneCsv).some((key) => pool.has(key))) {
    // Names only — never the overlapping key value.
    throw new Error(
      "AI_CHAT_SERVICE_API_KEYS and MASTRA_SERVICE_API_KEYS must not share key values",
    )
  }
}

export function assertDevotionalApprovalKeysDisjoint(
  poolCsv: string | undefined = env.MASTRA_SERVICE_API_KEYS,
  approvalCsv: string | undefined = env.DEVOTIONAL_APPROVAL_API_KEYS,
  playbackCsv: string | undefined = env.DEVOTIONAL_PLAYBACK_API_KEYS,
): void {
  const pool = new Set(parseServiceApiKeys(poolCsv))
  const approval = new Set(parseServiceApiKeys(approvalCsv))
  const playback = new Set(parseServiceApiKeys(playbackCsv))
  if ([...approval].some((key) => pool.has(key))) {
    throw new Error(
      "DEVOTIONAL_APPROVAL_API_KEYS and MASTRA_SERVICE_API_KEYS must not share key values",
    )
  }
  if ([...playback].some((key) => pool.has(key) || approval.has(key))) {
    throw new Error(
      "DEVOTIONAL_PLAYBACK_API_KEYS must not share key values with DEVOTIONAL_APPROVAL_API_KEYS or MASTRA_SERVICE_API_KEYS",
    )
  }
}

export function assertMastraRuntimeEnv() {
  // Every-environment invariant (feat-241, KTD2): an overlapping pool/lane
  // bearer is a misconfiguration everywhere, not just in production.
  assertAiChatServiceKeysDisjoint()
  assertDevotionalApprovalKeysDisjoint()

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
  if (env.YOUTUBE_API_KEY) assertYouTubeBaseUrlAllowedForProduction()
  // The only RAG-driven boot throw (a security control). A missing
  // JESUSFILM_RAG_API_KEY is deliberately NOT in `missing` above — a key-absent
  // state degrades at runtime via the client's `config_missing` short-circuit,
  // honoring the ticket's "never a boot failure" rule.
  assertJesusfilmRagBaseUrlAllowedForProduction()
  assertAdminAgentToolsBaseUrlAllowedForProduction()
  // Same posture for Langfuse (U1, R9): the host guard is the only
  // Langfuse-driven boot throw. Missing keys are deliberately NOT in `missing`
  // above — an unconfigured helper degrades to the caller-supplied fallback
  // prompt at runtime (R8).
  assertLangfuseBaseUrlAllowedForProduction()

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

export type YouTubeConfig = {
  apiKey?: string
  baseUrl: string
  timeoutMs: number
}

export function getYouTubeConfig(): YouTubeConfig {
  return {
    apiKey: env.YOUTUBE_API_KEY,
    baseUrl: env.YOUTUBE_API_BASE_URL,
    timeoutMs: env.YOUTUBE_SEARCH_TIMEOUT_MS,
  }
}

export type SupportResearchConfig = {
  enabled: boolean
  providerApproved: boolean
  model: string
  databaseUrl: string
  allowedWatchHosts: string[]
  maxConversations: number
  maxThreadsPerConversation: number
  maxSanitizedCharacters: number
  maxActionsPerRun: number
  maxConsecutiveAnalysisFailures: number
  timeoutMs: number
  maxResponseBytes: number
  retentionDays: number
  confirmedConfidence: number
  inferredConfidence: number
  improvementActionability: number
  improvementDistinctSources: number
  improvementWindowDays: number
  helpScout: {
    clientId?: string
    clientSecret?: string
    mailboxIds: string[]
    apiUrl: string
    authUrl: string
  }
  linear: {
    apiKey?: string
    apiUrl: string
    teamId?: string
    projectId?: string
    confirmedBugLabelId?: string
    needsValidationLabelId?: string
    uxLabelId?: string
  }
}

function csvValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Optional daily Help Scout research integration. Completeness and host safety
 * are evaluated at workflow runtime so an unprovisioned environment still
 * boots and exposes a typed disabled result in Studio.
 */
export function getSupportResearchConfig(): SupportResearchConfig {
  return {
    enabled: env.SUPPORT_RESEARCH_ENABLED === "true",
    providerApproved: env.SUPPORT_RESEARCH_PROVIDER_APPROVED === "true",
    model: env.SUPPORT_RESEARCH_MODEL,
    databaseUrl: getMastraDatabaseUrl(),
    allowedWatchHosts: csvValues(env.SUPPORT_RESEARCH_WATCH_ALLOWED_HOSTS).map(
      (host) => host.toLowerCase(),
    ),
    maxConversations: env.SUPPORT_RESEARCH_MAX_CONVERSATIONS,
    maxThreadsPerConversation: 20,
    maxSanitizedCharacters: 12_000,
    maxActionsPerRun: env.SUPPORT_RESEARCH_MAX_ACTIONS,
    maxConsecutiveAnalysisFailures: 5,
    timeoutMs: env.SUPPORT_RESEARCH_TIMEOUT_MS,
    maxResponseBytes: env.SUPPORT_RESEARCH_MAX_RESPONSE_BYTES,
    retentionDays: env.SUPPORT_RESEARCH_RETENTION_DAYS,
    confirmedConfidence: 0.85,
    inferredConfidence: 0.85,
    improvementActionability: 0.8,
    improvementDistinctSources: 3,
    improvementWindowDays: 30,
    helpScout: {
      clientId: env.HELP_SCOUT_CLIENT_ID,
      clientSecret: env.HELP_SCOUT_CLIENT_SECRET,
      mailboxIds: csvValues(env.HELP_SCOUT_MAILBOX_IDS),
      apiUrl: env.HELP_SCOUT_API_URL,
      authUrl: env.HELP_SCOUT_AUTH_URL,
    },
    linear: {
      apiKey: env.LINEAR_SUPPORT_RESEARCH_API_KEY,
      apiUrl: env.LINEAR_SUPPORT_RESEARCH_API_URL,
      teamId: env.LINEAR_SUPPORT_RESEARCH_TEAM_ID,
      projectId: env.LINEAR_SUPPORT_RESEARCH_PROJECT_ID,
      confirmedBugLabelId: env.LINEAR_SUPPORT_RESEARCH_CONFIRMED_BUG_LABEL_ID,
      needsValidationLabelId:
        env.LINEAR_SUPPORT_RESEARCH_NEEDS_VALIDATION_LABEL_ID,
      uxLabelId: env.LINEAR_SUPPORT_RESEARCH_UX_LABEL_ID,
    },
  }
}

/**
 * Datadog API sites this integration will talk to. The client re-checks the
 * resolved host against this list before any credential leaves the process
 * (KTD5), so an operator typo cannot send the app key to an unrelated host.
 */
export const DATADOG_TRIAGE_ALLOWED_SITES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "datadoghq.eu",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
  "ddog-gov.com",
] as const

export function datadogApiBaseUrl(site: string): string {
  return `https://api.${site}`
}

export function datadogAppBaseUrl(site: string): string {
  return `https://app.${site}`
}

export type DatadogTriageServiceProfile = {
  /** Bracketed surface prefix on the Linear title, e.g. `[Mobile]` (R9). */
  surfacePrefix: string
  /** Whether R17's release-session filter applies to this service (KTD9). */
  releaseSessionFilter: boolean
  /** Which aggregate answers the spike check for this service. */
  spikeSource: "rum" | "logs"
}

export type DatadogTriageConfig = {
  enabled: boolean
  model: string
  databaseUrl: string
  site: string
  apiKey?: string
  applicationKey?: string
  services: string[]
  serviceProfiles: Record<string, DatadogTriageServiceProfile>
  /** True when SERVICE_PROFILES_JSON was set but unusable; readiness refuses. */
  serviceProfilesInvalid: boolean
  /**
   * Whether the credential the configured model's provider reads is present.
   * Resolved here rather than inside readiness so readiness stays a pure
   * function of this config — the workflow injects one in tests.
   */
  modelApiKeyPresent: boolean
  maxCandidatesPerRun: number
  maxTicketsPerDay: number
  timeoutMs: number
  /** Separate from timeoutMs: the judge is an LLM call, not an HTTP GET. */
  judgeTimeoutMs: number
  maxResponseBytes: number
  overlapMs: number
  ingestionLagMs: number
  baselineLookbackMs: number
  confidenceThreshold: number
  actionabilityThreshold: number
  minOccurrences: number
  regressionMultiplier: number
  monitorCooldownMs: number
  spikeMultiplier: number
  releaseVersionPattern: string
  devSessionMarkers: string[]
  linear: {
    apiKey?: string
    apiUrl: string
    teamId?: string
    projectId?: string
    bugLabelId?: string
  }
}

const DEFAULT_DATADOG_TRIAGE_SERVICE_PROFILES: Record<
  string,
  DatadogTriageServiceProfile
> = {
  "forge-mobile": {
    surfacePrefix: "[Mobile]",
    releaseSessionFilter: true,
    spikeSource: "rum",
  },
}

const datadogTriageServiceProfileSchema = z.object({
  surfacePrefix: z
    .string()
    .min(1)
    .max(40)
    .regex(/^\[[^\][]{1,38}\]$/u),
  releaseSessionFilter: z.boolean(),
  spikeSource: z.enum(["rum", "logs"]).default("logs"),
})

/**
 * Per-service surface prefix + filter applicability (KTD9). Returns
 * `undefined` — never a silent default — when a SET value cannot be used, so
 * readiness refuses the run rather than filing tickets under a wrong prefix.
 */
function parseDatadogTriageServiceProfiles(
  raw: string | undefined,
): Record<string, DatadogTriageServiceProfile> | undefined {
  if (raw === undefined) return DEFAULT_DATADOG_TRIAGE_SERVICE_PROFILES
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const result = z
    .record(z.string().min(1), datadogTriageServiceProfileSchema)
    .safeParse(parsed)
  return result.success ? result.data : undefined
}

/**
 * Optional hourly Datadog mobile triage integration. Every field is optional at
 * schema level so an unprovisioned environment still boots; completeness is a
 * runtime readiness decision (`getDatadogTriageReadiness`).
 */
export function getDatadogTriageConfig(): DatadogTriageConfig {
  const serviceProfiles = parseDatadogTriageServiceProfiles(
    env.DATADOG_TRIAGE_SERVICE_PROFILES_JSON,
  )
  return {
    enabled: env.DATADOG_TRIAGE_ENABLED === "true",
    model: env.DATADOG_TRIAGE_MODEL,
    databaseUrl: getMastraDatabaseUrl(),
    site: env.DATADOG_TRIAGE_SITE.trim().toLowerCase(),
    apiKey: env.DATADOG_TRIAGE_API_KEY,
    applicationKey: env.DATADOG_TRIAGE_APP_KEY,
    // Deduplicated: a repeated name makes the sweep push two cursor rows with
    // the same source, and `on conflict (source) do update` then raises
    // 21000 — so one typo fails every run rather than degrading.
    services: [...new Set(csvValues(env.DATADOG_TRIAGE_SERVICES))],
    serviceProfiles: serviceProfiles ?? DEFAULT_DATADOG_TRIAGE_SERVICE_PROFILES,
    serviceProfilesInvalid: serviceProfiles === undefined,
    modelApiKeyPresent: modelCredentialPresent(env.DATADOG_TRIAGE_MODEL),
    maxCandidatesPerRun: env.DATADOG_TRIAGE_MAX_CANDIDATES_PER_RUN,
    maxTicketsPerDay: env.DATADOG_TRIAGE_MAX_TICKETS_PER_DAY,
    timeoutMs: env.DATADOG_TRIAGE_TIMEOUT_MS,
    judgeTimeoutMs: env.DATADOG_TRIAGE_JUDGE_TIMEOUT_MS,
    maxResponseBytes: env.DATADOG_TRIAGE_MAX_RESPONSE_BYTES,
    overlapMs: env.DATADOG_TRIAGE_OVERLAP_MS,
    ingestionLagMs: env.DATADOG_TRIAGE_LAG_MS,
    baselineLookbackMs: env.DATADOG_TRIAGE_BASELINE_LOOKBACK_MS,
    confidenceThreshold: env.DATADOG_TRIAGE_CONFIDENCE_THRESHOLD,
    actionabilityThreshold: env.DATADOG_TRIAGE_ACTIONABILITY_THRESHOLD,
    minOccurrences: env.DATADOG_TRIAGE_MIN_OCCURRENCES,
    regressionMultiplier: env.DATADOG_TRIAGE_REGRESSION_MULTIPLIER,
    monitorCooldownMs: env.DATADOG_TRIAGE_MONITOR_COOLDOWN_MS,
    spikeMultiplier: env.DATADOG_TRIAGE_SPIKE_MULTIPLIER,
    releaseVersionPattern: env.DATADOG_TRIAGE_RELEASE_VERSION_PATTERN,
    devSessionMarkers: csvValues(env.DATADOG_TRIAGE_DEV_SESSION_MARKERS).map(
      (marker) => marker.toLowerCase(),
    ),
    linear: {
      apiKey: env.LINEAR_DATADOG_TRIAGE_API_KEY,
      apiUrl: env.LINEAR_DATADOG_TRIAGE_API_URL,
      teamId: env.LINEAR_DATADOG_TRIAGE_TEAM_ID,
      projectId: env.LINEAR_DATADOG_TRIAGE_PROJECT_ID,
      bugLabelId: env.LINEAR_DATADOG_TRIAGE_BUG_LABEL_ID,
    },
  }
}

export function getDatadogTriageServiceProfile(
  config: Pick<DatadogTriageConfig, "serviceProfiles">,
  service: string,
): DatadogTriageServiceProfile {
  return (
    config.serviceProfiles[service] ?? {
      surfacePrefix: "[Service]",
      releaseSessionFilter: false,
      spikeSource: "logs",
    }
  )
}

export type DatadogTriageReadiness =
  | { ready: true }
  | { ready: false; reasons: string[] }

/** Also bounded to 120 chars, matching the service column every row carries. */
const SERVICE_NAME = /^[a-z0-9][a-z0-9._-]{0,119}$/u

/**
 * Shared by readiness and the client's endpoint guard. One predicate, so the
 * two cannot drift into a state where readiness passes while every request
 * refuses with `invalid_config`.
 */
export function isLinearGraphqlUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.hostname === "api.linear.app" &&
      url.pathname === "/graphql" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

/**
 * Runtime completeness gate for the triage workflow. Every reason is a fixed
 * enum string safe to log; no credential or operator value is echoed.
 */
/**
 * Whether the credential the configured model's provider reads is present.
 *
 * Returns true for a provider this cannot classify: refusing on an unknown
 * prefix would block a legitimate custom route. That is the honest limit —
 * the check covers the two providers this runtime actually defaults to.
 */
function modelCredentialPresent(model: string): boolean {
  const provider = model.split("/")[0]?.toLowerCase()
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY)
  if (provider === "openrouter") return Boolean(getOpenRouterApiKey())
  return true
}

export function getDatadogTriageReadiness(
  config: DatadogTriageConfig,
): DatadogTriageReadiness {
  const reasons: string[] = []
  if (!config.enabled) reasons.push("feature_disabled")
  // Without this the sweep passes readiness, spends Datadog quota every hour,
  // fails EVERY judgment, and files nothing — while the runbook's liveness
  // query stays green, because the fetch half succeeded.
  if (!config.modelApiKeyPresent) reasons.push("model_api_key_missing")
  if (!config.apiKey) reasons.push("datadog_api_key_missing")
  if (!config.applicationKey) reasons.push("datadog_app_key_missing")
  if (
    !(DATADOG_TRIAGE_ALLOWED_SITES as readonly string[]).includes(config.site)
  ) {
    reasons.push("datadog_site_not_allowed")
  }
  if (config.services.length === 0) reasons.push("services_missing")
  // Each name is interpolated into a Datadog query and a monitor tag filter, so
  // a value carrying a wildcard or a space would widen the monitor read past
  // the one service KTD6 scopes it to.
  else if (!config.services.every((service) => SERVICE_NAME.test(service))) {
    reasons.push("service_name_invalid")
  }
  if (config.serviceProfilesInvalid) reasons.push("service_profiles_invalid")
  try {
    new RegExp(config.releaseVersionPattern, "u")
  } catch {
    reasons.push("release_version_pattern_invalid")
  }
  if (!config.linear.apiKey) reasons.push("linear_api_key_missing")
  if (!config.linear.teamId) reasons.push("linear_team_id_missing")
  if (!config.linear.projectId) reasons.push("linear_project_id_missing")
  if (!config.linear.bugLabelId) reasons.push("linear_bug_label_missing")
  if (!isLinearGraphqlUrl(config.linear.apiUrl)) {
    reasons.push("linear_url_not_allowed")
  }
  return reasons.length === 0 ? { ready: true } : { ready: false, reasons }
}

/**
 * Site review-queue ingest config for all discovery platforms. The same website
 * endpoint and token serve Instagram, YouTube, and Pinterest submissions, so the
 * existing INSTAGRAM_DISCOVERY_SITE_INGEST_* vars are reused as the shared source.
 */
export function getDiscoverySiteIngestConfig(): InstagramSiteIngestConfig | null {
  return getInstagramSiteIngestConfig()
}

/**
 * Config for reading the website's saved trusted-source list. Opt-in: returns
 * null unless DISCOVERY_SOURCES_URL and the shared site-ingest token are both
 * set (same website, same bearer), so no new secret is needed.
 */
export function getDiscoverySourcesConfig(): InstagramSiteIngestConfig | null {
  const url = env.DISCOVERY_SOURCES_URL
  const token = env.INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN
  if (!url || !token) return null
  return { url, token }
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

export type DevotionalWorkspaceEnvironment = {
  nodeEnv: "development" | "test" | "production"
  localDirectory: string
  prefix: string
  databaseUrl: string
  databasePoolMax: number
  s3: {
    endpoint?: string
    region?: string
    bucket?: string
    accessKeyId?: string
    secretAccessKey?: string
  }
  embedding: ContentEmbeddingProviderConfig
}

/**
 * Raw infrastructure inputs for the devotional Workspace. Completeness and
 * readiness are evaluated by the Workspace config module so a broken optional
 * tuple cannot crash unrelated Mastra routes during process startup.
 */
export function getDevotionalWorkspaceEnvironment(): DevotionalWorkspaceEnvironment {
  return {
    nodeEnv: env.NODE_ENV,
    localDirectory:
      env.DEVOTIONAL_WORKSPACE_LOCAL_DIR ??
      `${getMastraStorageDir()}/devotional-workspace`,
    prefix: env.DEVOTIONAL_WORKSPACE_PREFIX,
    databaseUrl: getMastraDatabaseUrl(),
    databasePoolMax: env.DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX,
    s3: {
      endpoint: env.DEVOTIONAL_WORKSPACE_S3_ENDPOINT,
      region: env.DEVOTIONAL_WORKSPACE_S3_REGION,
      bucket: env.DEVOTIONAL_WORKSPACE_S3_BUCKET,
      accessKeyId: env.DEVOTIONAL_WORKSPACE_S3_ACCESS_KEY_ID,
      secretAccessKey: env.DEVOTIONAL_WORKSPACE_S3_SECRET_ACCESS_KEY,
    },
    embedding: getContentEmbeddingProviderConfig(
      env.EXPERIENCE_EMBEDDING_MODEL,
      env.EXPERIENCE_EMBEDDING_PROVIDER,
    ),
  }
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

/**
 * Whether the seeker's video capability is armed (feat-327, plan D6). Since
 * feat-330 this gates the `searchVideos` + `featureVideo` tools on
 * `seekerAgent` and NOTHING ELSE — the video-featuring guidance moved into the
 * durable prompt (Langfuse-managed `seeker-system` + the compiled-in fallback),
 * so flipping this off removes the tools while the tool-conditional guidance is
 * still served. That is deliberate: it makes this flag a clean rollout/rollback
 * lever whose flip cannot change what `/api/agents*` serves. Default-off: the
 * capability stays inert unless this is explicitly set to the string `"true"`.
 * Uses the repo's string-boolean convention (matching `SEEKER_ROUTE_ENABLED`),
 * NOT JS truthiness — `"false"` (or any other value) keeps the tools off.
 *
 * The `/forge-seeker` route deliberately does NOT read this flag: with the
 * tools unregistered there are no `searchVideos`/`featureVideo` tool results
 * to resolve, so the declared-video projection is inert by construction rather
 * than by a second gate that could drift from this one.
 */
export function isSeekerVideoEnabled(): boolean {
  return env.SEEKER_VIDEO_ENABLED === "true"
}

/**
 * Whether the seeker generates suggested follow-up questions (feat-366,
 * KTD8). Gates the WRITE side only: post-hoc generation, the optional
 * `followUps` field on the `/forge-seeker` terminal `result` frame, and the
 * metadata persist. The replay read path deliberately reads no flag (KD1 —
 * mirrors the settled PR #1836 `SEEKER_VIDEO_ENABLED` ruling): flipping this
 * off stops NEW chips; already-stored questions keep replaying on reopened
 * threads. Retraction levers, in order: this flag off → `SEEKER_ROUTE_ENABLED`
 * off (darkens the whole lane) → thread purge. Default-off: uses the repo's
 * string-boolean convention (matching `SEEKER_ROUTE_ENABLED`), NOT JS
 * truthiness — `"false"` (or any other value, including the retired prototype
 * mode literals) keeps generation off.
 */
export function isSeekerFollowUpsEnabled(): boolean {
  return env.SEEKER_FOLLOWUPS_ENABLED === "true"
}

/**
 * Whether the seeker agent prepends the JesusFilm gateway chat model to its
 * fallback chain (feat-237). Default-off: the seeker stays on today's
 * free-Gemma OpenRouter chain unless this is explicitly set to the string
 * `"true"`. Uses the repo's string-boolean convention (matching
 * `SEEKER_ROUTE_ENABLED`), NOT JS truthiness — `"false"` (or any other value)
 * keeps the gateway model out of the chain, preserving the safety default.
 * The flag alone is not sufficient — the model-list gate also requires
 * `AI_GATEWAY_CHAT_API_KEY` (shared with the experience opt-in) to be set.
 */
export function isAiGatewaySeekerEnabled(): boolean {
  return env.AI_GATEWAY_SEEKER_ENABLED === "true"
}

/**
 * Whether seeker traces are exported to Langfuse (feat-321). Default-off:
 * tracing writes RAW conversation content off the box, so it must be an
 * explicit operator decision — the Langfuse key pair already present for
 * prompt reads (feat-296) must never enable it by itself. Uses the repo's
 * string-boolean convention (matching `SEEKER_ROUTE_ENABLED`), NOT JS
 * truthiness — `"false"` (or any other value) keeps tracing off.
 */
export function isLangfuseTracingEnabled(): boolean {
  return env.LANGFUSE_TRACING_ENABLED === "true"
}

/**
 * Backend for the ai-chat lane's Memory (feat-208): the per-surface override
 * when set, else the runtime storage backend. `memory` is the local/test path;
 * `postgres` (the production default) persists to the `ai_chat` schema. Unlike
 * MASTRA_STORAGE_BACKEND, `memory` here is allowed in production — it is the
 * documented kill-switch to revert seeker persistence without a code deploy.
 */
export function resolveAiChatMemoryBackend(): "postgres" | "memory" {
  return env.AI_CHAT_MEMORY_BACKEND ?? env.MASTRA_STORAGE_BACKEND
}

/**
 * Whether persisted ai-chat rows can exist in Postgres: true when EITHER the
 * runtime storage backend or the ai-chat override is postgres. Gates the
 * retention purge — deliberately NOT `resolveAiChatMemoryBackend()`: the
 * kill-switch (`AI_CHAT_MEMORY_BACKEND=memory`) reverts WRITES only and must
 * never pause retention on conversations already stored in `ai_chat`.
 */
export function canAiChatDataPersist(): boolean {
  return (
    env.MASTRA_STORAGE_BACKEND === "postgres" ||
    env.AI_CHAT_MEMORY_BACKEND === "postgres"
  )
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

export type DevotionalSiteIngestConfig = {
  url?: string
  apiKey?: string
}

/** Watch-site "Today's Devotional" ingest target. Both absent => publish skipped. */
export function getDevotionalSiteIngestConfig(): DevotionalSiteIngestConfig {
  return {
    url: env.DEVOTIONAL_SITE_INGEST_URL,
    apiKey: env.DEVOTIONAL_SITE_INGEST_API_KEY,
  }
}

/** Trimmed, lower-cased partner-domain allowlist for grounding. Empty when unset. */
export function getDevotionalPartnerDomains(): string[] {
  return (env.DEVOTIONAL_PARTNER_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

export type DevotionalVideoSearchConfig = {
  url?: string
  bearer?: string
  defaultVideoId?: string
}

export type ServingSearchEvalConfig = {
  url?: string
  bearer?: string
}

/** Dedicated fixed-Serving target; never falls back to shared eval credentials. */
export function getServingSearchEvalConfig(): ServingSearchEvalConfig {
  return {
    url: env.ADMIN_SEARCH_EVAL_SERVING_URL,
    bearer: env.ADMIN_SEARCH_EVAL_SERVING_API_KEY,
  }
}

/**
 * Video matching reuses the Admin search-eval HTTP contract (A2). The optional
 * default clip id backs the always-a-clip fallback (A8).
 */
export function getDevotionalVideoSearchConfig(): DevotionalVideoSearchConfig {
  return {
    url: env.ADMIN_SEARCH_EVAL_SEARCH_URL,
    bearer: env.ADMIN_SEARCH_EVAL_API_KEY,
    defaultVideoId: env.DEVOTIONAL_DEFAULT_VIDEO_ID,
  }
}

export function getDevotionalModel(): string {
  return env.DEVOTIONAL_MODEL
}

export function getDevotionalSafetyModel(): string {
  return env.DEVOTIONAL_SAFETY_MODEL
}

export type AzureSpeechConfig = {
  key?: string
  region?: string
}

/** Azure Cognitive Services Speech (TTS). Both absent => voiceover skipped. */
export function getAzureSpeechConfig(): AzureSpeechConfig {
  return { key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION }
}

export function getDevotionalVoice(): string {
  return env.DEVOTIONAL_VOICE
}

export function getDevotionalVoiceStyle(): string | undefined {
  return env.DEVOTIONAL_VOICE_STYLE
}

export type ElevenLabsConfig = {
  apiKey?: string
  ttsModel: string
  musicModel: string
}

/** ElevenLabs (voiceover + music). No apiKey => callers treat audio as skipped. */
export function getElevenLabsConfig(): ElevenLabsConfig {
  return {
    apiKey: env.ELEVENLABS_API_KEY,
    ttsModel: env.ELEVENLABS_TTS_MODEL,
    musicModel: env.ELEVENLABS_MUSIC_MODEL,
  }
}

/** Default narration voice id (overridable per language later). */
export function getDevotionalElevenVoiceId(): string {
  return env.ELEVENLABS_VOICE_ID
}

export function getInstagramSiteIngestConfig(): InstagramSiteIngestConfig | null {
  const url = env.INSTAGRAM_DISCOVERY_SITE_INGEST_URL
  const token = env.INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN
  if (!url || !token) return null
  return { url, token }
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

export function getLangfuseConfig(): LangfuseConfig {
  const promptCacheTtlMs = env.LANGFUSE_PROMPT_CACHE_TTL_MS
  return {
    baseUrl: env.LANGFUSE_BASE_URL,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    timeoutMs: env.LANGFUSE_TIMEOUT_MS,
    userAgent: env.LANGFUSE_USER_AGENT,
    // `.optional()` schema + runtime fallback: keeps the knob out of the
    // boot-time `missing` list while always handing the helper a concrete cap.
    maxResponseBytes:
      env.LANGFUSE_MAX_RESPONSE_BYTES ?? DEFAULT_LANGFUSE_MAX_RESPONSE_BYTES,
    promptDefaultLabel: env.LANGFUSE_PROMPT_DEFAULT_LABEL,
    promptCacheTtlMs,
    // Invariant: the effective failure cooldown never exceeds the effective
    // TTL under any env configuration — the smaller value wins. A cooldown
    // outliving the cache window would keep serving the fallback prompt after
    // a fresh fetch is already due.
    promptFailureCooldownMs: Math.min(
      env.LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS,
      promptCacheTtlMs,
    ),
  }
}

/**
 * The trace-retention sweep's Langfuse config: identical to
 * `getLangfuseConfig()` except `timeoutMs`, which comes from
 * `LANGFUSE_TRACE_RETENTION_TIMEOUT_MS` (default 15 s) instead of the
 * prompt-tuned `LANGFUSE_TIMEOUT_MS` (default 3 s). Same credential trio,
 * same host posture, same byte cap — only the caller budget differs
 * (outbound-timeout law: the sweep's ceiling is a daily timer, not a chat
 * turn; the live DELETE was measured over the prompt default).
 */
export function getLangfuseTraceRetentionConfig(): LangfuseConfig {
  return {
    ...getLangfuseConfig(),
    timeoutMs: env.LANGFUSE_TRACE_RETENTION_TIMEOUT_MS,
  }
}

export type AdminAgentToolsConfig = {
  baseUrl?: string
  apiKey?: string
  timeoutMs: number
  userAgent: string
  allowedHosts?: string
  /**
   * Max bytes buffered from an agent-tools response body before the read
   * aborts the stream (feat-327).
   */
  maxResponseBytes: number
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
    // `.optional()` schema + runtime fallback: keeps the knob out of the
    // boot-time `missing` list while always handing the client a concrete cap.
    maxResponseBytes:
      env.ADMIN_AGENT_TOOLS_MAX_RESPONSE_BYTES ??
      DEFAULT_ADMIN_AGENT_TOOLS_MAX_RESPONSE_BYTES,
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
