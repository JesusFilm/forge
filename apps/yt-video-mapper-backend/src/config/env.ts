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
