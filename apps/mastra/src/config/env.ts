import { z } from "zod"

const envInputSchema = z.object({
  CI: z.string().optional(),
  NODE_ENV: z.string().optional(),
  MASTRA_HOST: z.string().optional(),
  MASTRA_PORT: z.string().optional(),
  MASTRA_SERVICE_API_KEY: z.string().optional(),
  MASTRA_OPERATOR_API_KEY: z.string().optional(),
  MASTRA_OPERATOR_TOKEN: z.string().optional(),
  MASTRA_STORAGE_URL: z.string().optional(),
  MASTRA_MODEL: z.string().optional(),
  MASTRA_MODEL_PROVIDER: z.string().optional(),
  MASTRA_MODEL_NAME: z.string().optional(),
  MANAGER_BASE_URL: z.string().optional(),
  MANAGER_MASTRA_API_KEY: z.string().optional(),
})

const requiredSecret = z.string().min(12)
const ciAllowedSecret = z.string().min(1)

export type MastraEnv = {
  nodeEnv: string
  host: string
  port: number
  serviceApiKey: string
  operatorApiKey: string
  storageUrl: string
  model: string
  managerBaseUrl: string
  managerMastraApiKey: string
  isProduction?: boolean
  isCi: boolean
}

export function parseMastraEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined>,
): MastraEnv {
  const base = envInputSchema.parse(input)
  const nodeEnv = base.NODE_ENV ?? "development"
  const isProduction = base.NODE_ENV === "production"
  const isCi = base.CI === "true" || base.CI === "1"
  const secretSchema = isProduction && !isCi ? requiredSecret : ciAllowedSecret
  const operatorApiKey =
    base.MASTRA_OPERATOR_API_KEY ?? base.MASTRA_OPERATOR_TOKEN
  const model =
    base.MASTRA_MODEL ??
    (base.MASTRA_MODEL_PROVIDER && base.MASTRA_MODEL_NAME
      ? `${base.MASTRA_MODEL_PROVIDER}/${base.MASTRA_MODEL_NAME}`
      : undefined)

  if (isProduction && !operatorApiKey) {
    throw new Error("MASTRA_OPERATOR_API_KEY is required")
  }

  if (isProduction && !base.MASTRA_STORAGE_URL) {
    throw new Error("MASTRA_STORAGE_URL is required")
  }

  if (isProduction && base.MASTRA_STORAGE_URL === ":memory:") {
    throw new Error("MASTRA_STORAGE_URL must be durable in production")
  }

  const schema = z.object({
    MASTRA_HOST: z.string().default(isProduction ? "0.0.0.0" : "127.0.0.1"),
    MASTRA_PORT: z.coerce.number().int().positive().default(4111),
    MASTRA_SERVICE_API_KEY: secretSchema,
    MASTRA_OPERATOR_API_KEY: secretSchema,
    MASTRA_STORAGE_URL: z.string().min(1),
    MASTRA_MODEL: z.string().min(1),
    MANAGER_BASE_URL: z.string().url(),
    MANAGER_MASTRA_API_KEY: secretSchema,
  })

  const parsed = schema.parse({
    ...base,
    MASTRA_OPERATOR_API_KEY: operatorApiKey,
    MASTRA_MODEL: model,
  })

  return {
    nodeEnv,
    host: parsed.MASTRA_HOST,
    port: parsed.MASTRA_PORT,
    serviceApiKey: parsed.MASTRA_SERVICE_API_KEY,
    operatorApiKey: parsed.MASTRA_OPERATOR_API_KEY,
    storageUrl: parsed.MASTRA_STORAGE_URL,
    model: parsed.MASTRA_MODEL,
    managerBaseUrl: parsed.MANAGER_BASE_URL.replace(/\/+$/, ""),
    managerMastraApiKey: parsed.MANAGER_MASTRA_API_KEY,
    isProduction,
    isCi,
  }
}

export function loadMastraEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): MastraEnv {
  return parseMastraEnv(input)
}

export function testMastraEnv(): MastraEnv {
  return loadMastraEnv({
    CI: "true",
    NODE_ENV: "test",
    MASTRA_SERVICE_API_KEY: "ci-placeholder",
    MASTRA_OPERATOR_API_KEY: "ci-placeholder",
    MASTRA_STORAGE_URL: ":memory:",
    MASTRA_MODEL: "openai/gpt-5-mini",
    MANAGER_BASE_URL: "http://localhost:3002",
    MANAGER_MASTRA_API_KEY: "ci-placeholder",
  })
}
