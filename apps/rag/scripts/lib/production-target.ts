import { resolveProductionEnv } from "../../src/config/env.js"

/** Validate both production signals before a command imports/wires Prisma. */
export function installProductionEnvironment(
  input: NodeJS.ProcessEnv,
  write: boolean,
): void {
  if (!input.JFRAG_EXPECTED_POSTGRES_HOST?.trim())
    throw new Error(
      "production command refused: JFRAG_EXPECTED_POSTGRES_HOST is required before connection",
    )
  const env = resolveProductionEnv(input, {
    write,
    expectHost: input.JFRAG_EXPECTED_POSTGRES_HOST,
  })
  input.DATABASE_URL = env.DATABASE_URL
  input.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY
  input.EMBED_MODEL_ID = env.EMBED_MODEL_ID
}
