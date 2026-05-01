import { z } from "zod"

const envInputSchema = z.object({
  CI: z.string().optional(),
  NODE_ENV: z.string().optional(),
  PORT: z.string().optional(),
  AGENTIC_HOST: z.string().optional(),
  AGENTIC_PORT: z.string().optional(),
  AGENTIC_SERVICE_API_KEY: z.string().optional(),
  AGENTIC_OPERATOR_API_KEY: z.string().optional(),
  AGENTIC_OPERATOR_TOKEN: z.string().optional(),
  AGENTIC_STORAGE_URL: z.string().optional(),
  AGENTIC_MODEL: z.string().optional(),
  AGENTIC_MODEL_PROVIDER: z.string().optional(),
  AGENTIC_MODEL_NAME: z.string().optional(),
  MANAGER_BASE_URL: z.string().optional(),
  MANAGER_AGENTIC_API_KEY: z.string().optional(),
})

const requiredSecret = z.string().min(12)
const ciAllowedSecret = z.string().min(1)

export type AgenticEnv = {
  nodeEnv: string
  host: string
  port: number
  serviceApiKey: string
  operatorApiKey: string
  storageUrl: string
  model: string
  managerBaseUrl: string
  managerAgenticApiKey: string
  isProduction?: boolean
  isCi: boolean
}

export function parseAgenticEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AgenticEnv {
  const base = envInputSchema.parse(input)
  const nodeEnv = base.NODE_ENV ?? "development"
  const isProduction = base.NODE_ENV === "production"
  const isCi = base.CI === "true" || base.CI === "1"
  const secretSchema = isProduction && !isCi ? requiredSecret : ciAllowedSecret
  const operatorApiKey =
    base.AGENTIC_OPERATOR_API_KEY ?? base.AGENTIC_OPERATOR_TOKEN
  const model =
    base.AGENTIC_MODEL ??
    (base.AGENTIC_MODEL_PROVIDER && base.AGENTIC_MODEL_NAME
      ? `${base.AGENTIC_MODEL_PROVIDER}/${base.AGENTIC_MODEL_NAME}`
      : undefined)

  if (isProduction && !operatorApiKey) {
    throw new Error("AGENTIC_OPERATOR_API_KEY is required")
  }

  if (isProduction && !base.AGENTIC_STORAGE_URL) {
    throw new Error("AGENTIC_STORAGE_URL is required")
  }

  if (isProduction && base.AGENTIC_STORAGE_URL === ":memory:") {
    throw new Error("AGENTIC_STORAGE_URL must be durable in production")
  }

  const schema = z.object({
    AGENTIC_HOST: z.string().default(isProduction ? "0.0.0.0" : "127.0.0.1"),
    AGENTIC_PORT: z.coerce.number().int().positive().default(4111),
    AGENTIC_SERVICE_API_KEY: secretSchema,
    AGENTIC_OPERATOR_API_KEY: secretSchema,
    AGENTIC_STORAGE_URL: z.string().min(1),
    AGENTIC_MODEL: z.string().min(1),
    MANAGER_BASE_URL: z.string().url(),
    MANAGER_AGENTIC_API_KEY: secretSchema,
  })

  const parsed = schema.parse({
    ...base,
    AGENTIC_PORT: base.AGENTIC_PORT ?? base.PORT,
    AGENTIC_OPERATOR_API_KEY: operatorApiKey,
    AGENTIC_MODEL: model,
  })

  return {
    nodeEnv,
    host: parsed.AGENTIC_HOST,
    port: parsed.AGENTIC_PORT,
    serviceApiKey: parsed.AGENTIC_SERVICE_API_KEY,
    operatorApiKey: parsed.AGENTIC_OPERATOR_API_KEY,
    storageUrl: parsed.AGENTIC_STORAGE_URL,
    model: parsed.AGENTIC_MODEL,
    managerBaseUrl: parsed.MANAGER_BASE_URL.replace(/\/+$/, ""),
    managerAgenticApiKey: parsed.MANAGER_AGENTIC_API_KEY,
    isProduction,
    isCi,
  }
}

export function loadAgenticEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AgenticEnv {
  return parseAgenticEnv(input)
}

export function testAgenticEnv(): AgenticEnv {
  return loadAgenticEnv({
    CI: "true",
    NODE_ENV: "test",
    AGENTIC_SERVICE_API_KEY: "ci-placeholder",
    AGENTIC_OPERATOR_API_KEY: "ci-placeholder",
    AGENTIC_STORAGE_URL: ":memory:",
    AGENTIC_MODEL: "openai/gpt-5-mini",
    MANAGER_BASE_URL: "http://localhost:3002",
    MANAGER_AGENTIC_API_KEY: "ci-placeholder",
  })
}
