import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"

import { loadEnvironmentFiles, parseRuntimeEnv } from "../src/config/env.js"
import { environmentConfigurationError } from "../src/config/environment-error.js"
import { wire } from "../src/main.js"
import { createApp, parseTokenRegistry } from "../src/serving/http/index.js"

const packageDirectory = fileURLToPath(new URL("..", import.meta.url))

async function main(): Promise<void> {
  const input = loadEnvironmentFiles(packageDirectory)
  const env = parseRuntimeEnv(input)
  if (!env.SERVE_BEARER_TOKENS) {
    throw environmentConfigurationError(
      "railway_bearer_tokens_required",
      "SERVE_BEARER_TOKENS is required to start the HTTP service",
      "railway",
    )
  }

  const wiring = wire(input)
  const app = createApp({
    retriever: wiring.retriever,
    tokens: parseTokenRegistry(env.SERVE_BEARER_TOKENS),
  })
  const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
    console.error(`serve: /v1 listening on :${port}`)
  })

  let closing = false
  const close = (): void => {
    if (closing) return
    closing = true
    server.close(() => {
      void wiring.shutdown().finally(() => process.exit(0))
    })
  }
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
}

main().catch((error: unknown) => {
  console.error("serve failed", error)
  process.exit(1)
})
