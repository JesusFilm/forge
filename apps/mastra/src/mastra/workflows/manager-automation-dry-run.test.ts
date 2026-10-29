import { afterEach, describe, expect, it, vi } from "vitest"
import { Mastra } from "@mastra/core/mastra"
import {
  ManagerAutomationDryRunInputSchema,
  ManagerDryRunResultSchema,
} from "../../contracts/manager-automation-dry-run"
import {
  createManagerAutomationDryRunWorkflow,
  launchManagerAutomationDryRunWorkflow,
} from "./manager-automation-dry-run"

const input = {
  automationDocumentId: "automation-1",
  requestedBy: { kind: "service" as const, id: "test" },
  idempotencyKey: "request-1",
}
const success = {
  ok: true,
  automationDocumentId: "automation-1",
  managerAutomationRunDocumentId: "manager-run-1",
  runMode: "dry_run",
  enqueuedCount: 0,
  status: "partial",
  summary: "Partial report.",
  reportUrl: "/dashboard/agents?automationId=automation-1&runId=manager-run-1",
}
afterEach(() => vi.restoreAllMocks())
describe("committed Manager dry-run workflow", () => {
  it("actually runs its registered tool step, returns matching Zod output, and exposes the real Mastra ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(success))
    const workflow = createManagerAutomationDryRunWorkflow({
      managerBaseUrl: "https://manager.test",
      managerAgenticApiKey: "dry-run-key",
      fetcher,
    })
    const mastra = new Mastra({
      workflows: { managerAutomationDryRunWorkflow: workflow },
    })
    const committed = mastra.getWorkflow("managerAutomationDryRunWorkflow")
    const createRun = vi.spyOn(committed, "createRun")
    const result = await launchManagerAutomationDryRunWorkflow(input, committed)
    expect(result).toMatchObject({
      ...success,
      agenticRunId: expect.any(String),
    })
    expect(createRun).toHaveBeenCalledTimes(1)
    const actualRun = await createRun.mock.results[0].value
    expect(result.ok && result.agenticRunId).toBe(actualRun.runId)
    expect(actualRun.runId).not.toBe(`manager-dry-run:${input.idempotencyKey}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      requestedBy: input.requestedBy,
      idempotencyKey: input.idempotencyKey,
    })
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer dry-run-key" },
    })
  })
  it("uses exactly the tool result schema as the committed workflow output", async () => {
    const workflow = createManagerAutomationDryRunWorkflow({
      managerBaseUrl: "https://manager.test",
      managerAgenticApiKey: "dry-run-key",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(success)),
    })
    const run = await workflow.createRun()
    const outcome = await run.start({
      inputData: ManagerAutomationDryRunInputSchema.parse(input),
    })
    expect(outcome.status).toBe("success")
    if (outcome.status !== "success")
      throw new Error("Expected completed fixture workflow")
    expect(ManagerDryRunResultSchema.parse(outcome.result)).toEqual(success)
  })
  it("rejects live input before creating a Mastra run", async () => {
    const workflow = createManagerAutomationDryRunWorkflow()
    const createRun = vi.spyOn(workflow, "createRun")
    expect(
      await launchManagerAutomationDryRunWorkflow(
        { ...input, runMode: "live" },
        workflow,
      ),
    ).toMatchObject({ ok: false, code: "invalid_automation" })
    expect(createRun).not.toHaveBeenCalled()
  })
  it("returns a safe failure when runtime run creation throws", async () => {
    const workflow = createManagerAutomationDryRunWorkflow()
    vi.spyOn(workflow, "createRun").mockRejectedValue(
      new Error("secret database URL"),
    )
    expect(
      await launchManagerAutomationDryRunWorkflow(input, workflow),
    ).toEqual({
      ok: false,
      code: "mastra_runtime_error",
      message: "Manager automation dry run is unavailable.",
    })
  })
})
