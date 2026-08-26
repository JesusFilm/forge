import { readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

export const DEFAULT_EMBED_MODEL_ID = "qwen/qwen3-embedding-8b"
export const DEFAULT_LANG_DETECT_MODEL_ID = "google/gemini-2.5-flash-lite"

type EnvironmentInput = Record<string, string | undefined>

export function parseEnvironmentFile(text: string): EnvironmentInput {
  const parsed: EnvironmentInput = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const equals = trimmed.indexOf("=")
    if (equals === -1) continue
    const key = trimmed.slice(0, equals).trim()
    let value = trimmed.slice(equals + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

/** Load package-local files without overriding injected process values. */
export function loadEnvironmentFiles(
  packageDirectory: string,
  injected: EnvironmentInput = process.env,
): EnvironmentInput {
  const loaded = { ...injected }
  for (const filename of [".env.local", ".env"]) {
    const filePath = join(packageDirectory, filename)
    let text: string
    try {
      text = readFileSync(filePath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
    const values = parseEnvironmentFile(text)
    for (const [key, value] of Object.entries(values)) {
      if (loaded[key] === undefined) loaded[key] = value
    }
  }
  return loaded
}

const emptyAsUnset = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema,
  )

const positiveInteger = (name: string, fallback: number) =>
  z.coerce
    .number({ error: `${name} must be a positive integer` })
    .int(`${name} must be a positive integer`)
    .positive(`${name} must be a positive integer`)
    .default(fallback)

const postgresUrl = z
  .string()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol
      return protocol === "postgres:" || protocol === "postgresql:"
    },
    { message: "must be a Postgres URL" },
  )

const bearerTokenConfig = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
)

function validBearerTokenConfig(value: string): boolean {
  try {
    return bearerTokenConfig.safeParse(JSON.parse(value)).success
  } catch {
    return false
  }
}

const runtimeEnvSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    OPENROUTER_API_KEY: z.string().trim().min(1),
    EMBED_MODEL_ID: z.string().trim().min(1).default(DEFAULT_EMBED_MODEL_ID),
    EMBED_MAX_ATTEMPTS: positiveInteger("EMBED_MAX_ATTEMPTS", 10),
    EMBED_TIMEOUT_MS: positiveInteger("EMBED_TIMEOUT_MS", 120_000),
    QUERY_EMBED_MAX_ATTEMPTS: positiveInteger("QUERY_EMBED_MAX_ATTEMPTS", 2),
    QUERY_EMBED_TIMEOUT_MS: positiveInteger("QUERY_EMBED_TIMEOUT_MS", 4_000),
    EMBED_BASE_URL: emptyAsUnset(z.string().url().optional()),
    EMBED_API_KEY: emptyAsUnset(z.string().trim().min(1).optional()),
    EMBED_WIRE_MODEL_ID: emptyAsUnset(z.string().trim().min(1).optional()),
    EMBED_QUERY_INSTRUCTION: emptyAsUnset(z.string().trim().min(1).optional()),
    EMBED_TRUNCATE_DIMENSIONS: emptyAsUnset(z.string().optional()).transform(
      (value) => value === "true" || value === "1",
    ),
    LANG_DETECT_MODEL_ID: z
      .string()
      .trim()
      .min(1)
      .default(DEFAULT_LANG_DETECT_MODEL_ID),
    LANG_DETECT_BASE_URL: emptyAsUnset(z.string().url().optional()),
    LANG_DETECT_MAX_ATTEMPTS: positiveInteger("LANG_DETECT_MAX_ATTEMPTS", 10),
    LANGUAGE_SWEEP_OUT_DIR: emptyAsUnset(z.string().trim().min(1).optional()),
    FIRECRAWL_API_KEY: emptyAsUnset(z.string().trim().min(1).optional()),
    PORT: positiveInteger("PORT", 8080),
    SERVE_BEARER_TOKENS: emptyAsUnset(z.string().trim().min(1).optional()),
  })
  .superRefine((value, context) => {
    if (value.EMBED_BASE_URL && !value.EMBED_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["EMBED_API_KEY"],
        message:
          "required when EMBED_BASE_URL is set; OPENROUTER_API_KEY only covers the fallback provider",
      })
    }
    if (
      value.SERVE_BEARER_TOKENS &&
      !validBearerTokenConfig(value.SERVE_BEARER_TOKENS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["SERVE_BEARER_TOKENS"],
        message:
          'must be a JSON object mapping each token to a non-empty source-key array; ["*"] grants all sources',
      })
    }
  })

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>

/**
 * Preserve the source repository's deliberate safety boundary. The OpenRouter
 * spend key is environment-agnostic, so its namespaced Doppler value may fill
 * the plain name. Production DB, model, and bearer values never fall through
 * here; production-intent callers must opt in via resolveProductionEnv().
 */
export function applyNamespacedEnvFallbacks(
  env: EnvironmentInput = process.env,
): void {
  if (!env.OPENROUTER_API_KEY?.trim() && env.JFRAG_OPENROUTER_API_KEY?.trim()) {
    env.OPENROUTER_API_KEY = env.JFRAG_OPENROUTER_API_KEY
  }
}

