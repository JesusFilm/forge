import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

const MOCK_STRAPI_URL = "http://mock-cms.invalid"
const MOCK_STRAPI_API_TOKEN = "mock-api-token"
const MOCK_SESSION_SECRET_SENTINEL = "__manager_mock_session_secret_required__"

export const env = createEnv({
  server: {
    MANAGER_DATA_MODE: z.enum(["live", "mock"]).default("live"),

    // Mux
    MUX_TOKEN_ID: z.string().min(1),
    MUX_TOKEN_SECRET: z.string().min(1),
    MUX_SIGNING_KEY: z.string().min(1).optional(),
    MUX_PRIVATE_KEY: z.string().min(1).optional(),
    MUX_ENRICHMENT_FORCE_STAGE_CLONE: z.enum(["true", "false"]).optional(),
    // AI providers
    OPENROUTER_API_KEY: z.string().min(1),
    ELEVENLABS_API_KEY: z.string().min(1).optional(),

    // Railway S3-compatible Object Storage (optional — falls back to local tmp files)
    RAILWAY_S3_ENDPOINT: z.string().url().optional(),
    RAILWAY_S3_REGION: z.string().min(1).default("auto"),
    RAILWAY_S3_BUCKET: z.string().min(1).optional(),
    RAILWAY_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    RAILWAY_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

    // Strapi CMS
    STRAPI_URL: z.string().url().default(MOCK_STRAPI_URL),
    STRAPI_API_TOKEN: z.string().min(1).default(MOCK_STRAPI_API_TOKEN),
    STRAPI_INTERNAL_API_TOKEN: z.string().min(1).optional(),

    // Mock CMS mode
    MANAGER_MOCK_SESSION_SECRET: z
      .string()
      .min(1)
      .default(MOCK_SESSION_SECRET_SENTINEL),
    MANAGER_MOCK_DATA_PATH: z
      .string()
      .min(1)
      .default(".tmp/mock-cms/store.json"),

    // workflow (https://useworkflow.dev/) — optional for production durability
    WORKFLOW_API_KEY: z.string().min(1).optional(),

    // API authentication — required for production
    MANAGER_API_KEY: z.string().min(1).optional(),

    // Admin embed-trigger proxy (plan 006) — manager exposes
    // /api/admin-embeds/{scene,transcript} which forward to admin's
    // GraphQL trigger mutations using the bearer key below. Both vars
    // are optional at boot so manager keeps starting in environments
    // that don't have the proxy configured; the route handlers throw
    // a clean 500 with a clear message if invoked without these set.
    ADMIN_GRAPHQL_URL: z.string().url().optional(),
    ADMIN_EMBED_TRIGGER_API_KEY: z.string().min(1).optional(),

    // feat-119 PR2 — admin → manager outbound enrichment trigger.
    // Manager exposes /api/admin-trigger/{scene-analysis,transcript}
    // which admin's `triggerManagerEnrichment` GraphQL mutation calls
    // when an operator has decided (after reading PR1's
    // `missingArtifacts` list) to backfill upstream pipeline output.
    // CSV of accepted bearer keys; mirrors admin's WORKFLOW_API_KEYS
    // shape so the receiver-side rotation pattern is symmetric.
    // Optional at boot so manager keeps starting in environments that
    // don't have the trigger endpoint configured; the route handlers
    // return 503 if invoked without this set.
    ADMIN_TRIGGER_API_KEYS: z.string().min(1).optional(),

    // ElevenLabs transcription (optional unless ElevenLabs routing is used)
    ELEVENLABS_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
  },
  client: {
    NEXT_PUBLIC_WATCH_URL: z.string().url().optional(),
  },
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    MANAGER_DATA_MODE: process.env.MANAGER_DATA_MODE ?? "live",
    MUX_TOKEN_ID: process.env.MUX_TOKEN_ID,
    MUX_TOKEN_SECRET: process.env.MUX_TOKEN_SECRET,
    MUX_SIGNING_KEY: process.env.MUX_SIGNING_KEY,
    MUX_PRIVATE_KEY: process.env.MUX_PRIVATE_KEY,
    MUX_ENRICHMENT_FORCE_STAGE_CLONE:
      process.env.MUX_ENRICHMENT_FORCE_STAGE_CLONE,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    RAILWAY_S3_ENDPOINT: process.env.RAILWAY_S3_ENDPOINT,
    RAILWAY_S3_REGION: process.env.RAILWAY_S3_REGION,
    RAILWAY_S3_BUCKET: process.env.RAILWAY_S3_BUCKET,
    RAILWAY_S3_ACCESS_KEY_ID: process.env.RAILWAY_S3_ACCESS_KEY_ID,
    RAILWAY_S3_SECRET_ACCESS_KEY: process.env.RAILWAY_S3_SECRET_ACCESS_KEY,
    STRAPI_URL: process.env.STRAPI_URL ?? MOCK_STRAPI_URL,
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN ?? MOCK_STRAPI_API_TOKEN,
    STRAPI_INTERNAL_API_TOKEN: process.env.STRAPI_INTERNAL_API_TOKEN,
    MANAGER_MOCK_SESSION_SECRET:
      process.env.MANAGER_MOCK_SESSION_SECRET ?? MOCK_SESSION_SECRET_SENTINEL,
    MANAGER_MOCK_DATA_PATH:
      process.env.MANAGER_MOCK_DATA_PATH ?? ".tmp/mock-cms/store.json",
    WORKFLOW_API_KEY: process.env.WORKFLOW_API_KEY,
    MANAGER_API_KEY: process.env.MANAGER_API_KEY,
    ADMIN_GRAPHQL_URL: process.env.ADMIN_GRAPHQL_URL,
    ADMIN_EMBED_TRIGGER_API_KEY: process.env.ADMIN_EMBED_TRIGGER_API_KEY,
    ADMIN_TRIGGER_API_KEYS: process.env.ADMIN_TRIGGER_API_KEYS,
    ELEVENLABS_REQUEST_TIMEOUT_MS: process.env.ELEVENLABS_REQUEST_TIMEOUT_MS,
    ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS:
      process.env.ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS,
    NEXT_PUBLIC_WATCH_URL: process.env.NEXT_PUBLIC_WATCH_URL,
  },
})

if (env.MANAGER_DATA_MODE === "live") {
  if (!process.env.STRAPI_URL) {
    throw new Error("STRAPI_URL is required when MANAGER_DATA_MODE=live")
  }

  if (!process.env.STRAPI_API_TOKEN) {
    throw new Error("STRAPI_API_TOKEN is required when MANAGER_DATA_MODE=live")
  }
}

if (
  env.MANAGER_DATA_MODE === "mock" &&
  env.MANAGER_MOCK_SESSION_SECRET === MOCK_SESSION_SECRET_SENTINEL
) {
  throw new Error(
    "MANAGER_MOCK_SESSION_SECRET is required when MANAGER_DATA_MODE=mock",
  )
}
