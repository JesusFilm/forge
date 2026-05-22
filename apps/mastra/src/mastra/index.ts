import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { Mastra } from "@mastra/core"
import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability"
import { registerApiRoute } from "@mastra/core/server"
import { MastraCompositeStore } from "@mastra/core/storage"
import { DuckDBStore } from "@mastra/duckdb"
import { LibSQLStore } from "@mastra/libsql"
import { PinoLogger } from "@mastra/loggers"
import {
  MastraStorageExporter,
  Observability,
  SamplingStrategyType,
} from "@mastra/observability"

import { env, assertMastraRuntimeEnv, getMastraStorageDir } from "../config/env"
import { smokeAgent, createSmokeResponse } from "./agents/smoke-agent"
import {
  isValidServiceBearer,
  parseServiceApiKeys,
  unauthorizedJson,
} from "../server/service-bearer"

assertMastraRuntimeEnv()

const serviceKeys = parseServiceApiKeys(env.MASTRA_SERVICE_API_KEYS)
const storageDir = getMastraStorageDir()

mkdirSync(storageDir, { recursive: true })

const runtimeStore = new LibSQLStore({
  id: "mastra-runtime-storage",
  url: `file:${join(storageDir, "mastra-runtime.db")}`,
})
const observabilityStore = new DuckDBStore({
  id: "mastra-observability-storage",
  path: join(storageDir, "mastra-observability.duckdb"),
})

const redactPromptBodies: SpanOutputProcessor = {
  name: "forge-redact-prompt-bodies",
  process(span: AnySpan) {
    return {
      ...span,
      input: span.input == null ? span.input : "[REDACTED_BY_FORGE]",
      output: span.output == null ? span.output : "[REDACTED_BY_FORGE]",
    }
  },
  shutdown: async () => {},
}

export const mastra = new Mastra({
  agents: { smokeAgent },
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
    default: runtimeStore,
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
    ],
    middleware: [
      {
        path: "/api/*",
        handler: async (c, next) => {
          if (
            !isValidServiceBearer({
              authHeader: c.req.header("authorization"),
              allowlist: serviceKeys,
            })
          ) {
            return unauthorizedJson()
          }
          await next()
        },
      },
    ],
  },
})
