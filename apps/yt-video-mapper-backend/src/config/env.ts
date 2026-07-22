import { z } from "zod"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().url().optional(),
  ADMIN_GRAPHQL_URL: z.string().url().optional(),
  ADMIN_SERVICE_BEARER_TOKEN: z.string().min(1).optional(),
  MAPPER_API_TOKEN: z.string().min(32).optional(),
  UPLOAD_STORAGE_DIR: z.string().min(1).default(".tmp/uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(100_000_000),
  MATCH_RESULT_LIMIT: z.coerce.number().int().positive().max(25).default(3),
  JOB_RESULT_RETENTION_HOURS: z.coerce.number().int().positive().default(168),
  JOB_RUNNING_STALE_MINUTES: z.coerce.number().int().positive().default(30),
  MATCH_JOB_WORKER_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true"),
  MATCH_JOB_CLEANER_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true"),
  MATCH_JOB_WORKER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_000),
  MEDIA_SIGNATURE_ALGORITHM_VERSION: z
    .string()
    .min(1)
    .default("official-media-signature-v1"),
  MEDIA_INDEX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
  MEDIA_INDEX_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .max(4)
    .default(2),
  MEDIA_INDEX_MAX_FETCH_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(262_144),
  MEDIA_INDEX_FETCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15_000),
  MEDIA_INDEX_ALLOWED_HOSTS: z.string().min(1).optional(),
  MEDIA_INDEX_RESUME_AFTER_VARIANT_ID: z.string().min(1).optional(),
})

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: emptyToUndefined(process.env.DATABASE_URL),
  ADMIN_GRAPHQL_URL: emptyToUndefined(process.env.ADMIN_GRAPHQL_URL),
  ADMIN_SERVICE_BEARER_TOKEN: emptyToUndefined(
    process.env.ADMIN_SERVICE_BEARER_TOKEN,
  ),
  MAPPER_API_TOKEN: emptyToUndefined(process.env.MAPPER_API_TOKEN),
  UPLOAD_STORAGE_DIR: emptyToUndefined(process.env.UPLOAD_STORAGE_DIR),
  MAX_UPLOAD_BYTES: emptyToUndefined(process.env.MAX_UPLOAD_BYTES),
  MATCH_RESULT_LIMIT: emptyToUndefined(process.env.MATCH_RESULT_LIMIT),
  JOB_RESULT_RETENTION_HOURS: emptyToUndefined(
    process.env.JOB_RESULT_RETENTION_HOURS,
  ),
  JOB_RUNNING_STALE_MINUTES: emptyToUndefined(
    process.env.JOB_RUNNING_STALE_MINUTES,
  ),
  MATCH_JOB_WORKER_ENABLED: emptyToUndefined(
    process.env.MATCH_JOB_WORKER_ENABLED,
  ),
  MATCH_JOB_CLEANER_ENABLED: emptyToUndefined(
    process.env.MATCH_JOB_CLEANER_ENABLED,
  ),
  MATCH_JOB_WORKER_POLL_INTERVAL_MS: emptyToUndefined(
    process.env.MATCH_JOB_WORKER_POLL_INTERVAL_MS,
  ),
  MEDIA_SIGNATURE_ALGORITHM_VERSION: emptyToUndefined(
    process.env.MEDIA_SIGNATURE_ALGORITHM_VERSION,
  ),
  MEDIA_INDEX_PAGE_SIZE: emptyToUndefined(process.env.MEDIA_INDEX_PAGE_SIZE),
  MEDIA_INDEX_CONCURRENCY: emptyToUndefined(
    process.env.MEDIA_INDEX_CONCURRENCY,
  ),
  MEDIA_INDEX_MAX_FETCH_BYTES: emptyToUndefined(
    process.env.MEDIA_INDEX_MAX_FETCH_BYTES,
  ),
  MEDIA_INDEX_FETCH_TIMEOUT_MS: emptyToUndefined(
    process.env.MEDIA_INDEX_FETCH_TIMEOUT_MS,
  ),
  MEDIA_INDEX_ALLOWED_HOSTS: emptyToUndefined(
    process.env.MEDIA_INDEX_ALLOWED_HOSTS,
  ),
  MEDIA_INDEX_RESUME_AFTER_VARIANT_ID: emptyToUndefined(
    process.env.MEDIA_INDEX_RESUME_AFTER_VARIANT_ID,
  ),
})

export class RuntimeEnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RuntimeEnvError"
  }
}

export function assertRuntimeEnv(): void {
  if (env.NODE_ENV !== "production") return

  const missing = [
    ["DATABASE_URL", env.DATABASE_URL],
    ["MAPPER_API_TOKEN", env.MAPPER_API_TOKEN],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new RuntimeEnvError(
      `${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } required for yt-video-mapper-backend production`,
    )
  }
}

export type AdminCatalogSyncEnv = {
  adminGraphqlUrl: string
  adminServiceBearerToken: string
}

export type MediaIndexEnv = {
  allowedHosts: string
}

export function assertAdminCatalogSyncEnv(): AdminCatalogSyncEnv {
  const missing = [
    ["ADMIN_GRAPHQL_URL", env.ADMIN_GRAPHQL_URL],
    ["ADMIN_SERVICE_BEARER_TOKEN", env.ADMIN_SERVICE_BEARER_TOKEN],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new RuntimeEnvError(
      `${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } required to sync the yt-video-mapper catalog`,
    )
  }

  return {
    adminGraphqlUrl: env.ADMIN_GRAPHQL_URL!,
    adminServiceBearerToken: env.ADMIN_SERVICE_BEARER_TOKEN!,
  }
}

export function assertMediaIndexEnv(): MediaIndexEnv {
  if (env.NODE_ENV === "production" && !env.MEDIA_INDEX_ALLOWED_HOSTS) {
    throw new RuntimeEnvError(
      "MEDIA_INDEX_ALLOWED_HOSTS is required to index yt-video-mapper official media in production",
    )
  }

  return {
    allowedHosts: env.MEDIA_INDEX_ALLOWED_HOSTS ?? "",
  }
}
