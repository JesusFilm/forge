import { z } from "zod"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway"

const envSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PHASE: z.string().optional(),
  MASTRA_SERVICE_API_KEYS: z.string().min(1).optional(),
  MASTRA_STORAGE_DIR: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  RAILWAY_VOLUME_MOUNT_PATH: z.string().min(1).optional(),
})

export const env = envSchema.parse({
  DATABASE_URL: emptyToUndefined(process.env.DATABASE_URL),
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PHASE: process.env.NEXT_PHASE,
  MASTRA_SERVICE_API_KEYS: emptyToUndefined(
    process.env.MASTRA_SERVICE_API_KEYS,
  ),
  MASTRA_STORAGE_DIR: emptyToUndefined(process.env.MASTRA_STORAGE_DIR),
  OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
  RAILWAY_VOLUME_MOUNT_PATH: emptyToUndefined(
    process.env.RAILWAY_VOLUME_MOUNT_PATH,
  ),
})

export function assertMastraRuntimeEnv() {
  if (env.NODE_ENV !== "production") return

  const missing = [
    ["DATABASE_URL", env.DATABASE_URL],
    ["MASTRA_SERVICE_API_KEYS", env.MASTRA_SERVICE_API_KEYS],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} required for Mastra production`)
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
