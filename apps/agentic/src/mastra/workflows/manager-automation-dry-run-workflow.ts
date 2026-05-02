import { createStep, createWorkflow } from "@mastra/core/workflows"

import {
  startManagerAutomationDryRunRequestSchema,
  startManagerAutomationDryRunResponseSchema,
  type StartManagerAutomationDryRunRequest,
  type StartManagerAutomationDryRunResponse,
} from "@/contracts/manager-automation-dry-run"
import {
  callManagerDryRunEndpoint,
  createManagerAutomationDryRunTool,
  ManagerDryRunRequestError,
  type ManagerDryRunToolDependencies,
} from "@/mastra/tools/manager-automation-dry-run-tool"

export const MANAGER_AUTOMATION_DRY_RUN_WORKFLOW_ID =
  "manager-automation-dry-run-workflow"

export async function launchManagerAutomationDryRunWorkflow(
  input: StartManagerAutomationDryRunRequest,
  dependencies: ManagerDryRunToolDependencies,
): Promise<StartManagerAutomationDryRunResponse> {
  const runId = `manager-dry-run:${input.idempotencyKey}`

  try {
    const managerResult = await callManagerAutomationDryRunTool(
      input,
      dependencies,
    )

    return {
      ok: true,
      agenticRunId: runId,
      managerAutomationRunDocumentId:
        managerResult.managerAutomationRunDocumentId,
      status: managerResult.status,
      reportUrl: managerResult.reportUrl,
      summary: managerResult.summary,
    }
  } catch (error) {
    if (error instanceof ManagerDryRunRequestError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
      }
    }

    return {
      ok: false,
      code: "manager_unavailable",
      message: "Manager dry-run service did not return a valid response.",
    }
  }
}

export function createManagerAutomationDryRunWorkflow(
  dependencies: ManagerDryRunToolDependencies,
) {
  const managerDryRunTool = createManagerAutomationDryRunTool(dependencies)
  const callManagerDryRunStep = createStep(managerDryRunTool)

  return createWorkflow({
    id: MANAGER_AUTOMATION_DRY_RUN_WORKFLOW_ID,
    inputSchema: startManagerAutomationDryRunRequestSchema,
    outputSchema: startManagerAutomationDryRunResponseSchema,
    steps: [callManagerDryRunStep],
  })
    .then(callManagerDryRunStep)
    .commit()
}

async function callManagerAutomationDryRunTool(
  input: StartManagerAutomationDryRunRequest,
  dependencies: ManagerDryRunToolDependencies,
) {
  return callManagerDryRunEndpoint(input, dependencies)
}
