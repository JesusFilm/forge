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
  SEARCH_EVAL_JUDGE_MODEL: z
    .string()
    .min(1)
    .default("anthropic/claude-haiku-4-5"),
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
  SEARCH_EVAL_JUDGE_MODEL: emptyToUndefined(
    process.env.SEARCH_EVAL_JUDGE_MODEL,
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
      "OPENROUTER_API_KEY or OPENAI_API_KEY",
      env.OPENROUTER_API_KEY ?? env.OPENAI_API_KEY,
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

function getLegacyEmbeddingProviderConfig(
  model: string,
  provider: string,
): ContentEmbeddingProviderConfig {
  if (env.OPENROUTER_API_KEY) {
    return {
      apiKey: env.OPENROUTER_API_KEY,
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
