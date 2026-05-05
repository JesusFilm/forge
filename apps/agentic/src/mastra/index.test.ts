import { describe, expect, it, vi } from "vitest"
import { buildMastra } from "./index"

const env = {
  nodeEnv: "test",
  isCi: true,
  host: "127.0.0.1",
  port: 4111,
  storageUrl: "file:/tmp/forge-agentic-index-test.db",
  operatorApiKey: "operator-key",
  serviceApiKey: "service-key",
  model: "openai/gpt-5-mini",
  managerBaseUrl: "http://localhost:3002",
  managerAgenticApiKey: "manager-agentic-key",
  managerRequestTimeoutMs: 60000,
} as const

type MiddlewareTestContext = {
  req: {
    url: string
    method: string
    header: (name: string) => string | undefined
  }
  json: (body: unknown, status?: number) => Response
}

type TestAuthUser = {
  id: string
  kind: "operator" | "service"
}

type TestAuthConfig = {
  authenticateToken: (token: string) => Promise<TestAuthUser>
  authorize: (
    path: string,
    method: string,
    user: TestAuthUser,
  ) => Promise<boolean>
}

describe("Mastra registry", () => {
  it("registers Manager automation and subtitle enrichment workflows with auth-gated custom routes", () => {
    const instance = buildMastra(env)

    expect(instance.getAgent("managerAutomationAgent").id).toBe(
      "manager-automation-agent",
    )
    expect(instance.getTool("managerAutomationDryRunTool").id).toBe(
      "manager-automation-dry-run-tool",
    )
    expect(instance.getWorkflow("managerAutomationDryRunWorkflow").id).toBe(
      "manager-automation-dry-run-workflow",
    )
    expect(instance.getWorkflow("subtitleEnrichmentWorkflow").id).toBe(
      "subtitle-enrichment-workflow",
    )

    const server = instance.getServer()
    expect(server?.auth).toBeDefined()
    expect(server?.apiRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/forge/manager-automation-dry-run",
          method: "POST",
          requiresAuth: true,
        }),
        expect.objectContaining({
          path: "/forge/subtitle-enrichment-runs",
          method: "POST",
          requiresAuth: true,
        }),
      ]),
    )
  })

  it("allows operator bearer access outside health and dry-run routes", async () => {
    const rootResult = await runGlobalMiddleware({
      path: "/",
      authorization: `Bearer ${env.operatorApiKey}`,
    })
    const apiResult = await runGlobalMiddleware({
      path: "/api/agents",
      authorization: `Bearer ${env.operatorApiKey}`,
    })

    expect(rootResult.next).toHaveBeenCalledOnce()
    expect(rootResult.response).toBeUndefined()
    expect(apiResult.next).toHaveBeenCalledOnce()
    expect(apiResult.response).toBeUndefined()
  })

  it("limits service bearer access to Manager dry-run and subtitle run custom routes", async () => {
    const rootResult = await runGlobalMiddleware({
      path: "/",
      authorization: `Bearer ${env.serviceApiKey}`,
    })
    const dryRunResult = await runGlobalMiddleware({
      path: "/forge/manager-automation-dry-run",
      method: "POST",
      authorization: `Bearer ${env.serviceApiKey}`,
    })
    const subtitleRunResult = await runGlobalMiddleware({
      path: "/forge/subtitle-enrichment-runs",
      method: "POST",
      authorization: `Bearer ${env.serviceApiKey}`,
    })
    const apiResult = await runGlobalMiddleware({
      path: "/api/agents",
      authorization: `Bearer ${env.serviceApiKey}`,
    })

    expect(rootResult.next).not.toHaveBeenCalled()
    expect(rootResult.response?.status).toBe(401)
    expect(apiResult.next).not.toHaveBeenCalled()
    expect(apiResult.response?.status).toBe(401)
    expect(dryRunResult.next).toHaveBeenCalledOnce()
    expect(dryRunResult.response).toBeUndefined()
    expect(subtitleRunResult.next).toHaveBeenCalledOnce()
    expect(subtitleRunResult.response).toBeUndefined()
  })

  it("applies the same operator and service authorization in Mastra auth config", async () => {
    const auth = buildMastra(env).getServer()?.auth as TestAuthConfig
    const operator = await auth.authenticateToken(env.operatorApiKey)
    const service = await auth.authenticateToken(env.serviceApiKey)

    await expect(auth.authorize("/", "GET", operator)).resolves.toBe(true)
    await expect(auth.authorize("/api/agents", "GET", operator)).resolves.toBe(
      true,
    )
    await expect(auth.authorize("/", "GET", service)).resolves.toBe(false)
    await expect(auth.authorize("/api/agents", "GET", service)).resolves.toBe(
      false,
    )
    await expect(
      auth.authorize("/forge/manager-automation-dry-run", "POST", service),
    ).resolves.toBe(true)
    await expect(
      auth.authorize("/forge/subtitle-enrichment-runs", "POST", service),
    ).resolves.toBe(true)
  })

  it("keeps health public through Mastra's built-in health endpoint", async () => {
    const result = await runGlobalMiddleware({ path: "/health" })

    expect(result.next).toHaveBeenCalledOnce()
    expect(result.response).toBeUndefined()
  })

  it("starts subtitle enrichment through the registered Mastra workflow runtime", async () => {
    const server = buildMastra(env).getServer()
    const route = server?.apiRoutes?.find(
      (apiRoute) => apiRoute.path === "/forge/subtitle-enrichment-runs",
    )
    const startAsync = vi.fn().mockResolvedValue({
      runId: "subtitle-enrichment:manager:job-1:subtitle:fr",
    })
    const createRun = vi.fn().mockResolvedValue({ startAsync })
    const mastraRuntime = {
      getWorkflow: vi.fn().mockReturnValue({ createRun }),
    }
    const requestContext = { traceId: "subtitle-runtime-test" }

    const response = await (
      route as unknown as {
        handler: (context: {
          req: { raw: Request }
          get: (key: "mastra" | "requestContext") => unknown
        }) => Promise<Response>
      }
    ).handler({
      req: {
        raw: new Request(
          "http://localhost:4111/forge/subtitle-enrichment-runs",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${env.serviceApiKey}`,
            },
            body: JSON.stringify({
              jobId: "job-1",
              videoDocumentId: "video-1",
              assetId: "asset-1",
              muxAssetId: "mux-asset-1",
              muxPlaybackId: "mux-playback-1",
              sourceLanguage: "en",
              targetLanguage: "fr",
              materialization: {
                mode: "direct_mux_asset_reuse",
                targetEnvironment: "mux-production",
              },
              requestedTranscriptionProvider: "automatic",
              requestedBy: { kind: "service", id: "manager" },
              idempotencyKey: "manager:job-1:subtitle:fr",
            }),
          },
        ),
      },
      get: (key) => (key === "mastra" ? mastraRuntime : requestContext),
    })

    expect(response.status).toBe(202)
    expect(mastraRuntime.getWorkflow).toHaveBeenCalledWith(
      "subtitleEnrichmentWorkflow",
    )
    expect(createRun).toHaveBeenCalledWith({
      runId: "subtitle-enrichment:manager:job-1:subtitle:fr",
      resourceId: "job-1",
    })
    expect(startAsync).toHaveBeenCalledWith({
      inputData: expect.objectContaining({
        jobId: "job-1",
        idempotencyKey: "manager:job-1:subtitle:fr",
      }),
      requestContext,
    })
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
    })
  })
})

async function runGlobalMiddleware({
  path,
  method = "GET",
  authorization,
}: {
  path: string
  method?: string
  authorization?: string
}) {
  const instance = buildMastra(env)
  const registeredMiddleware = instance.getServer()?.middleware
  const middleware = Array.isArray(registeredMiddleware)
    ? registeredMiddleware[0]
    : registeredMiddleware
  if (typeof middleware !== "object" || !("handler" in middleware)) {
    throw new Error("Expected Mastra global middleware to be registered")
  }

  const handler = (
    middleware as unknown as {
      handler: (
        context: MiddlewareTestContext,
        next: () => Promise<void>,
      ) => Promise<Response | undefined>
    }
  ).handler
  const next = vi.fn().mockResolvedValue(undefined)
  const response = await handler(
    {
      req: {
        url: `http://localhost:4111${path}`,
        method,
        header: (name: string) =>
          name.toLowerCase() === "authorization" ? authorization : undefined,
      },
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status }),
    },
    next,
  )

  return { next, response }
}
