import { isTransientWorkflowStartupError } from "./instrumentation"

type WorkflowStartupState = {
  retryTimer?: ReturnType<typeof setTimeout>
  started: boolean
  starting: boolean
}

function workflowStartupGlobal() {
  return globalThis as typeof globalThis & {
    __forgeAdminWorkflowStartup?: WorkflowStartupState
  }
}

function workflowStartupState() {
  const current = workflowStartupGlobal().__forgeAdminWorkflowStartup
  if (current) return current

  const state: WorkflowStartupState = {
    started: false,
    starting: false,
  }
  workflowStartupGlobal().__forgeAdminWorkflowStartup = state
  return state
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function maxTransientWorkflowStartupAttempts() {
  return positiveIntegerEnv("WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS", 12)
}

function transientWorkflowStartupDelayMs() {
  return positiveIntegerEnv("WORKFLOW_STARTUP_TRANSIENT_DELAY_MS", 10_000)
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function startWorkflowWorld(): Promise<void> {
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

function scheduleWorkflowStartupRetry(attempt: number) {
  const state = workflowStartupState()
  const delayMs = transientWorkflowStartupDelayMs()

  state.retryTimer = setTimeout(() => {
    void startWorkflowWorldWithTransientRetry(attempt)
  }, delayMs)
  state.retryTimer.unref?.()
}

export async function startWorkflowWorldWithTransientRetry(
  attempt = 1,
): Promise<void> {
  const state = workflowStartupState()
  if (state.started || state.starting) return

  state.starting = true
  try {
    await startWorkflowWorld()
    state.started = true
  } catch (error) {
    const isTransient = isTransientWorkflowStartupError(error)
    const maxAttempts = maxTransientWorkflowStartupAttempts()

    if (!isTransient || attempt >= maxAttempts) {
      throw error
    }

    process.stderr.write(
      `[workflow-startup] transient startup failure; retrying attempt ${attempt + 1}/${maxAttempts} error=${errorText(error)}\n`,
    )
    scheduleWorkflowStartupRetry(attempt + 1)
  } finally {
    state.starting = false
  }
}
