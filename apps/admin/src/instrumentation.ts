import { env } from "@/config/env"

export function shouldStartWorkflowWorld(): boolean {
  return (
    process.env.NEXT_RUNTIME === "nodejs" &&
    env.WORKFLOW_RUNNER_ENABLED === "true" &&
    env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  )
}

export async function register(): Promise<void> {
  if (!shouldStartWorkflowWorld()) return

  const { getWorld } = await import("workflow/runtime")
  const { startWorkflowWorkerHeartbeat } =
    await import("@/services/workflow-worker-heartbeat.service")
  const { ensureVideoDbBackupSchedulerStarted } =
    await import("@/services/video-db-backup/job")
  const { ensureSearchTraceRetentionSchedulerStarted } =
    await import("@/services/search-trace-retention/job")
  const world = getWorld()
  await world.start?.()
  await startWorkflowWorkerHeartbeat()
  await ensureVideoDbBackupSchedulerStarted()
  await ensureSearchTraceRetentionSchedulerStarted()
}
