import { existsSync } from "node:fs"
import { z } from "zod"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

// Mastra polls for at most 4,800,000ms. Keep 60s for the final worker cleanup,
// terminal-state persistence, one 5s poll interval, and request latency.
export const MAX_RENDER_JOB_TIMEOUT_MS = 4_740_000

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3012),
  SHORTS_WORKER_API_KEYS: z.string().min(1).optional(),
  RAILWAY_S3_ENDPOINT: z.string().min(1).optional(),
  RAILWAY_S3_REGION: z.string().min(1).optional(),
  RAILWAY_S3_BUCKET: z.string().min(1).optional(),
  RAILWAY_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  RAILWAY_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Local-only compatibility for pre-signed-transfer devotional tests/tools.
  // Production Workspace access is granted per job by short-lived URLs.
  DEVOTIONAL_WORKSPACE_LOCAL_DIR: z
    .string()
    .min(1)
    .default(".tmp/devotional-workspace"),
  // Non-secret defense-in-depth boundary for Mastra-issued S3 capabilities.
  // Exact origin only: no path, credentials, query, or fragment.
  DEVOTIONAL_WORKSPACE_CAPABILITY_ORIGIN: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value)
      return url.protocol === "https:" && value === url.origin
    }, "must be an exact https origin")
    .optional(),
  SHORTS_WORKER_LOCAL_ARTIFACTS_DIR: z
    .string()
    .min(1)
    .default(".tmp/artifacts"),
  // Exact-hostname allowlist for devotional source URLs (CSV). The S3 endpoint
  // host is deliberately NOT in here — artifacts move via the SDK, never
  // ffmpeg (plan decision 10).
  SHORTS_WORKER_ALLOWED_SOURCE_HOSTS: z
    .string()
    .min(1)
    .default("stream.mux.com"),
  // Remotion renderMedia concurrency. Default 2 on a 4 vCPU container —
  // x264 needs the other cores (plan render knobs).
  SHORTS_WORKER_RENDER_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .default(2),
  // One baked devotional bundle is reused for portrait + wide renders.
  SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR: z.string().min(1).optional(),
  // Per-LANE queue limit (pending + running) → 409 queue_full beyond it.
  SHORTS_WORKER_QUEUE_LIMIT: z.coerce.number().int().positive().default(2),
  // Per-JOB deadlines created at ENQUEUE time (queue wait counts). Sized to
  // cover own budget + one queued predecessor; each MUST stay strictly below
  // the matching manager poll ceiling (render 80min — root
  // CLAUDE.md: outbound timeout shorter than caller budget). Raise the pair
  // together, preserving at least 60s of orchestrator observation headroom.
  SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_RENDER_JOB_TIMEOUT_MS)
    .default(4_200_000),
  // Per-invocation subprocess caps; every invocation is additionally capped
  // at the remaining job deadline.
  SHORTS_WORKER_FFMPEG_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_800_000),
  // Optional credentials used only by the local devotional snippet helper.
  // Keeping access here preserves the package-wide env boundary.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  DEVOTIONAL_MODEL: z.string().min(1).optional(),
})

export type Env = z.infer<typeof envSchema>

export type EnvSource = Partial<Record<keyof Env, string | undefined>>

