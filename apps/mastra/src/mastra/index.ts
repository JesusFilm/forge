import { Mastra } from "@mastra/core"
import { registerApiRoute } from "@mastra/core/server"

import { env, assertMastraRuntimeEnv } from "../config/env"
import { smokeAgent, createSmokeResponse } from "./agents/smoke-agent"
import {
  isValidServiceBearer,
  parseServiceApiKeys,
  unauthorizedJson,
} from "../server/service-bearer"

assertMastraRuntimeEnv()

const serviceKeys = parseServiceApiKeys(env.MASTRA_SERVICE_API_KEYS)

export const mastra = new Mastra({
  agents: { smokeAgent },
  server: {
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
