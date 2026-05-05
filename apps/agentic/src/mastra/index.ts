import { Mastra, type Config } from "@mastra/core"
import { registerApiRoute } from "@mastra/core/server"
import { LibSQLStore } from "@mastra/libsql"

import { createManagerAutomationDryRunRoute } from "@/api/manager-automation-dry-run"
import { createSubtitleEnrichmentRunRoute } from "@/api/subtitle-enrichment-run"
import type { StartSubtitleEnrichmentRunRequest } from "@/contracts/subtitle-enrichment-run"
import { loadAgenticEnv, testAgenticEnv, type AgenticEnv } from "@/config/env"
import { createManagerAutomationAgent } from "@/mastra/agents/manager-automation-agent"
import { createManagerAutomationDryRunTool } from "@/mastra/tools/manager-automation-dry-run-tool"
import {
  createManagerAutomationDryRunWorkflow,
  launchManagerAutomationDryRunWorkflow,
} from "@/mastra/workflows/manager-automation-dry-run-workflow"
import {
  createSubtitleEnrichmentWorkflow,
  subtitleEnrichmentRunId,
} from "@/mastra/workflows/subtitle-enrichment-workflow"

export function buildMastra(env: AgenticEnv) {
  return new Mastra(buildMastraConfig(env))
}

type MastraAuthUser = {
  id: string
  kind: "operator" | "service"
}

type SubtitleWorkflowRun = {
  startAsync: (options: {
    inputData: StartSubtitleEnrichmentRunRequest
    requestContext?: unknown
  }) => Promise<{ runId: string }>
}

type SubtitleWorkflowRuntime = {
  createRun: (options: {
    runId: string
    resourceId: string
  }) => Promise<SubtitleWorkflowRun>
}

type MastraRouteRuntime = {
  getWorkflow: (name: "subtitleEnrichmentWorkflow") => SubtitleWorkflowRuntime
}

type ApiRouteContext = {
  req: { raw: Request }
  get: (key: "mastra" | "requestContext") => unknown
}

function buildMastraConfig(env: AgenticEnv): Config {
  const subtitleWorkflowDependencies = {
    managerBaseUrl: env.managerBaseUrl,
    managerAgenticApiKey: env.managerAgenticApiKey,
    requestTimeoutMs: env.managerRequestTimeoutMs,
  }
  const managerAutomationDryRunRoute = createManagerAutomationDryRunRoute({
    serviceApiKey: env.serviceApiKey,
    launchDryRun: (input) =>
      launchManagerAutomationDryRunWorkflow(input, {
        managerBaseUrl: env.managerBaseUrl,
        managerAgenticApiKey: env.managerAgenticApiKey,
        requestTimeoutMs: env.managerRequestTimeoutMs,
      }),
  })
  const subtitleEnrichmentRunRoute = createSubtitleEnrichmentRunRoute({
    serviceApiKey: env.serviceApiKey,
    launchRun: async (input, context) => {
      const mastraRuntime = context?.mastra as MastraRouteRuntime | undefined
      if (!mastraRuntime?.getWorkflow) {
        throw new Error("Mastra runtime is unavailable for subtitle launch.")
      }

      const workflow = mastraRuntime.getWorkflow("subtitleEnrichmentWorkflow")
      const run = await workflow.createRun({
        runId: subtitleEnrichmentRunId(input.idempotencyKey),
        resourceId: input.jobId,
      })
      const started = await run.startAsync({
        inputData: input,
        requestContext: context?.requestContext,
      })

      return {
        ok: true,
        agenticRunId: started.runId,
        managerJobId: input.jobId,
        status: "queued",
        summary: "Subtitle enrichment run queued.",
      }
    },
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
  const subtitleEnrichmentWorkflow = createSubtitleEnrichmentWorkflow(
    subtitleWorkflowDependencies,
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
      subtitleEnrichmentWorkflow,
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
              isServiceRoute(pathname, context.req.method ?? "GET", [
                managerAutomationDryRunRoute,
                subtitleEnrichmentRunRoute,
              ])
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

          return isServiceRoute(path, method, [
            managerAutomationDryRunRoute,
            subtitleEnrichmentRunRoute,
          ])
        },
      },
      apiRoutes: [
        registerApiRoute(managerAutomationDryRunRoute.path, {
          method: managerAutomationDryRunRoute.method,
          requiresAuth: managerAutomationDryRunRoute.requiresAuth,
          handler: async (context: { req: { raw: Request } }) =>
            managerAutomationDryRunRoute.handler(context.req.raw),
        }),
        registerApiRoute(subtitleEnrichmentRunRoute.path, {
          method: subtitleEnrichmentRunRoute.method,
          requiresAuth: subtitleEnrichmentRunRoute.requiresAuth,
          handler: async (context: ApiRouteContext) =>
            subtitleEnrichmentRunRoute.handler(context.req.raw, {
              mastra: context.get("mastra"),
              requestContext: context.get("requestContext"),
            }),
        }),
      ],
    },
  }
}

function isServiceRoute(
  path: string,
  method: string,
  routes: Array<{ path: string; method: string }>,
): boolean {
  return routes.some(
    (route) => path === route.path && method.toUpperCase() === route.method,
  )
}

export const mastra = new Mastra(buildMastraConfig(safeLoadAgenticEnv()))

function safeLoadAgenticEnv() {
  if (process.env.NODE_ENV === "test") {
    return testAgenticEnv()
  }

  return loadAgenticEnv()
}