export function parseEnv(source: EnvSource): Env {
  return envSchema.parse({
    // emptyToUndefined so an empty-string NODE_ENV (Railway provides ""
    // rather than leaving it unset) falls through to the schema default
    // instead of failing the enum and crashing boot before the server can
    // listen.
    NODE_ENV: emptyToUndefined(source.NODE_ENV),
    PORT: emptyToUndefined(source.PORT),
    SHORTS_WORKER_API_KEYS: emptyToUndefined(source.SHORTS_WORKER_API_KEYS),
    RAILWAY_S3_ENDPOINT: emptyToUndefined(source.RAILWAY_S3_ENDPOINT),
    RAILWAY_S3_REGION: emptyToUndefined(source.RAILWAY_S3_REGION),
    RAILWAY_S3_BUCKET: emptyToUndefined(source.RAILWAY_S3_BUCKET),
    RAILWAY_S3_ACCESS_KEY_ID: emptyToUndefined(source.RAILWAY_S3_ACCESS_KEY_ID),
    RAILWAY_S3_SECRET_ACCESS_KEY: emptyToUndefined(
      source.RAILWAY_S3_SECRET_ACCESS_KEY,
    ),
    DEVOTIONAL_WORKSPACE_LOCAL_DIR: emptyToUndefined(
      source.DEVOTIONAL_WORKSPACE_LOCAL_DIR,
    ),
    DEVOTIONAL_WORKSPACE_CAPABILITY_ORIGIN: emptyToUndefined(
      source.DEVOTIONAL_WORKSPACE_CAPABILITY_ORIGIN,
    ),
    SHORTS_WORKER_LOCAL_ARTIFACTS_DIR: emptyToUndefined(
      source.SHORTS_WORKER_LOCAL_ARTIFACTS_DIR,
    ),
    SHORTS_WORKER_ALLOWED_SOURCE_HOSTS: emptyToUndefined(
      source.SHORTS_WORKER_ALLOWED_SOURCE_HOSTS,
    ),
    SHORTS_WORKER_RENDER_CONCURRENCY: emptyToUndefined(
      source.SHORTS_WORKER_RENDER_CONCURRENCY,
    ),
    SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR: emptyToUndefined(
      source.SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR,
    ),
    SHORTS_WORKER_QUEUE_LIMIT: emptyToUndefined(
      source.SHORTS_WORKER_QUEUE_LIMIT,
    ),
    SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS: emptyToUndefined(
      source.SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS,
    ),
    SHORTS_WORKER_FFMPEG_TIMEOUT_MS: emptyToUndefined(
      source.SHORTS_WORKER_FFMPEG_TIMEOUT_MS,
    ),
    OPENROUTER_API_KEY: emptyToUndefined(source.OPENROUTER_API_KEY),
    DEVOTIONAL_MODEL: emptyToUndefined(source.DEVOTIONAL_MODEL),
  })
}

export const env = parseEnv(process.env as EnvSource)

export class RuntimeEnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RuntimeEnvError"
  }
}

export type FileExists = (path: string) => boolean

// Fail-fast boot assertion. All vars stay .optional() at schema load (root
// CLAUDE.md: opt-in scaffolding env vars must not brick deploys of OTHER
// environments); production requires the retained devotional bundle on disk.
export function assertRuntimeEnv(
  target: Env = env,
  fileExists: FileExists = existsSync,
): void {
  if (target.NODE_ENV !== "production") return

  const missing = [
    ["SHORTS_WORKER_API_KEYS", target.SHORTS_WORKER_API_KEYS],
    ["RAILWAY_S3_ENDPOINT", target.RAILWAY_S3_ENDPOINT],
    ["RAILWAY_S3_REGION", target.RAILWAY_S3_REGION],
    ["RAILWAY_S3_BUCKET", target.RAILWAY_S3_BUCKET],
    ["RAILWAY_S3_ACCESS_KEY_ID", target.RAILWAY_S3_ACCESS_KEY_ID],
    ["RAILWAY_S3_SECRET_ACCESS_KEY", target.RAILWAY_S3_SECRET_ACCESS_KEY],
    [
      "DEVOTIONAL_WORKSPACE_CAPABILITY_ORIGIN",
      target.DEVOTIONAL_WORKSPACE_CAPABILITY_ORIGIN,
    ],
    [
      "SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR",
      target.SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR,
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new RuntimeEnvError(
      `${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } required for shorts-worker production`,
    )
  }

  const missingPaths = [
    [
      "SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR",
      target.SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR!,
    ],
  ].filter(([, path]) => !fileExists(path))

  if (missingPaths.length > 0) {
    throw new RuntimeEnvError(
      missingPaths
        .map(([name, path]) => `${name} points at a missing path: ${path}`)
        .join("; "),
    )
  }
}
