import { describe, expect, it, vi } from "vitest"

import { launchManagerAutomationDryRunWorkflow } from "./manager-automation-dry-run-workflow"

const request = {
  automationDocumentId: "automation-1",
  requestedBy: { kind: "service" as const, id: "agentic" },
  idempotencyKey: "agentic-run-1",
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  })
}

describe("launchManagerAutomationDryRunWorkflow", () => {
  it("preserves expected Manager not_found errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "not_found",
          message: "Automation not found.",
        },
        { status: 404 },
      ),
    )

    await expect(
      launchManagerAutomationDryRunWorkflow(request, {
        managerBaseUrl: "http://manager.test",
        managerAgenticApiKey: "manager-agentic-key",
        fetcher,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "not_found",
      message: "Automation not found.",
    })
  })

  it("preserves expected Manager invalid_automation errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "invalid_automation",
          message: "Automation cannot be dry-run by Agentic.",
        },
        { status: 400 },
      ),
    )

    await expect(
      launchManagerAutomationDryRunWorkflow(request, {
        managerBaseUrl: "http://manager.test",
        managerAgenticApiKey: "manager-agentic-key",
        fetcher,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_automation",
      message: "Automation cannot be dry-run by Agentic.",
    })
  })

  it("maps invalid Manager responses to manager_unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("not-json", {
        status: 502,
        headers: { "content-type": "text/plain" },
      }),
    )

    await expect(
      launchManagerAutomationDryRunWorkflow(request, {
        managerBaseUrl: "http://manager.test",
        managerAgenticApiKey: "manager-agentic-key",
        fetcher,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "manager_unavailable",
      message: "Manager dry-run service did not return a valid response.",
    })
  })

  it("passes an abort signal to Manager callbacks", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        automationDocumentId: "automation-1",
        managerAutomationRunDocumentId: "run-1",
        status: "success",
        summary: "Dry run complete.",
      }),
    )

    await launchManagerAutomationDryRunWorkflow(request, {
      managerBaseUrl: "http://manager.test",
      managerAgenticApiKey: "manager-agentic-key",
      requestTimeoutMs: 12500,
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
  })
})
