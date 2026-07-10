import { z } from "zod"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3011),
  CROP_WORKER_API_KEYS: z.string().min(1).optional(),
  RAILWAY_S3_ENDPOINT: z.string().min(1).optional(),
  RAILWAY_S3_REGION: z.string().min(1).optional(),
  RAILWAY_S3_BUCKET: z.string().min(1).optional(),
  RAILWAY_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  RAILWAY_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  CROP_WORKER_LOCAL_ARTIFACTS_DIR: z.string().min(1).default(".tmp/artifacts"),
  CROP_WORKER_MAX_CONCURRENT_JOBS: z.coerce
    .number()
    .int()
    .positive()
    .default(1),
  CROP_WORKER_QUEUE_LIMIT: z.coerce.number().int().positive().default(10),
  CROP_WORKER_PREVIEW_MAX_SEGMENTS: z.coerce
    .number()
    .int()
    .positive()
    .default(6),
  CROP_WORKER_PREVIEW_MAX_SECONDS: z.coerce.number().positive().default(90),
  CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_800_000),
  CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(21_600_000),
  // Per-JOB deadlines (queue wait + every ffmpeg/ffprobe invocation). Each
  // default MUST stay strictly below the matching manager poll ceiling in
  // apps/manager/src/workflows/smartCrop.ts (FINGERPRINT_POLL_TIMEOUT_MS
  // 30min, PREVIEW_RENDER_POLL_TIMEOUT_MS 30min, FULL_RENDER_POLL_TIMEOUT_MS
  // 6h) so the worker fails definitively before the caller's budget expires
  // (root CLAUDE.md: outbound timeout shorter than caller budget). Raise the
  // pair TOGETHER, worker strictly below manager.
  CROP_WORKER_FINGERPRINT_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_500_000),
  CROP_WORKER_RENDER_PREVIEW_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_500_000),
  CROP_WORKER_RENDER_FULL_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(19_800_000),
  // Optional CSV override for the ffmpeg/ffprobe -protocol_whitelist applied
  // to attacker-influencable source-URL inputs (see ffmpeg.ts
  // sourceProtocolWhitelist for the defaults).
  CROP_WORKER_SOURCE_PROTOCOL_WHITELIST: z.string().min(1).optional(),
  CROP_WORKER_SCENE_THRESHOLD: z.coerce.number().positive().max(1).default(0.3),
  CROP_WORKER_MIN_SHOT_SECONDS: z.coerce.number().positive().default(1.5),
})

export type Env = z.infer<typeof envSchema>

export type EnvSource = Partial<Record<keyof Env, string | undefined>>

export function parseEnv(source: EnvSource): Env {
  return envSchema.parse({
    // emptyToUndefined so an empty-string NODE_ENV (Railway provides "" rather
    // than leaving it unset) falls through to the schema default instead of
    // failing the enum and crashing boot before the server can listen.
    NODE_ENV: emptyToUndefined(source.NODE_ENV),
    PORT: emptyToUndefined(source.PORT),
    CROP_WORKER_API_KEYS: emptyToUndefined(source.CROP_WORKER_API_KEYS),
    RAILWAY_S3_ENDPOINT: emptyToUndefined(source.RAILWAY_S3_ENDPOINT),
    RAILWAY_S3_REGION: emptyToUndefined(source.RAILWAY_S3_REGION),
    RAILWAY_S3_BUCKET: emptyToUndefined(source.RAILWAY_S3_BUCKET),
    RAILWAY_S3_ACCESS_KEY_ID: emptyToUndefined(source.RAILWAY_S3_ACCESS_KEY_ID),
    RAILWAY_S3_SECRET_ACCESS_KEY: emptyToUndefined(
      source.RAILWAY_S3_SECRET_ACCESS_KEY,
    ),
    CROP_WORKER_LOCAL_ARTIFACTS_DIR: emptyToUndefined(
      source.CROP_WORKER_LOCAL_ARTIFACTS_DIR,
    ),
    CROP_WORKER_MAX_CONCURRENT_JOBS: emptyToUndefined(
      source.CROP_WORKER_MAX_CONCURRENT_JOBS,
    ),
    CROP_WORKER_QUEUE_LIMIT: emptyToUndefined(source.CROP_WORKER_QUEUE_LIMIT),
    CROP_WORKER_PREVIEW_MAX_SEGMENTS: emptyToUndefined(
      source.CROP_WORKER_PREVIEW_MAX_SEGMENTS,
    ),
    CROP_WORKER_PREVIEW_MAX_SECONDS: emptyToUndefined(
      source.CROP_WORKER_PREVIEW_MAX_SECONDS,
    ),
    CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS: emptyToUndefined(
      source.CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS,
    ),
    CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS: emptyToUndefined(
      source.CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS,
    ),
    CROP_WORKER_FINGERPRINT_JOB_TIMEOUT_MS: emptyToUndefined(
      source.CROP_WORKER_FINGERPRINT_JOB_TIMEOUT_MS,
    ),
    CROP_WORKER_RENDER_PREVIEW_JOB_TIMEOUT_MS: emptyToUndefined(
      source.CROP_WORKER_RENDER_PREVIEW_JOB_TIMEOUT_MS,
    ),
    CROP_WORKER_RENDER_FULL_JOB_TIMEOUT_MS: emptyToUndefined(
      source.CROP_WORKER_RENDER_FULL_JOB_TIMEOUT_MS,
    ),
    CROP_WORKER_SOURCE_PROTOCOL_WHITELIST: emptyToUndefined(
      source.CROP_WORKER_SOURCE_PROTOCOL_WHITELIST,
    ),
    CROP_WORKER_SCENE_THRESHOLD: emptyToUndefined(
      source.CROP_WORKER_SCENE_THRESHOLD,
    ),
    CROP_WORKER_MIN_SHOT_SECONDS: emptyToUndefined(
      source.CROP_WORKER_MIN_SHOT_SECONDS,
    ),
  })
}

export const env = parseEnv(process.env as EnvSource)

export class RuntimeEnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RuntimeEnvError"
  }
}

export function assertRuntimeEnv(target: Env = env): void {
  if (target.NODE_ENV !== "production") return

  const missing = [
    ["CROP_WORKER_API_KEYS", target.CROP_WORKER_API_KEYS],
    ["RAILWAY_S3_ENDPOINT", target.RAILWAY_S3_ENDPOINT],
    ["RAILWAY_S3_REGION", target.RAILWAY_S3_REGION],
    ["RAILWAY_S3_BUCKET", target.RAILWAY_S3_BUCKET],
    ["RAILWAY_S3_ACCESS_KEY_ID", target.RAILWAY_S3_ACCESS_KEY_ID],
    ["RAILWAY_S3_SECRET_ACCESS_KEY", target.RAILWAY_S3_SECRET_ACCESS_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new RuntimeEnvError(
      `${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } required for crop-worker production`,
    )
  }
}
