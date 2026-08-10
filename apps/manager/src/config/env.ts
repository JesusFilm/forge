import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

const MOCK_SESSION_SECRET_SENTINEL = "__manager_mock_session_secret_required__"

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    MANAGER_DATA_MODE: z.enum(["admin", "mock"]).default("admin"),
    MANAGER_BACKEND_MODE: z.enum(["admin", "mock"]).optional(),

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
    MANAGER_BASE_URL: z.string().url().optional(),
    MANAGER_SESSION_SECRET: z.string().min(32).optional(),
    AUTH_ISSUER_URL: z.string().url().optional(),
    AUTH_MANAGER_CLIENT_ID: z.string().min(1).optional(),
    AUTH_MANAGER_CLIENT_SECRET: z.string().min(1).optional(),
    AUTH_MANAGER_SERVICE_CLIENT_ID: z.string().min(1).optional(),
    AUTH_MANAGER_SERVICE_CLIENT_SECRET: z.string().min(1).optional(),
    ADMIN_MANAGER_API_KEY: z.string().min(1).optional(),
    ADMIN_MANAGER_SESSION_URL: z.string().url().optional(),

    // SEO delegated approval proof (plan 2026-08-01-001). Optional at boot:
    // the workspace remains read-only when no active private key is present.
    // Admin verifies the matching public key from SEO_APPROVAL_PUBLIC_KEYS.
    SEO_ASSERTION_ENVIRONMENT: z
      .enum(["local", "preview", "staging", "production"])
      .default("local"),
    SEO_APPROVAL_KEY_ID: z.string().min(1).optional(),
    SEO_APPROVAL_PRIVATE_KEY: z.string().min(1).optional(),

    // Admin embed-trigger proxy (plan 006) — manager exposes
    // /api/admin-embeds/transcript, which forwards to admin's GraphQL
    // trigger mutation using the bearer key below. Both vars are optional
    // at boot so manager keeps starting in environments that don't have the
    // proxy configured; the route handler throws a clean 500 with a clear
    // message if invoked without these set.
    ADMIN_GRAPHQL_URL: z.string().url().optional(),
    ADMIN_EMBED_TRIGGER_API_KEY: z.string().min(1).optional(),

    // Mastra service launchers. Transcript embedding runs are launched from
    // manager after transcript.json exists; Mastra owns chunking and vectors.
    MASTRA_BASE_URL: z.string().url().optional(),
    MASTRA_SERVICE_API_KEY: z.string().min(1).optional(),
    MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000),
    MASTRA_SUBTITLE_ENRICHMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(300_000),
    MASTRA_TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000),

    // Smart Crop (plan 2026-06-09-002). All optional opt-in scaffolding —
    // default deploys must not require these. The smart-crop job creation
    // route returns 503 config_missing when invoked without them.
    CROP_WORKER_BASE_URL: z.string().url().optional(),
    CROP_WORKER_API_KEY: z.string().min(1).optional(),
    MASTRA_SMART_CROP_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

    // Shorts Studio (plan 2026-06-11-002). Same opt-in scaffolding pattern
    // as CROP_WORKER_*: optional at schema load so default deploys don't
    // require them; the shorts job creation route returns 503 config_missing
    // when invoked without them. SHORTS_WORKER_API_KEY must be a DISTINCT
    // secret from CROP_WORKER_API_KEY (one worker's bearer must not
    // authorize the other).
    SHORTS_WORKER_BASE_URL: z.string().url().optional(),
    SHORTS_WORKER_API_KEY: z.string().min(1).optional(),

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
    NODE_ENV: process.env.NODE_ENV,
    MANAGER_DATA_MODE: process.env.MANAGER_DATA_MODE ?? "admin",
    MANAGER_BACKEND_MODE: process.env.MANAGER_BACKEND_MODE,
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
    MANAGER_MOCK_SESSION_SECRET:
      process.env.MANAGER_MOCK_SESSION_SECRET ?? MOCK_SESSION_SECRET_SENTINEL,
    MANAGER_MOCK_DATA_PATH:
      process.env.MANAGER_MOCK_DATA_PATH ?? ".tmp/mock-cms/store.json",
    WORKFLOW_API_KEY: process.env.WORKFLOW_API_KEY,
    MANAGER_API_KEY: process.env.MANAGER_API_KEY,
    MANAGER_BASE_URL: process.env.MANAGER_BASE_URL,
    MANAGER_SESSION_SECRET: process.env.MANAGER_SESSION_SECRET,
    AUTH_ISSUER_URL: process.env.AUTH_ISSUER_URL,
    AUTH_MANAGER_CLIENT_ID: process.env.AUTH_MANAGER_CLIENT_ID,
    AUTH_MANAGER_CLIENT_SECRET: process.env.AUTH_MANAGER_CLIENT_SECRET,
    AUTH_MANAGER_SERVICE_CLIENT_ID: process.env.AUTH_MANAGER_SERVICE_CLIENT_ID,
    AUTH_MANAGER_SERVICE_CLIENT_SECRET:
      process.env.AUTH_MANAGER_SERVICE_CLIENT_SECRET,
    ADMIN_MANAGER_API_KEY: process.env.ADMIN_MANAGER_API_KEY,
    ADMIN_MANAGER_SESSION_URL: process.env.ADMIN_MANAGER_SESSION_URL,
    SEO_ASSERTION_ENVIRONMENT: process.env.SEO_ASSERTION_ENVIRONMENT ?? "local",
    SEO_APPROVAL_KEY_ID: process.env.SEO_APPROVAL_KEY_ID,
    SEO_APPROVAL_PRIVATE_KEY: process.env.SEO_APPROVAL_PRIVATE_KEY,
    ADMIN_GRAPHQL_URL: process.env.ADMIN_GRAPHQL_URL,
    ADMIN_EMBED_TRIGGER_API_KEY: process.env.ADMIN_EMBED_TRIGGER_API_KEY,
    MASTRA_BASE_URL: process.env.MASTRA_BASE_URL,
    MASTRA_SERVICE_API_KEY: process.env.MASTRA_SERVICE_API_KEY,
    MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS:
      process.env.MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS,
    MASTRA_SUBTITLE_ENRICHMENT_TIMEOUT_MS:
      process.env.MASTRA_SUBTITLE_ENRICHMENT_TIMEOUT_MS,
    MASTRA_TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS:
      process.env.MASTRA_TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS,
    CROP_WORKER_BASE_URL: process.env.CROP_WORKER_BASE_URL,
    CROP_WORKER_API_KEY: process.env.CROP_WORKER_API_KEY,
    MASTRA_SMART_CROP_TIMEOUT_MS: process.env.MASTRA_SMART_CROP_TIMEOUT_MS,
    SHORTS_WORKER_BASE_URL: process.env.SHORTS_WORKER_BASE_URL,
    SHORTS_WORKER_API_KEY: process.env.SHORTS_WORKER_API_KEY,
    ADMIN_TRIGGER_API_KEYS: process.env.ADMIN_TRIGGER_API_KEYS,
    ELEVENLABS_REQUEST_TIMEOUT_MS: process.env.ELEVENLABS_REQUEST_TIMEOUT_MS,
    ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS:
      process.env.ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS,
    NEXT_PUBLIC_WATCH_URL: process.env.NEXT_PUBLIC_WATCH_URL,
  },
})

