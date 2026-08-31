import { fileURLToPath } from "node:url"

import { resolveProductionEnv } from "../src/config/env.js"
import { runEvaluation } from "./eval.js"

export function installProductionReadEnvironment(
  argv: string[],
  input: NodeJS.ProcessEnv,
): string[] {
  if (argv[0] !== "--target" || argv[1] !== "production-read")
    throw new Error(
      "production evaluation refused: --target production-read is required",
    )
  const expectedHost = input.JFRAG_EXPECTED_POSTGRES_HOST?.trim()
  if (!expectedHost)
    throw new Error(
      "production evaluation refused: JFRAG_EXPECTED_POSTGRES_HOST is required",
    )
  const resolved = resolveProductionEnv(input, { expectHost: expectedHost })
  input.DATABASE_URL = resolved.DATABASE_URL
  input.OPENROUTER_API_KEY = resolved.OPENROUTER_API_KEY
  input.EMBED_MODEL_ID = resolved.EMBED_MODEL_ID
  return argv.slice(2)
}

const invokedPath = process.argv[1]
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    const argv = installProductionReadEnvironment(
      process.argv.slice(2),
      process.env,
    )
    const destination = await runEvaluation(argv, {
      packageDirectory: fileURLToPath(new URL("..", import.meta.url)),
      environment: process.env,
      environmentName: "production-read",
    })
    console.log(`production-read evaluation complete: ${destination}`)
  } catch {
    console.error("production-read evaluation failed (details redacted)")
    process.exitCode = 1
  }
}
