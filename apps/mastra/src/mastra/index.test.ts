import { describe, expect, it } from "vitest"
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
          path: "/health",
          method: "GET",
          requiresAuth: false,
        }),
        expect.objectContaining({
          path: "/forge/manager-automation-dry-run",
          method: "POST",
          requiresAuth: true,
        }),
      ]),
    )
  })
})
