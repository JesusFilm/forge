import { Mastra } from "@mastra/core"
import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability"
import { registerApiRoute } from "@mastra/core/server"
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
} from "../config/env"
import { smokeAgent, createSmokeResponse } from "./agents/smoke-agent"
import {
  isValidServiceBearer,
  parseServiceApiKeys,
  unauthorizedJson,
} from "../server/service-bearer"

assertMastraRuntimeEnv()

const serviceKeys = parseServiceApiKeys(env.MASTRA_SERVICE_API_KEYS)
const storage = new PostgresStore({
  id: "mastra-postgres-storage",
  connectionString: getMastraDatabaseUrl(),
  schemaName: "mastra",
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
  storage,
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
