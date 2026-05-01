import { Mastra, type Config } from "@mastra/core"
import { registerApiRoute } from "@mastra/core/server"
import { LibSQLStore } from "@mastra/libsql"

import {
  createHealthRoute,
  createManagerAutomationDryRunRoute,
} from "@/api/manager-automation-dry-run"
import { loadMastraEnv, testMastraEnv, type MastraEnv } from "@/config/env"
import {
  MANAGER_AUTOMATION_AGENT_ID,
  createManagerAutomationAgent,
} from "@/mastra/agents/manager-automation-agent"
import {
  MANAGER_AUTOMATION_DRY_RUN_TOOL_ID,
  createManagerAutomationDryRunTool,
} from "@/mastra/tools/manager-automation-dry-run-tool"
import {
  MANAGER_AUTOMATION_DRY_RUN_WORKFLOW_ID,
  createManagerAutomationDryRunWorkflow,
  launchManagerAutomationDryRunWorkflow,
} from "@/mastra/workflows/manager-automation-dry-run-workflow"

export function buildMastra(env: MastraEnv) {
  return new Mastra(buildMastraConfig(env))
}

function buildMastraConfig(env: MastraEnv): Config {
  const managerAutomationDryRunRoute = createManagerAutomationDryRunRoute({
    serviceApiKey: env.serviceApiKey,
    launchDryRun: (input) =>
      launchManagerAutomationDryRunWorkflow(input, {
        managerBaseUrl: env.managerBaseUrl,
        managerMastraApiKey: env.managerMastraApiKey,
      }),
  })
  const healthRoute = createHealthRoute()
  const managerAutomationAgent = createManagerAutomationAgent({
    managerBaseUrl: env.managerBaseUrl,
    managerMastraApiKey: env.managerMastraApiKey,
    model: env.model,
  })
  const managerAutomationDryRunTool = createManagerAutomationDryRunTool({
    managerBaseUrl: env.managerBaseUrl,
    managerMastraApiKey: env.managerMastraApiKey,
  })
  const managerAutomationDryRunWorkflow = createManagerAutomationDryRunWorkflow(
    {
      managerBaseUrl: env.managerBaseUrl,
      managerMastraApiKey: env.managerMastraApiKey,
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
      id: "forge-mastra-runtime",
      url: env.isCi ? ":memory:" : env.storageUrl,
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
            if (
              authorization === `Bearer ${env.operatorApiKey}` ||
              authorization === `Bearer ${env.serviceApiKey}`
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
        authenticateToken: async (token) => {
          if (token === env.operatorApiKey || token === env.serviceApiKey) {
            return { id: "forge-operator" }
          }

          throw new Error("Unauthorized")
        },
      },
      apiRoutes: [
        registerApiRoute(healthRoute.path, {
          method: healthRoute.method,
          requiresAuth: healthRoute.requiresAuth,
          handler: async () => healthRoute.handler(),
        }),
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

export const mastra = new Mastra(buildMastraConfig(safeLoadMastraEnv()))

export const mastraRuntimeConfig = {
  auth: {
    mode: "bearer",
  },
  storage: {
    kind: "libsql",
    ownership: "operational_runtime",
  },
  routes: [
    {
      path: "/health",
      method: "GET",
      requiresAuth: false,
    },
    {
      path: "/forge/manager-automation-dry-run",
      method: "POST",
      requiresAuth: true,
    },
  ],
} as const

export function getRegisteredWorkflowIds(): string[] {
  return [MANAGER_AUTOMATION_DRY_RUN_WORKFLOW_ID]
}

export function getRegisteredToolIds(): string[] {
  return [MANAGER_AUTOMATION_DRY_RUN_TOOL_ID]
}

export function getRegisteredAgentIds(): string[] {
  return [MANAGER_AUTOMATION_AGENT_ID]
}

function safeLoadMastraEnv() {
  if (process.env.NODE_ENV === "test") {
    return testMastraEnv()
  }

  return loadMastraEnv()
}
