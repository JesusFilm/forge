import { Mastra, type Config } from "@mastra/core"
import { registerApiRoute } from "@mastra/core/server"
import { LibSQLStore } from "@mastra/libsql"

import { createManagerAutomationDryRunRoute } from "@/api/manager-automation-dry-run"
import { loadAgenticEnv, testAgenticEnv, type AgenticEnv } from "@/config/env"
import { createManagerAutomationAgent } from "@/mastra/agents/manager-automation-agent"
import { createManagerAutomationDryRunTool } from "@/mastra/tools/manager-automation-dry-run-tool"
import {
  createManagerAutomationDryRunWorkflow,
  launchManagerAutomationDryRunWorkflow,
} from "@/mastra/workflows/manager-automation-dry-run-workflow"

export function buildMastra(env: AgenticEnv) {
  return new Mastra(buildMastraConfig(env))
}

type MastraAuthUser = {
  id: string
  kind: "operator" | "service"
}

function buildMastraConfig(env: AgenticEnv): Config {
  const managerAutomationDryRunRoute = createManagerAutomationDryRunRoute({
    serviceApiKey: env.serviceApiKey,
    launchDryRun: (input) =>
      launchManagerAutomationDryRunWorkflow(input, {
        managerBaseUrl: env.managerBaseUrl,
        managerAgenticApiKey: env.managerAgenticApiKey,
        requestTimeoutMs: env.managerRequestTimeoutMs,
      }),
  })
  const managerAutomationAgent = createManagerAutomationAgent({
    managerBaseUrl: env.managerBaseUrl,
    managerAgenticApiKey: env.managerAgenticApiKey,
    model: env.model,
    requestTimeoutMs: env.managerRequestTimeoutMs,
  })
  const managerAutomationDryRunTool = createManagerAutomationDryRunTool({
    managerBaseUrl: env.managerBaseUrl,
    managerAgenticApiKey: env.managerAgenticApiKey,
    requestTimeoutMs: env.managerRequestTimeoutMs,
  })
  const managerAutomationDryRunWorkflow = createManagerAutomationDryRunWorkflow(
    {
      managerBaseUrl: env.managerBaseUrl,
      managerAgenticApiKey: env.managerAgenticApiKey,
      requestTimeoutMs: env.managerRequestTimeoutMs,
    },
  )

  return {
    agents: {
      managerAutomationAgent,
    },
    tools: {
      managerAutomationDryRunTool,
    },
    workflows: {
      managerAutomationDryRunWorkflow,
    },
    storage: new LibSQLStore({
      id: "agentic-runtime",
      url: env.storageUrl,
    }),
    server: {
      host: env.host,
      port: env.port,
      middleware: [
        {
          path: "/*",
          handler: async (
            context: {
              req: {
                url: string
                method?: string
                header: (name: string) => string | undefined
              }
              json: (body: unknown, status?: number) => Response
            },
            next: () => Promise<void>,
          ) => {
            const pathname = new URL(context.req.url).pathname
            if (pathname === "/health") {
              await next()
              return
            }

            const authorization = context.req.header("authorization")
            if (authorization === `Bearer ${env.operatorApiKey}`) {
              await next()
              return
            }

            if (
              authorization === `Bearer ${env.serviceApiKey}` &&
              pathname === managerAutomationDryRunRoute.path &&
              (context.req.method ?? "GET").toUpperCase() ===
                managerAutomationDryRunRoute.method
            ) {
              await next()
              return
            }

            return context.json(
              {
                ok: false,
                code: "unauthorized",
                message: "Mastra Studio/API access requires bearer auth.",
              },
              401,
            )
          },
        },
      ],
      auth: {
        public: [["/health", "GET"]],
        protected: [/.*/],
        authenticateToken: async (token): Promise<MastraAuthUser> => {
          if (token === env.operatorApiKey) {
            return { id: "forge-operator", kind: "operator" }
          }

          if (token === env.serviceApiKey) {
            return { id: "forge-service", kind: "service" }
          }

          throw new Error("Unauthorized")
        },
        authorize: async (path, method, user: MastraAuthUser) => {
          if (user.kind === "operator") {
            return true
          }

          return (
            path === managerAutomationDryRunRoute.path &&
            method.toUpperCase() === managerAutomationDryRunRoute.method
          )
        },
      },
      apiRoutes: [
        registerApiRoute(managerAutomationDryRunRoute.path, {
          method: managerAutomationDryRunRoute.method,
          requiresAuth: managerAutomationDryRunRoute.requiresAuth,
          handler: async (context: { req: { raw: Request } }) =>
            managerAutomationDryRunRoute.handler(context.req.raw),
        }),
      ],
    },
  }
}

export const mastra = new Mastra(buildMastraConfig(safeLoadAgenticEnv()))

function safeLoadAgenticEnv() {
  if (process.env.NODE_ENV === "test") {
    return testAgenticEnv()
  }

  return loadAgenticEnv()
}
