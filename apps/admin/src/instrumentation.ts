import { env } from "@/config/env"

export function shouldStartWorkflowWorld(): boolean {
  return (
    env.NEXT_RUNTIME !== "edge" &&
    env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  )
}

export async function register(): Promise<void> {
  if (!shouldStartWorkflowWorld()) return

  const { getWorld } = await import("workflow/runtime")
  const { startWorkflowWorkerHeartbeat } =
    await import("@/services/workflow-worker-heartbeat.service")
  const world = getWorld()
  await world.start?.()
  await startWorkflowWorkerHeartbeat()
}