export function parseRuntimeEnv(input: EnvironmentInput): RuntimeEnv {
  const candidate = { ...input }
  applyNamespacedEnvFallbacks(candidate)
  return runtimeEnvSchema.parse(candidate)
}

const smokeEnvSchema = z.object({
  SMOKE_BASE_URL: z.string().url().default("http://localhost:8080"),
  SMOKE_TOKEN: z.string().trim().min(1),
  SMOKE_MAX_MS: positiveInteger("SMOKE_MAX_MS", 15_000),
})

export type SmokeEnv = z.infer<typeof smokeEnvSchema>

export function parseSmokeEnv(input: EnvironmentInput): SmokeEnv {
  return smokeEnvSchema.parse(input)
}

export const ENVIRONMENT_TARGETS = [
  "local",
  "ci",
  "railway",
  "firecrawl",
  "language-sweep",
  "eval",
  "smoke",
  "dashboard",
  "production-read",
  "production-write",
] as const

export type EnvironmentTarget = (typeof ENVIRONMENT_TARGETS)[number]

export function assertEnvironmentForTarget(
  input: EnvironmentInput,
  target: EnvironmentTarget,
): RuntimeEnv | SmokeEnv | ProductionEnv | DashboardDatabase {
  if (target === "smoke") return parseSmokeEnv(input)
  if (target === "dashboard") return resolveDashboardDatabase(input)
  if (target === "production-read") return resolveProductionEnv(input)
  if (target === "production-write") {
    return resolveProductionEnv(input, { write: true })
  }

  const env = parseRuntimeEnv(input)
  if (target === "railway" && !env.SERVE_BEARER_TOKENS) {
    throw new Error("SERVE_BEARER_TOKENS is required for the Railway service")
  }
  if (target === "firecrawl" && !env.FIRECRAWL_API_KEY) {
    throw new Error(
      "FIRECRAWL_API_KEY is required when acquiring a Firecrawl-backed source",
    )
  }
  return env
}

export type ProductionEnv = {
  DATABASE_URL: string
  OPENROUTER_API_KEY: string
  EMBED_MODEL_ID: string
}

function firstPresent(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => value?.trim())?.trim()
}

export function resolveProductionEnv(
  input: EnvironmentInput,
  options: { write?: boolean; expectHost?: string } = {},
): ProductionEnv {
  if (options.write && input.JFRAG_ALLOW_PROD_WRITE !== "1") {
    throw new Error(
      "production write refused: set JFRAG_ALLOW_PROD_WRITE=1 as the second deliberate signal",
    )
  }

  const databaseUrl = firstPresent(
    input.DATABASE_URL,
    input.JFRAG_POSTGRESQL_DB_URL,
  )
  const openrouterKey = firstPresent(
    input.OPENROUTER_API_KEY,
    input.JFRAG_OPENROUTER_API_KEY,
  )
  const embedModel =
    firstPresent(input.EMBED_MODEL_ID, input.JFRAG_OPENROUTER_EMBED_MODEL_ID) ??
    DEFAULT_EMBED_MODEL_ID

  if (!databaseUrl) throw new Error("DATABASE_URL is required for production")
  const parsedDatabaseUrl = postgresUrl.parse(databaseUrl)
  if (!openrouterKey) {
    throw new Error("OPENROUTER_API_KEY is required for production")
  }

  if (
    options.expectHost &&
    !new URL(parsedDatabaseUrl).hostname.includes(options.expectHost)
  ) {
    throw new Error(
      `expected database host does not match the resolved host; aborting before connection`,
    )
  }

  return {
    DATABASE_URL: parsedDatabaseUrl,
    OPENROUTER_API_KEY: openrouterKey,
    EMBED_MODEL_ID: embedModel,
  }
}

export type DashboardDatabase = {
  url: string
  source: "JFRAG_POSTGRESQL_DB_URL" | "DATABASE_URL"
}

export function resolveDashboardDatabase(
  input: EnvironmentInput,
  options: { allowDev?: boolean } = {},
): DashboardDatabase {
  const namespaced = input.JFRAG_POSTGRESQL_DB_URL?.trim()
  if (namespaced) {
    return {
      url: postgresUrl.parse(namespaced),
      source: "JFRAG_POSTGRESQL_DB_URL",
    }
  }

  const generic = input.DATABASE_URL?.trim()
  if (!generic) {
    throw new Error("JFRAG_POSTGRESQL_DB_URL is required for a dashboard read")
  }
  if (!options.allowDev) {
    throw new Error(
      "Refusing a production dashboard snapshot from DATABASE_URL; use the explicit namespaced production credential",
    )
  }
  return { url: postgresUrl.parse(generic), source: "DATABASE_URL" }
}

export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl)
    const user = parsed.username || "?"
    const host = parsed.hostname || "?"
    const port = parsed.port ? `:${parsed.port}` : ""
    const database = parsed.pathname.replace(/^\//, "") || "?"
    return `${parsed.protocol}//${user}:***@${host}${port}/${database}`
  } catch {
    return "(unparseable)"
  }
}
