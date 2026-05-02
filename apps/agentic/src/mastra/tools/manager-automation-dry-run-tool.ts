import { createTool } from "@mastra/core/tools"

import {
  managerFailureCodeSchema,
  managerDryRunResponseSchema,
  managerDryRunToolOutputSchema,
  startManagerAutomationDryRunRequestSchema,
  type ManagerFailureCode,
  type ManagerDryRunToolOutput,
  type StartManagerAutomationDryRunRequest,
} from "@/contracts/manager-automation-dry-run"

export const MANAGER_AUTOMATION_DRY_RUN_TOOL_ID =
  "manager-automation-dry-run-tool"

export type ManagerDryRunToolDependencies = {
  managerBaseUrl: string
  managerAgenticApiKey: string
  requestTimeoutMs?: number
  fetcher?: typeof fetch
}

export const DEFAULT_MANAGER_REQUEST_TIMEOUT_MS = 60000

export class ManagerDryRunRequestError extends Error {
  constructor(
    public readonly code: ManagerFailureCode,
    message: string,
  ) {
    super(message)
    this.name = "ManagerDryRunRequestError"
  }
}

export async function callManagerDryRunEndpoint(
  input: StartManagerAutomationDryRunRequest,
  dependencies: ManagerDryRunToolDependencies,
): Promise<ManagerDryRunToolOutput> {
  const fetcher = dependencies.fetcher ?? fetch
  const response = await fetcher(
    `${dependencies.managerBaseUrl}/api/automations/${encodeURIComponent(
      input.automationDocumentId,
    )}/agentic-dry-run`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${dependencies.managerAgenticApiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      signal: AbortSignal.timeout(
        dependencies.requestTimeoutMs ?? DEFAULT_MANAGER_REQUEST_TIMEOUT_MS,
      ),
      body: JSON.stringify({
        requestedBy: input.requestedBy,
        idempotencyKey: input.idempotencyKey,
      }),
    },
  )

  const body: unknown = await response.json().catch(() => undefined)
  const parsed = managerDryRunResponseSchema.safeParse(body)

  if (parsed.success && !parsed.data.ok) {
    const code = managerFailureCodeSchema.safeParse(parsed.data.code)
    if (code.success) {
      throw new ManagerDryRunRequestError(code.data, parsed.data.message)
    }
  }

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
