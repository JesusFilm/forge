import { PostgresUsageStore } from "../src/adapters/postgres/consumer-usage.js"
import { UsageCollector } from "../src/serving/http/usage.js"
import { reportAuthorizer } from "../src/serving/http/usage-report-auth.js"
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"

import { loadEnvironmentFiles, parseRuntimeEnv } from "../src/config/env.js"
import { environmentConfigurationError } from "../src/config/environment-error.js"
import { wire } from "../src/main.js"
import { createApp, parseTokenRegistry } from "../src/serving/http/index.js"
import { createGitHubAdmission } from "../src/serving/http/portal-github.js"
import { createPostgresSessionStore } from "../src/adapters/postgres/portal-sessions.js"
import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresConsumerAuthenticator } from "../src/adapters/postgres/consumer-auth.js"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { allSources } from "../src/registry/index.js"

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
    throw environmentConfigurationError(
      "portal_configuration_incomplete",
      "portal configuration is incomplete",
      "railway",
    )
  const sessions = configured.length
    ? createPostgresSessionStore(input.RAG_PORTAL_DATABASE_URL!)
    : undefined
  const consumerWriterUrl = input.RAG_CONSUMER_WRITER_DATABASE_URL
  const consumerReaderUrl = input.RAG_CONSUMER_AUTH_DATABASE_URL
  if (!!consumerWriterUrl !== !!consumerReaderUrl)
    throw environmentConfigurationError(
      "consumer_access_configuration_incomplete",
      "consumer access requires both database URLs",
      "railway",
    )
  const consumerWriter = consumerWriterUrl
    ? new PrismaClient({ datasourceUrl: consumerWriterUrl })
    : undefined
  const consumerReader = consumerReaderUrl
    ? new PrismaClient({ datasourceUrl: consumerReaderUrl })
    : undefined
  const consumers = consumerWriter
    ? new PostgresConsumerAccess(consumerWriter)
    : undefined
  const consumerAuth = consumerReader
    ? new PostgresConsumerAuthenticator(consumerReader)
    : undefined
  if (consumers && !sessions)
    throw environmentConfigurationError(
      "consumer_access_requires_portal",
      "consumer access requires portal admission",
      "railway",
    )
  const allowedSourceKeys = (input.RAG_DEFAULT_CONSUMER_SOURCE_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
  const registeredSources = new Set(allSources().map((source) => source.key))
  if (
    new Set(allowedSourceKeys).size !== allowedSourceKeys.length ||
    allowedSourceKeys.some((key) => !registeredSources.has(key))
  )
    throw environmentConfigurationError(
      "consumer_source_scope_invalid",
      "consumer source scope is invalid",
      "railway",
    )
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
        consumers,
        allowedSourceKeys,
      }
    : undefined
  const usageWriterUrl = input.RAG_USAGE_WRITER_DATABASE_URL
  const deploymentId =
    input.RAILWAY_DEPLOYMENT_ID ?? input.RAG_USAGE_DEPLOYMENT_ID
  const usageReaderUrl = input.RAG_USAGE_REPORT_DATABASE_URL
  const reportHashes = input.RAG_USAGE_REPORT_TOKEN_HASHES
  if (
    !!usageReaderUrl !== !!reportHashes ||
    (usageReaderUrl && !usageWriterUrl) ||
    (usageWriterUrl &&
      (!consumerAuth ||
        !deploymentId ||
        !/^[A-Za-z0-9-]{1,80}$/.test(deploymentId)))
  )
    throw environmentConfigurationError(
      "usage_configuration_incomplete",
      "usage configuration is incomplete",
      "railway",
    )
  const usageWriter = usageWriterUrl
    ? new PrismaClient({ datasourceUrl: usageWriterUrl })
    : undefined
  const usageReader = usageReaderUrl
    ? new PrismaClient({ datasourceUrl: usageReaderUrl })
    : undefined
  const usage = usageWriter
    ? new UsageCollector(new PostgresUsageStore(usageWriter, deploymentId))
    : undefined
  await usage?.start()
  if (
    usageReader &&
    reportHashes &&
    Object.hasOwn(JSON.parse(reportHashes), "ragbot")
  ) {
    const ragbotId = input.RAG_USAGE_RAGBOT_CONSUMER_ID ?? ""
    if (!/^[0-9a-f-]{36}$/i.test(ragbotId))
      throw environmentConfigurationError(
        "usage_configuration_incomplete",
        "RAGBot registration is required before its report grant",
        "railway",
      )
    const rows = await usageReader.$queryRaw<
      Array<{ consumer_id: string }>
    >`SELECT consumer_id FROM usage_private.consumer_labels WHERE consumer_id=${ragbotId}::uuid`
    if (!rows.length)
      throw environmentConfigurationError(
        "usage_configuration_incomplete",
        "RAGBot registration is required before its report grant",
        "railway",
      )
  }
  const usageReport =
    usageReader && reportHashes
      ? {
          reader: new PostgresUsageStore(usageReader),
          authorize: reportAuthorizer(reportHashes),
        }
      : undefined
  const app = createApp({
    retriever: wiring.retriever,
    tokens: parseTokenRegistry(env.SERVE_BEARER_TOKENS),
    portal,
    consumerAuth,
    usage,
    usageReport,
  })
  const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
    console.error(`serve: /v1 listening on :${port}`)
  })

  let closing = false
  const close = (): void => {
    if (closing) return
    closing = true
    server.close(() => {
      void Promise.all([
        usage?.stop().then(() => usageWriter?.$disconnect()),
        usageReader?.$disconnect(),
        wiring.shutdown(),
        sessions?.close(),
        consumerWriter?.$disconnect(),
        consumerReader?.$disconnect(),
      ]).finally(() => process.exit(0))
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
