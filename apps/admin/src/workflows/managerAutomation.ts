import { getWorkflowMetadata, sleep } from "workflow"

export async function runManagerAutomationScheduler(ledgerId?: string) {
  "use workflow"
  // Old no-argument invocations retire on their next workflow replay too.
  if (!ledgerId) return
  const runtimeId = getWorkflowMetadata().workflowRunId
  while (true) {
    try {
      if ((await stepManagerAutomationTick(ledgerId, runtimeId)) === null)
        return
    } catch {
      /* The next tick recovers expired canonical claims. */
    }
    await sleep("1m")
  }
}
export async function stepManagerAutomationTick(
  ledgerId: string,
  runtimeId: string,
): Promise<{
  claimed: number
  failed: number
} | null> {
  "use step"
  const { prisma } = await import("@/db/client")
  const current = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: "manager-automation-scheduler",
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, runtimeRunId: true },
  })
  // A delayed start after recovery must exit, not accumulate another sleeping
  // timer. Cycle claims remain the independent execution fence.
  if (current?.id !== ledgerId || current.runtimeRunId !== runtimeId)
    return null
  const { env } = await import("@/config/env")
  if (env.MANAGER_AUTOMATIONS_ENABLED !== "true")
    return { claimed: 0, failed: 0 }
  const { runManagerAutomationTick, ManagerAutomationSchedulerError } =
    await import("@/services/manager-automation-scheduler")
  if (!env.MANAGER_API_BASE_URL || !env.MANAGER_AUTOMATION_API_KEY)
    throw new ManagerAutomationSchedulerError(
      "Automation scheduler is not configured",
    )
  return runManagerAutomationTick({
    db: prisma,
    baseUrl: env.MANAGER_API_BASE_URL,
    apiKey: env.MANAGER_AUTOMATION_API_KEY,
  })
}
stepManagerAutomationTick.maxRetries = 0
