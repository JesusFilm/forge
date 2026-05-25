import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { Mastra } from "@mastra/core"
import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability"
import { registerApiRoute } from "@mastra/core/server"
import { MastraCompositeStore } from "@mastra/core/storage"
import { DuckDBStore } from "@mastra/duckdb"
import { PinoLogger } from "@mastra/loggers"
import {
  MastraStorageExporter,
  Observability,
  SamplingStrategyType,
} from "@mastra/observability"
import { PostgresStore } from "@mastra/pg"

import {
  env,
  assertMastraRuntimeEnv,
  getMastraDatabaseUrl,
  getMastraStorageDir,
} from "../config/env"
import { smokeAgent, createSmokeResponse } from "./agents/smoke-agent"
import {
  handleTranscriptEmbeddingRouteRequest,
  transcriptEmbeddingWorkflow,
} from "./workflows/transcript-embedding"
import {
  handleSceneEmbeddingRouteRequest,
  sceneEmbeddingWorkflow,
} from "./workflows/scene-embedding"
import {
  isValidServiceBearer,
  parseServiceApiKeys,
} from "../server/service-bearer"

assertMastraRuntimeEnv()

const serviceKeys = parseServiceApiKeys(env.MASTRA_SERVICE_API_KEYS)
const storageDir = getMastraStorageDir()
const storageSchemaName = "mastra"

mkdirSync(storageDir, { recursive: true })

const storage = new PostgresStore({
  id: "mastra-postgres-storage",
  connectionString: getMastraDatabaseUrl(),
  schemaName: storageSchemaName,
})
const observabilityStore = new DuckDBStore({
  id: "mastra-observability-storage",
  path: join(storageDir, "mastra-observability.duckdb"),
})

const redactPromptBodies: SpanOutputProcessor = {
  name: "forge-redact-prompt-bodies",
  process(span: AnySpan) {
    span.input = span.input == null ? span.input : "[REDACTED_BY_FORGE]"
    span.output = span.output == null ? span.output : "[REDACTED_BY_FORGE]"
    return span
  },
  shutdown: async () => {},
}

export const mastra = new Mastra({
  agents: { smokeAgent },
  workflows: { transcriptEmbeddingWorkflow, sceneEmbeddingWorkflow },
  logger: new PinoLogger({
    name: "ForgeMastra",
    prettyPrint: env.NODE_ENV !== "production",
    redact: {
      paths: [
        "authorization",
        "headers.authorization",
        "cookie",
        "headers.cookie",
        "*.token",
        "*.secret",
        "*.apiKey",
      ],
      censor: "[REDACTED]",
    },
  }),
  storage: new MastraCompositeStore({
    id: "mastra-storage",
    default: storage,
    domains: {
      observability: observabilityStore.observability,
    },
  }),
  observability: new Observability({
    sensitiveDataFilter: true,
    configs: {
      default: {
        serviceName: "forge-mastra",
        sampling: { type: SamplingStrategyType.ALWAYS },
        logging: { enabled: true, level: "info" },
        spanOutputProcessors: [redactPromptBodies],
        exporters: [new MastraStorageExporter()],
      },
    },
  }),
  server: {
    studioBase: "/studio",
    apiRoutes: [
      registerApiRoute("/forge-smoke", {
        method: "POST",
        handler: async (c) => {
          const authHeader = c.req.header("authorization")
          if (
            !isValidServiceBearer({
              authHeader,
              allowlist: serviceKeys,
            })
          ) {
            return c.json({ error: "Service bearer required" }, 401)
          }

          const body = (await c.req.json().catch(() => ({}))) as {
            input?: unknown
          }
          return c.json(createSmokeResponse(String(body.input ?? "smoke")))
        },
      }),
      registerApiRoute("/forge-transcript-embeddings", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleTranscriptEmbeddingRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-scene-embeddings", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSceneEmbeddingRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
    ],
  },
})
