import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    // Mux
    MUX_TOKEN_ID: z.string().min(1),
    MUX_TOKEN_SECRET: z.string().min(1),
    MUX_SIGNING_KEY: z.string().min(1).optional(),
    MUX_PRIVATE_KEY: z.string().min(1).optional(),
    MUX_ENRICHMENT_FORCE_STAGE_CLONE: z.enum(["true", "false"]).optional(),
    // AI (OpenRouter)
    OPENROUTER_API_KEY: z.string().min(1),

    // Railway S3-compatible Object Storage (optional — falls back to local tmp files)
    RAILWAY_S3_ENDPOINT: z.string().url().optional(),
    RAILWAY_S3_REGION: z.string().min(1).default("auto"),
    RAILWAY_S3_BUCKET: z.string().min(1).optional(),
    RAILWAY_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    RAILWAY_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

    // Strapi CMS
    STRAPI_URL: z.string().url(),
    STRAPI_API_TOKEN: z.string().min(1),
    STRAPI_INTERNAL_API_TOKEN: z.string().min(1).optional(),

    // workflow (https://useworkflow.dev/) — optional for production durability
    WORKFLOW_API_KEY: z.string().min(1).optional(),

    // API authentication — required for production
    MANAGER_API_KEY: z.string().min(1).optional(),

    // ElevenLabs transcription (optional unless ElevenLabs routing is used)
    ELEVENLABS_API_KEY: z.string().min(1).optional(),
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
    MUX_TOKEN_ID: process.env.MUX_TOKEN_ID,
    MUX_TOKEN_SECRET: process.env.MUX_TOKEN_SECRET,
    MUX_SIGNING_KEY: process.env.MUX_SIGNING_KEY,
    MUX_PRIVATE_KEY: process.env.MUX_PRIVATE_KEY,
    MUX_ENRICHMENT_FORCE_STAGE_CLONE:
      process.env.MUX_ENRICHMENT_FORCE_STAGE_CLONE,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    RAILWAY_S3_ENDPOINT: process.env.RAILWAY_S3_ENDPOINT,
    RAILWAY_S3_REGION: process.env.RAILWAY_S3_REGION,
    RAILWAY_S3_BUCKET: process.env.RAILWAY_S3_BUCKET,
    RAILWAY_S3_ACCESS_KEY_ID: process.env.RAILWAY_S3_ACCESS_KEY_ID,
    RAILWAY_S3_SECRET_ACCESS_KEY: process.env.RAILWAY_S3_SECRET_ACCESS_KEY,
    STRAPI_URL: process.env.STRAPI_URL,
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
    STRAPI_INTERNAL_API_TOKEN: process.env.STRAPI_INTERNAL_API_TOKEN,
    WORKFLOW_API_KEY: process.env.WORKFLOW_API_KEY,
    MANAGER_API_KEY: process.env.MANAGER_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_REQUEST_TIMEOUT_MS: process.env.ELEVENLABS_REQUEST_TIMEOUT_MS,
    ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS:
      process.env.ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS,
    NEXT_PUBLIC_WATCH_URL: process.env.NEXT_PUBLIC_WATCH_URL,
  },
})
