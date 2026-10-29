import { createStep, createWorkflow } from "@mastra/core/workflows"
import {
  ManagerAutomationDryRunInputSchema,
  ManagerAutomationDryRunResultSchema,
  ManagerDryRunResultSchema,
  type ManagerAutomationDryRunResult,
} from "../../contracts/manager-automation-dry-run"
import {
  managerDryRunFailure,
  type ManagerDryRunDependencies,
} from "../../services/manager-automation-dry-run-client"
import { createManagerAutomationDryRunTool } from "../tools/manager-automation-dry-run"

export function createManagerAutomationDryRunWorkflow(
  dependencies: ManagerDryRunDependencies = {},
) {
  const step = createStep(createManagerAutomationDryRunTool(dependencies))
  return createWorkflow({
    id: "manager-automation-dry-run-workflow",
    inputSchema: ManagerAutomationDryRunInputSchema,
    outputSchema: ManagerDryRunResultSchema,
  })
    .then(step)
    .commit()
}
export const managerAutomationDryRunWorkflow =
  createManagerAutomationDryRunWorkflow()

/** Launch the actual committed workflow; the compatibility field contains its real Mastra run ID. */
export async function launchManagerAutomationDryRunWorkflow(
  rawInput: unknown,
  workflow = managerAutomationDryRunWorkflow,
): Promise<ManagerAutomationDryRunResult> {
  const parsed = ManagerAutomationDryRunInputSchema.safeParse(rawInput)
  if (!parsed.success) return managerDryRunFailure("invalid_automation")
  try {
    const run = await workflow.createRun()
    const outcome = await run.start({ inputData: parsed.data })
    if (outcome.status !== "success")
      return managerDryRunFailure("mastra_runtime_error")
    const result = ManagerDryRunResultSchema.safeParse(outcome.result)
    if (!result.success) return managerDryRunFailure("mastra_runtime_error")
    return ManagerAutomationDryRunResultSchema.parse(
      result.data.ok
        ? { ...result.data, agenticRunId: run.runId }
        : result.data,
    )
  } catch {
    return managerDryRunFailure("mastra_runtime_error")
  }
}
