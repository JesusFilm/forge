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
const DEFAULT_DEVOTIONAL_MODEL = "anthropic/claude-haiku-4-5"
const DEFAULT_SUBTITLE_ENRICHMENT_MODEL = "google/gemini-2.5-flash"
const DEFAULT_SUBTITLE_ENRICHMENT_TIMEOUT_MS = 120_000
const DEFAULT_SUBTITLE_ENRICHMENT_CONCURRENCY = 10
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

const envSchema = z.object({
  ADMIN_EXPERIENCE_INGEST_URL: z.string().url().optional(),
  ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY: z.string().min(1).optional(),
  ADMIN_MASTRA_SCENE_INGEST_API_KEY: z.string().min(1).optional(),
  ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY: z.string().min(1).optional(),
  ADMIN_SEARCH_EVAL_API_KEY: z.string().min(1).optional(),
  ADMIN_SEARCH_EVAL_CANDIDATES_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL: z.string().url().optional(),
  ADMIN_SEARCH_EVAL_SEARCH_URL: z.string().url().optional(),
  ADMIN_SEARCH_TRACE_SAMPLE_URL: z.string().url().optional(),
  ADMIN_SCENE_INGEST_URL: z.string().url().optional(),
  ADMIN_TRANSCRIPT_INGEST_URL: z.string().url().optional(),
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
  DEVOTIONAL_SITE_INGEST_URL: z.string().url().optional(),
  DEVOTIONAL_SITE_INGEST_API_KEY: z.string().min(1).optional(),
  DEVOTIONAL_PARTNER_DOMAINS: z.string().min(1).optional(),
  DEVOTIONAL_DEFAULT_VIDEO_ID: z.string().min(1).optional(),
  DEVOTIONAL_MODEL: z.string().min(1).default(DEFAULT_DEVOTIONAL_MODEL),
  DEVOTIONAL_SAFETY_MODEL: z.string().min(1).default(DEFAULT_DEVOTIONAL_MODEL),
  DEVOTIONAL_ARTIFACT_DIR: z.string().min(1).optional(),
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
  // Directory holding the reflection corpus JSON (Ryle / Matthew Henry /
  // Spurgeon). Defaults to the in-repo `devo/corpus`; override on a bundled
  // deploy where that path isn't present.
  DEVOTIONAL_CORPUS_DIR: z.string().min(1).optional(),
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
  SEARCH_EVAL_JUDGE_MODEL: z
    .string()
    .min(1)
    .default("anthropic/claude-haiku-4-5"),
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
  SCENE_EMBEDDING_MODEL: z
    .string()
    .min(1)
    .default("openai/text-embedding-3-small"),
  SCENE_EMBEDDING_PROVIDER: z.string().min(1).default("openai"),
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
  ADMIN_MASTRA_SCENE_INGEST_API_KEY: emptyToUndefined(
    process.env.ADMIN_MASTRA_SCENE_INGEST_API_KEY,
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
  ADMIN_SCENE_INGEST_URL: emptyToUndefined(process.env.ADMIN_SCENE_INGEST_URL),
  ADMIN_TRANSCRIPT_INGEST_URL: emptyToUndefined(
    process.env.ADMIN_TRANSCRIPT_INGEST_URL,
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
  AZURE_SPEECH_KEY: emptyToUndefined(process.env.AZURE_SPEECH_KEY),
  AZURE_SPEECH_REGION: emptyToUndefined(process.env.AZURE_SPEECH_REGION),
  DEVOTIONAL_VOICE: emptyToUndefined(process.env.DEVOTIONAL_VOICE),
  DEVOTIONAL_VOICE_STYLE: emptyToUndefined(process.env.DEVOTIONAL_VOICE_STYLE),
  ELEVENLABS_API_KEY: emptyToUndefined(process.env.ELEVENLABS_API_KEY),
  ELEVENLABS_VOICE_ID: emptyToUndefined(process.env.ELEVENLABS_VOICE_ID),
  ELEVENLABS_TTS_MODEL: emptyToUndefined(process.env.ELEVENLABS_TTS_MODEL),
  ELEVENLABS_MUSIC_MODEL: emptyToUndefined(process.env.ELEVENLABS_MUSIC_MODEL),
  DEVOTIONAL_CORPUS_DIR: emptyToUndefined(process.env.DEVOTIONAL_CORPUS_DIR),
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
  SEARCH_EVAL_JUDGE_MODEL: emptyToUndefined(
    process.env.SEARCH_EVAL_JUDGE_MODEL,
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
  SCENE_EMBEDDING_MODEL: emptyToUndefined(process.env.SCENE_EMBEDDING_MODEL),
  SCENE_EMBEDDING_PROVIDER: emptyToUndefined(
    process.env.SCENE_EMBEDDING_PROVIDER,
  ),
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
      "ADMIN_MASTRA_SCENE_INGEST_API_KEY",
      env.ADMIN_MASTRA_SCENE_INGEST_API_KEY,
    ],
    [
      "ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY",
      env.ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY,
    ],
    ["ADMIN_EXPERIENCE_INGEST_URL", env.ADMIN_EXPERIENCE_INGEST_URL],
    ["ADMIN_SCENE_INGEST_URL", env.ADMIN_SCENE_INGEST_URL],
    ["ADMIN_TRANSCRIPT_INGEST_URL", env.ADMIN_TRANSCRIPT_INGEST_URL],
    ["DATABASE_URL", env.DATABASE_URL],
    ["FIRECRAWL_API_KEY", env.FIRECRAWL_API_KEY],
    ["MASTRA_SERVICE_API_KEYS", env.MASTRA_SERVICE_API_KEYS],
  ]
  assertFirecrawlApiUrlAllowedForProduction()

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

/** Reflection corpus dir; undefined => the reader falls back to the repo copy. */
export function getDevotionalCorpusDir(): string | undefined {
  return env.DEVOTIONAL_CORPUS_DIR
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

export function getSceneEmbeddingProviderConfig() {
  return getContentEmbeddingProviderConfig(
    env.SCENE_EMBEDDING_MODEL,
    env.SCENE_EMBEDDING_PROVIDER,
  )
}

export function getExperienceEmbeddingProviderConfig() {
  return getContentEmbeddingProviderConfig(
    env.EXPERIENCE_EMBEDDING_MODEL,
    env.EXPERIENCE_EMBEDDING_PROVIDER,
  )
}
