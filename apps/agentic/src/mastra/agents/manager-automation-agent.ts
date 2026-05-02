import { Agent } from "@mastra/core/agent"

import { createManagerAutomationDryRunTool } from "@/mastra/tools/manager-automation-dry-run-tool"

export const MANAGER_AUTOMATION_AGENT_ID = "manager-automation-agent"

export function createManagerAutomationAgent({
  managerBaseUrl,
  managerAgenticApiKey,
  model,
  requestTimeoutMs,
}: {
  managerBaseUrl: string
  managerAgenticApiKey: string
  model: string
  requestTimeoutMs?: number
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
        managerAgenticApiKey,
        requestTimeoutMs,
      }),
    },
  })
}
