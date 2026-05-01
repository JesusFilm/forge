import { Agent } from "@mastra/core/agent"

import { createManagerAutomationDryRunTool } from "@/mastra/tools/manager-automation-dry-run-tool"

export const MANAGER_AUTOMATION_AGENT_ID = "manager-automation-agent"

export function createManagerAutomationAgent({
  managerBaseUrl,
  managerMastraApiKey,
  model,
}: {
  managerBaseUrl: string
  managerMastraApiKey: string
  model: string
}) {
  return new Agent({
    id: MANAGER_AUTOMATION_AGENT_ID,
    name: "Manager Automation Agent",
    instructions:
      "You may orchestrate Manager automation dry runs only. Never request or infer live job creation.",
    model,
    tools: {
      managerAutomationDryRun: createManagerAutomationDryRunTool({
        managerBaseUrl,
        managerMastraApiKey,
      }),
    },
  })
}
