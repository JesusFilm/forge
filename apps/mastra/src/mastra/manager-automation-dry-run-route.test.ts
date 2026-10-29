import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { handleManagerAutomationDryRunRequest } from "./manager-automation-dry-run-route"

const body = {
  automationDocumentId: "automation-1",
  requestedBy: { kind: "service" as const, id: "diagnostic-only" },
  idempotencyKey: "request-1",
}
const input = (payload: unknown = body, key = "service-key") =>
  new Request("https://mastra.test/forge-manager-automation-dry-run", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })
describe("Mastra automation service route", () => {
  it("registers workflow/tool and the explicit route using the established service pool", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")
    expect(source).toContain("tools: { managerAutomationDryRunTool }")
    const workflows = source.match(/workflows:\s*\{([\s\S]*?)\n {2}\},/)?.[1]
    expect(workflows).toMatch(/\bmanagerAutomationDryRunWorkflow,/)
    expect(source).toContain(
      'registerApiRoute("/forge-manager-automation-dry-run"',
    )
    expect(source).toMatch(
      /handleManagerAutomationDryRunRequest\(\s*c.req.raw,\s*serviceKeys,?\s*\)/,
    )
  })
  it("authenticates before reading a body or launching workflow", async () => {
    const request = input(body, "invalid")
    const read = vi.spyOn(request.body!, "getReader")
    const launch = vi.fn()
    expect(
      (
        await handleManagerAutomationDryRunRequest(
          request,
          ["service-key"],
          launch,
        )
      ).status,
    ).toBe(401)
    expect(read).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })
  it.each(["live", "dry_run"])(
    "rejects a runMode %s field without launching",
    async (runMode) => {
      const launch = vi.fn()
      expect(
        (
          await handleManagerAutomationDryRunRequest(
            input({ ...body, runMode }),
            ["service-key"],
            launch,
          )
        ).status,
      ).toBe(400)
      expect(launch).not.toHaveBeenCalled()
    },
  )
  it("propagates 409 for an admitted in-flight Manager run", async () => {
    const launch = vi.fn().mockResolvedValue({
      ok: false,
      code: "run_in_progress",
      message: "Manager automation dry run is unavailable.",
    })
    const response = await handleManagerAutomationDryRunRequest(
      input(),
      ["service-key"],
      launch,
    )
    expect(response.status).toBe(409)
    expect(launch).toHaveBeenCalledWith(body)
  })
  it("redacts unexpected runtime exceptions", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("secret provider key"))
    const response = await handleManagerAutomationDryRunRequest(
      input(),
      ["service-key"],
      launch,
    )
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain("secret")
  })
  it("cancels oversized requests before creating a run", async () => {
    const launch = vi.fn(),
      cancel = vi.fn()
    const request = new Request("https://mastra.test", {
      method: "POST",
      headers: {
        authorization: "Bearer service-key",
        "content-type": "application/json",
      },
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(8_193))
        },
        cancel,
      }),
      duplex: "half",
    } as RequestInit)
    expect(
      (
        await handleManagerAutomationDryRunRequest(
          request,
          ["service-key"],
          launch,
        )
      ).status,
    ).toBe(400)
    expect(cancel).toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })
})