const resolvedManagerBackendMode =
  env.MANAGER_BACKEND_MODE ?? env.MANAGER_DATA_MODE

if (
  resolvedManagerBackendMode === "mock" &&
  env.MANAGER_MOCK_SESSION_SECRET === MOCK_SESSION_SECRET_SENTINEL
) {
  throw new Error(
    "MANAGER_MOCK_SESSION_SECRET is required when MANAGER_DATA_MODE=mock",
  )
}

const managerAuthEnvRequired =
  resolvedManagerBackendMode === "admin" ||
  (resolvedManagerBackendMode !== "mock" && env.NODE_ENV === "production")
const isNextProductionBuild =
  process.env.NEXT_PHASE === "phase-production-build"

if (managerAuthEnvRequired && !isNextProductionBuild) {
  const missing = [
    ["MANAGER_SESSION_SECRET", env.MANAGER_SESSION_SECRET],
    ["AUTH_ISSUER_URL", env.AUTH_ISSUER_URL],
    ["AUTH_MANAGER_CLIENT_ID", env.AUTH_MANAGER_CLIENT_ID],
    ["ADMIN_GRAPHQL_URL", env.ADMIN_GRAPHQL_URL],
    [
      "ADMIN_MANAGER_API_KEY or AUTH_MANAGER_SERVICE_CLIENT_ID/AUTH_MANAGER_SERVICE_CLIENT_SECRET",
      env.ADMIN_MANAGER_API_KEY ||
        (env.AUTH_MANAGER_SERVICE_CLIENT_ID &&
          env.AUTH_MANAGER_SERVICE_CLIENT_SECRET),
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required when Manager auth is enabled`,
    )
  }
}
