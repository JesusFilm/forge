import { createTool } from "@mastra/core/tools"
import {
  ManagerAutomationDryRunInputSchema,
  ManagerDryRunResultSchema,
} from "../../contracts/manager-automation-dry-run"
import {
  callManagerDryRunEndpoint,
  type ManagerDryRunDependencies,
} from "../../services/manager-automation-dry-run-client"

export function createManagerAutomationDryRunTool(
  dependencies: ManagerDryRunDependencies = {},
) {
  return createTool({
    id: "manager-automation-dry-run-tool",
    description:
      "Request a bounded read-only Manager automation report. No live mode or job execution is supported.",
    inputSchema: ManagerAutomationDryRunInputSchema,
    outputSchema: ManagerDryRunResultSchema,
    execute: async (input) => callManagerDryRunEndpoint(input, dependencies),
  })
}
export const managerAutomationDryRunTool = createManagerAutomationDryRunTool()
