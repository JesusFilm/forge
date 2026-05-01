import { describe, expect, it, vi } from "vitest"
import { buildMastra } from "./index"

const env = {
  nodeEnv: "test",
  isCi: true,
  host: "127.0.0.1",
  port: 4111,
  storageUrl: "file:./.mastra/test.db",
  operatorApiKey: "operator-key",
  serviceApiKey: "service-key",
  model: "openai/gpt-5-mini",
  managerBaseUrl: "http://localhost:3002",
  managerMastraApiKey: "manager-mastra-key",
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
  it("registers Manager automation workflow, tool, and auth-gated custom route", () => {
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

    const server = instance.getServer()
    expect(server?.auth).toBeDefined()
    expect(server?.apiRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/forge/manager-automation-dry-run",
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

  it("limits service bearer access to the Manager dry-run custom route", async () => {
    const rootResult = await runGlobalMiddleware({
      path: "/",
      authorization: `Bearer ${env.serviceApiKey}`,
    })
    const dryRunResult = await runGlobalMiddleware({
      path: "/forge/manager-automation-dry-run",
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
  })

  it("keeps health public through Mastra's built-in health endpoint", async () => {
    const result = await runGlobalMiddleware({ path: "/health" })

    expect(result.next).toHaveBeenCalledOnce()
    expect(result.response).toBeUndefined()
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
