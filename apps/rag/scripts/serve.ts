import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"

import { loadEnvironmentFiles, parseRuntimeEnv } from "../src/config/env.js"
import { environmentConfigurationError } from "../src/config/environment-error.js"
import { wire } from "../src/main.js"
import { createApp, parseTokenRegistry } from "../src/serving/http/index.js"
import { createGitHubAdmission } from "../src/serving/http/portal-github.js"
import { createPostgresSessionStore } from "../src/adapters/postgres/portal-sessions.js"

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
  const portalKeys = [
    "RAG_PORTAL_DATABASE_URL",
    "RAG_PORTAL_GITHUB_TOKEN",
    "RAG_PORTAL_CLIENT_ID",
    "RAG_PORTAL_CLIENT_SECRET",
    "RAG_PORTAL_CALLBACK_URL",
    "RAG_PORTAL_ORIGIN",
  ] as const
  const configured = portalKeys.filter((key) => !!input[key])
  if (configured.length !== 0 && configured.length !== portalKeys.length)
    throw new Error("portal_configuration_incomplete")
  const sessions = configured.length
    ? createPostgresSessionStore(input.RAG_PORTAL_DATABASE_URL!)
    : undefined
  const portal = sessions
    ? {
        sessions,
        admission: createGitHubAdmission({
          repositoryToken: input.RAG_PORTAL_GITHUB_TOKEN!,
          clientId: input.RAG_PORTAL_CLIENT_ID!,
          clientSecret: input.RAG_PORTAL_CLIENT_SECRET!,
          callbackUrl: input.RAG_PORTAL_CALLBACK_URL!,
        }),
        clientId: input.RAG_PORTAL_CLIENT_ID!,
        callbackUrl: input.RAG_PORTAL_CALLBACK_URL!,
        origin: input.RAG_PORTAL_ORIGIN!,
      }
    : undefined
  const app = createApp({
    retriever: wiring.retriever,
    tokens: parseTokenRegistry(env.SERVE_BEARER_TOKENS),
    portal,
  })
  const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
    console.error(`serve: /v1 listening on :${port}`)
  })

  let closing = false
  const close = (): void => {
    if (closing) return
    closing = true
    server.close(() => {
      void Promise.all([wiring.shutdown(), sessions?.close()]).finally(() =>
        process.exit(0),
      )
    })
  }
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
}

main().catch((error: unknown) => {
  console.error(
    `serve failed error_name=${error instanceof Error ? error.name : "unknown"}`,
  )
  process.exit(1)
})
