import {
  resolveProductionEnv,
  type ProductionEnv,
} from "../../src/config/env.js"
import { EnvironmentConfigurationError } from "../../src/config/environment-error.js"
import { RagOperationalError } from "../../src/contracts/index.js"

export type ForgeProductionTarget = {
  target: "forge"
  mode: "preview" | "apply"
  databaseHost: string
  databaseName: string
}

/** Explicit Forge mapping: legacy/generic database and model values never enter validation. */
export function installForgeProductionEnvironment(
  input: NodeJS.ProcessEnv,
  write: boolean,
): ForgeProductionTarget {
  const mapped = {
    FORGE_RAG_POSTGRESQL_READONLY_DB_URL:
      input.FORGE_RAG_POSTGRESQL_READONLY_DB_URL,
    FORGE_RAG_POSTGRESQL_DB_URL: input.FORGE_RAG_POSTGRESQL_DB_URL,
    FORGE_RAG_ALLOW_PROD_WRITE: input.FORGE_RAG_ALLOW_PROD_WRITE,
    FORGE_RAG_READONLY_ROLE_NAME: input.FORGE_RAG_READONLY_ROLE_NAME,
    FORGE_RAG_EMBED_MODEL_ID: input.FORGE_RAG_EMBED_MODEL_ID,
    OPENROUTER_API_KEY: input.OPENROUTER_API_KEY,
  }
  let env: ProductionEnv
  try {
    env = resolveProductionEnv(mapped, {
      write,
      expectHost: input.FORGE_RAG_EXPECTED_POSTGRES_HOST,
    })
  } catch (error) {
    if (error instanceof EnvironmentConfigurationError) throw error
    // URL/schema errors must not print the credential or a legacy variable name.
    throw new RagOperationalError(
      "argument_invalid",
      write
        ? "FORGE_RAG_POSTGRESQL_DB_URL must be a valid PostgreSQL URL"
        : "FORGE_RAG_POSTGRESQL_READONLY_DB_URL must be a valid PostgreSQL URL whose login matches FORGE_RAG_READONLY_ROLE_NAME (default forge_rag_evaluator)",
    )
  }
  const database = new URL(env.DATABASE_URL)
  const target: ForgeProductionTarget = {
    target: "forge",
    mode: write ? "apply" : "preview",
    databaseHost: database.hostname,
    databaseName: database.pathname.replace(/^\//, ""),
  }
  Object.assign(input, env)
  return target
}

/** Validate both production signals before a command imports/wires Prisma. */
export function installProductionEnvironment(
  input: NodeJS.ProcessEnv,
  write: boolean,
): void {
  if (!input.FORGE_RAG_EXPECTED_POSTGRES_HOST?.trim())
    throw new Error(
      "production command refused: FORGE_RAG_EXPECTED_POSTGRES_HOST is required before connection",
    )
  const env = resolveProductionEnv(input, {
    write,
    expectHost: input.FORGE_RAG_EXPECTED_POSTGRES_HOST,
  })
  input.DATABASE_URL = env.DATABASE_URL
  input.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY
  input.EMBED_MODEL_ID = env.EMBED_MODEL_ID
}
