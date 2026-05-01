import { describe, expect, it, vi } from "vitest"
import { createManagerAutomationDryRunRoute } from "./manager-automation-dry-run"

function jsonRequest(input: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost:4111/forge/manager-automation-dry-run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer service-key",
      ...headers,
    },
    body: JSON.stringify(input),
  })
}

const validDryRunRequest = {
  automationDocumentId: "automation-1",
  requestedBy: { kind: "manager_user", id: "42" },
  idempotencyKey: "manager:automation-1:dry-run",
}

describe("manager automation dry-run API route", () => {
  it("rejects invalid service bearer tokens before workflow launch", async () => {
    const launcher = vi.fn()
    const route = createManagerAutomationDryRunRoute({
      serviceApiKey: "service-key",
      launchDryRun: launcher,
    })

    const response = await route.handler(
      jsonRequest(validDryRunRequest, {
        authorization: "Bearer wrong-key",
      }),
    )

    expect(response.status).toBe(401)
    expect(launcher).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "unauthorized",
    })
  })

  it("rejects malformed payloads before workflow launch", async () => {
    const launcher = vi.fn()
    const route = createManagerAutomationDryRunRoute({
      serviceApiKey: "service-key",
      launchDryRun: launcher,
    })

    const response = await route.handler(jsonRequest({ runMode: "live" }))

    expect(response.status).toBe(400)
    expect(launcher).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_automation",
    })
  })

  it("launches valid dry-run requests with idempotency key", async () => {
    const launcher = vi.fn().mockResolvedValue({
      ok: true,
      mastraRunId: "mastra-run-1",
      managerAutomationRunDocumentId: "manager-run-1",
      status: "success",
      summary: "Dry run completed.",
    })
    const route = createManagerAutomationDryRunRoute({
      serviceApiKey: "service-key",
      launchDryRun: launcher,
    })

    const response = await route.handler(jsonRequest(validDryRunRequest))

    expect(response.status).toBe(200)
    expect(launcher).toHaveBeenCalledWith(
      expect.objectContaining({
        automationDocumentId: "automation-1",
        idempotencyKey: "manager:automation-1:dry-run",
      }),
    )
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      managerAutomationRunDocumentId: "manager-run-1",
    })
  })
})
