import { createTool } from "@mastra/core/tools"

import {
  managerDryRunResponseSchema,
  managerDryRunToolOutputSchema,
  startManagerAutomationDryRunRequestSchema,
  type ManagerDryRunToolOutput,
  type StartManagerAutomationDryRunRequest,
} from "@/contracts/manager-automation-dry-run"

export const MANAGER_AUTOMATION_DRY_RUN_TOOL_ID =
  "manager-automation-dry-run-tool"

export type ManagerDryRunToolDependencies = {
  managerBaseUrl: string
  managerMastraApiKey: string
  fetcher?: typeof fetch
}

export async function callManagerDryRunEndpoint(
  input: StartManagerAutomationDryRunRequest,
  dependencies: ManagerDryRunToolDependencies,
): Promise<ManagerDryRunToolOutput> {
  const fetcher = dependencies.fetcher ?? fetch
  const response = await fetcher(
    `${dependencies.managerBaseUrl}/api/automations/${encodeURIComponent(
      input.automationDocumentId,
    )}/mastra-dry-run`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${dependencies.managerMastraApiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        requestedBy: input.requestedBy,
        idempotencyKey: input.idempotencyKey,
      }),
    },
  )

  const body: unknown = await response.json().catch(() => undefined)
  const parsed = managerDryRunResponseSchema.safeParse(body)

  if (!response.ok || !parsed.success || !parsed.data.ok) {
    throw new Error("Manager dry-run request failed")
  }

  return {
    managerAutomationRunDocumentId: parsed.data.managerAutomationRunDocumentId,
    status: parsed.data.status === "partial" ? "failed" : parsed.data.status,
    reportUrl: parsed.data.reportUrl,
    summary: parsed.data.summary,
  }
}

export function createManagerAutomationDryRunTool(
  dependencies: ManagerDryRunToolDependencies,
) {
  return createTool({
    id: MANAGER_AUTOMATION_DRY_RUN_TOOL_ID,
    description:
      "Calls Manager's dry-run-only automation endpoint. This tool never sends or accepts live run mode.",
    inputSchema: startManagerAutomationDryRunRequestSchema,
    outputSchema: managerDryRunToolOutputSchema,
    execute: async (inputData) =>
      callManagerDryRunEndpoint(inputData, dependencies),
  })
}
