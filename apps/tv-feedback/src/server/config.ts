import { z } from "zod"

const schema = z.object({
  REDIS_URL: z.string().url().optional(),
  FEEDBACK_SESSION_SECRET: z.string().min(32).optional(),
  FEEDBACK_BASE_URL: z.string().url().optional(),
  FEEDBACK_GRANT_MODE: z.enum(["off", "observe", "enforce"]).optional(),
  FEEDBACK_PLAY_PACKAGE: z.string().optional(),
  FEEDBACK_PLAY_CERT_SHA256: z.string().optional(),
  FEEDBACK_PLAY_ALLOWED_VERSIONS: z.string().optional(),
  FEEDBACK_GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FEEDBACK_APPLE_TEAM_ID: z.string().optional(),
  FEEDBACK_APPLE_KEY_ID: z.string().optional(),
  FEEDBACK_APPLE_PRIVATE_KEY: z.string().optional(),
  FEEDBACK_APPLE_BUNDLE_ID: z.string().optional(),
  FEEDBACK_APPLE_ALLOWED_BUILDS: z.string().optional(),
  FEEDBACK_APPLE_DEVICECHECK_ENV: z
    .enum(["development", "production"])
    .optional(),
  FEEDBACK_APPLE_DEVICECHECK_ENABLED: z.enum(["true", "false"]).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  FEEDBACK_LINEAR_API_KEY: z.string().min(1).optional(),
  FEEDBACK_LINEAR_TEAM_ID: z.string().min(1).optional(),
  FEEDBACK_LINEAR_PROJECT_ID: z.string().min(1).optional(),
  FEEDBACK_LINEAR_LABEL_ID: z.string().min(1).optional(),
})

export type Config = z.infer<typeof schema>

export function config(): Config {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success)
    throw new Error("Feedback service configuration is invalid")
  return parsed.data
}

export function requireConfig<K extends keyof Config>(
  ...keys: K[]
): Config & Record<K, string> {
  const value = config()
  for (const key of keys) {
    if (!value[key]) throw new Error(`Feedback service is missing ${key}`)
  }
  return value as Config & Record<K, string>
}
